import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";

import { defaultCapabilitiesCatalog } from "./catalog.js";
import { CapabilityError } from "./errors.js";
import { resolveCapabilityPaths, resolveUserCapabilityPaths } from "./paths.js";
import type {
  AgentSkillDefinition,
  AgentSkillSnapshot,
  AgentToolDefinition,
  AgentToolSnapshot,
  CapabilitiesCatalog,
  CapabilitiesSnapshot,
  CapabilityCommand,
  CapabilityPaths,
  CapabilityState,
  ToolConnectionState,
} from "./types.js";

const COMMAND_TIMEOUT_MS = 120_000;

export interface CapabilityProgress {
  readonly message: string;
}

export interface InteractiveCapabilityCommand {
  readonly completed: Promise<AgentToolSnapshot>;
  writeInput(input: string): void;
  cancel(): void;
}

export interface AgentCapabilitiesServiceOptions {
  readonly catalog?: CapabilitiesCatalog;
  readonly paths?: CapabilityPaths;
  readonly env?: NodeJS.ProcessEnv;
}

export class AgentCapabilitiesService {
  private state: CapabilityState | null = null;

  readonly catalog: CapabilitiesCatalog;
  paths: CapabilityPaths;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: AgentCapabilitiesServiceOptions = {}) {
    this.catalog = options.catalog ?? defaultCapabilitiesCatalog;
    this.paths = options.paths ?? resolveCapabilityPaths(options.env);
    this.env = options.env ?? process.env;
  }

  async initialize(onProgress: (progress: CapabilityProgress) => void = () => {}): Promise<void> {
    try {
      await this.ensureDirectories();
    } catch (error) {
      if (!canFallbackToUserPaths(error, this.env)) {
        throw error;
      }

      this.paths = resolveUserCapabilityPaths(this.env);
      onProgress({ message: "Falling back to user-writable capability paths." });
      await this.ensureDirectories();
    }
    this.state = await this.loadState();
    await this.installBundledSkills(onProgress);
    await this.adoptTools(onProgress);
    await this.enforceLinkedSkills(onProgress);
    await this.saveState();
  }

  getCodexBin(): string | undefined {
    const codexTool = this.catalog.tools.find((tool) => tool.id === this.catalog.codexToolId);
    const stateBin = this.state?.codexBin?.trim();

    if (stateBin !== undefined && stateBin.length > 0) {
      return stateBin;
    }

    return codexTool?.command;
  }

  async getCapabilities(): Promise<CapabilitiesSnapshot> {
    await this.ensureInitialized();
    return this.snapshot();
  }

  async refreshToolStatuses(): Promise<CapabilitiesSnapshot> {
    await this.ensureInitialized();
    for (const tool of this.catalog.tools) {
      await this.refreshToolStatus(tool.id);
    }
    return this.snapshot();
  }

  async installTool(toolId: string, onProgress: (progress: CapabilityProgress) => void = () => {}): Promise<AgentToolSnapshot> {
    const tool = this.requireTool(toolId);
    await this.ensureInitialized();
    if (await this.runHelperIfAvailable("install-tool", tool.id, undefined, onProgress)) {
      this.state = await this.loadState();
      return this.snapshotTool(tool.id);
    }

    onProgress({ message: `Installing ${tool.label}` });
    this.setToolState(tool.id, {
      installState: "installing",
      lastError: undefined,
    });
    await this.saveState();

    try {
      await this.installToolDefinition(tool, onProgress);
      const installedVersion = await this.readToolVersion(tool);
      const commandPath = await this.resolveCommand(tool.command);
      this.setToolState(tool.id, {
        installedVersion,
        installState: "installed",
        connectionState: await this.readConnectionState(tool),
        lastError: undefined,
      });

      if (tool.id === this.catalog.codexToolId) {
        this.state = {
          ...(this.state as CapabilityState),
          codexBin: commandPath ?? tool.command,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Install failed";
      this.setToolState(tool.id, {
        installState: "failed",
        lastError: message,
      });
      await this.saveState();
      throw new CapabilityError("TOOL_INSTALL_FAILED", message);
    }

    await this.enforceLinkedSkills(onProgress);
    await this.saveState();
    return this.snapshotTool(tool.id);
  }

  updateTool(toolId: string, onProgress: (progress: CapabilityProgress) => void = () => {}): Promise<AgentToolSnapshot> {
    return this.installTool(toolId, onProgress);
  }

  toolConnectionRequiresInput(toolId: string): boolean {
    const tool = this.requireTool(toolId);
    return tool.connect?.interactive === "tty";
  }

  async connectTool(toolId: string, onProgress: (progress: CapabilityProgress) => void = () => {}): Promise<AgentToolSnapshot> {
    const tool = this.requireTool(toolId);
    await this.ensureInitialized();

    if (tool.connect === undefined) {
      throw new CapabilityError("TOOL_CONNECT_UNSUPPORTED", `${tool.label} does not define a connect flow.`);
    }

    if (this.shouldInstallBeforeConnect(tool)) {
      await this.installTool(tool.id, onProgress);
    }

    await this.runCommand(tool.connect, onProgress);
    this.setToolState(tool.id, {
      connectionState: await this.readConnectionState(tool),
      lastError: undefined,
    });
    await this.enforceLinkedSkills(onProgress);
    await this.saveState();
    return this.snapshotTool(tool.id);
  }

  async startInteractiveConnectTool(
    toolId: string,
    onProgress: (progress: CapabilityProgress) => void = () => {},
  ): Promise<InteractiveCapabilityCommand> {
    const tool = this.requireTool(toolId);
    await this.ensureInitialized();

    if (tool.connect === undefined) {
      throw new CapabilityError("TOOL_CONNECT_UNSUPPORTED", `${tool.label} does not define a connect flow.`);
    }

    if (tool.connect.interactive !== "tty") {
      throw new CapabilityError("TOOL_CONNECT_NOT_INTERACTIVE", `${tool.label} does not define an interactive connect flow.`);
    }

    if (this.shouldInstallBeforeConnect(tool)) {
      await this.installTool(tool.id, onProgress);
    }

    let command: InteractiveRunResult | null = null;
    let pendingGitHubAutoInputs = 0;
    const maybeWriteGitHubAutoInputs = (): void => {
      if (
        tool.id !== "github" ||
        pendingGitHubAutoInputs === 0 ||
        command === null
      ) {
        return;
      }

      while (pendingGitHubAutoInputs > 0) {
        pendingGitHubAutoInputs -= 1;
        command.writeInput("\n");
      }
    };

    command = runInteractive(tool.connect, {
      env: this.commandEnv(),
      timeoutMs: COMMAND_TIMEOUT_MS * 5,
      onOutput: (chunk) => {
        if (isGitHubAutoAdvancePrompt(chunk)) {
          pendingGitHubAutoInputs += 1;
          maybeWriteGitHubAutoInputs();
        }
        onProgress({ message: chunk.trim() });
      },
    });
    maybeWriteGitHubAutoInputs();

    return {
      writeInput: command.writeInput,
      cancel: command.cancel,
      completed: command.completed.then(async () => {
        this.setToolState(tool.id, {
          connectionState: await this.readConnectionState(tool),
          lastError: undefined,
        });
        await this.enforceLinkedSkills(onProgress);
        await this.saveState();
        return this.snapshotTool(tool.id);
      }),
    };
  }

  async disconnectTool(toolId: string, onProgress: (progress: CapabilityProgress) => void = () => {}): Promise<AgentToolSnapshot> {
    const tool = this.requireTool(toolId);
    await this.ensureInitialized();

    if (tool.disconnect === undefined) {
      throw new CapabilityError("TOOL_DISCONNECT_UNSUPPORTED", `${tool.label} does not define a disconnect flow.`);
    }

    await this.runCommand(tool.disconnect, onProgress);
    this.setToolState(tool.id, {
      connectionState: await this.readConnectionState(tool),
      lastError: undefined,
    });
    await this.enforceLinkedSkills(onProgress);
    await this.saveState();
    return this.snapshotTool(tool.id);
  }

  async refreshToolStatus(toolId: string): Promise<AgentToolSnapshot> {
    const tool = this.requireTool(toolId);
    await this.ensureInitialized();
    this.setToolState(tool.id, {
      installedVersion: await this.readToolVersion(tool),
      installState: await commandExists(tool.command, this.commandEnv()) ? "installed" : "not_installed",
      connectionState: await this.readConnectionState(tool),
    });
    await this.enforceLinkedSkills();
    await this.saveState();
    return this.snapshotTool(tool.id);
  }

  async installSkill(skillId: string, onProgress: (progress: CapabilityProgress) => void = () => {}): Promise<AgentSkillSnapshot> {
    const skill = this.requireSkill(skillId);
    await this.ensureInitialized();
    if (await this.runHelperIfAvailable("install-skill", skill.id, undefined, onProgress)) {
      this.state = await this.loadState();
      return this.snapshotSkill(skill.id);
    }

    onProgress({ message: `Installing ${skill.label}` });
    await this.writeSkillCatalog(skill);
    this.setSkillState(skill.id, {
      installedVersion: skill.version,
      installState: "installed",
      lastError: undefined,
    });
    await this.saveState();
    return this.snapshotSkill(skill.id);
  }

  async setSkillActive(
    skillId: string,
    active: boolean,
    onProgress: (progress: CapabilityProgress) => void = () => {},
  ): Promise<AgentSkillSnapshot> {
    const skill = this.requireSkill(skillId);
    await this.ensureInitialized();
    if (await this.runHelperIfAvailable("set-skill-active", skill.id, active ? "true" : "false", onProgress)) {
      this.state = await this.loadState();
      return this.snapshotSkill(skill.id);
    }

    await this.installSkill(skill.id, onProgress);
    await this.setSkillActiveOnDisk(skill, active);
    this.setSkillState(skill.id, {
      active,
      lastError: undefined,
    });
    await this.saveState();
    return this.snapshotSkill(skill.id);
  }

  async buildInstructionBlock(): Promise<string> {
    const capabilities = await this.getCapabilities();
    const installedTools = capabilities.tools.filter((tool) => tool.installState === "installed");
    const unavailableTools = capabilities.tools.filter((tool) => tool.installState !== "installed");
    const activeSkills = capabilities.skills.filter((skill) => skill.active);

    return [
      "Agent capabilities on this machine:",
      installedTools.length === 0
        ? "- Installed tools: none managed by machine-server."
        : `- Installed tools: ${installedTools.map(renderToolInstruction).join("; ")}.`,
      unavailableTools.length === 0
        ? "- Unavailable tools: none."
        : `- Unavailable tools: ${unavailableTools.map((tool) => `${tool.label} (${tool.installState})`).join("; ")}.`,
      activeSkills.length === 0
        ? "- Active skills: none managed by machine-server."
        : `- Active skills: ${activeSkills.map((skill) => skill.label).join(", ")}.`,
    ].join("\n");
  }

  private async ensureInitialized(): Promise<CapabilityState> {
    if (this.state === null) {
      await this.initialize();
    }

    return this.state as CapabilityState;
  }

  private async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(dirname(this.paths.stateFile), { recursive: true }),
      mkdir(this.paths.toolsRoot, { recursive: true }),
      mkdir(this.paths.toolsBinDir, { recursive: true }),
      mkdir(this.paths.skillsCatalogDir, { recursive: true }),
      mkdir(this.paths.activeSkillsDir, { recursive: true }),
    ]);
  }

  private async loadState(): Promise<CapabilityState> {
    let previous: Partial<CapabilityState> = {};

    try {
      previous = JSON.parse(await readFile(this.paths.stateFile, "utf8")) as Partial<CapabilityState>;
    } catch {
      previous = {};
    }

    const now = new Date().toISOString();
    return {
      catalogVersion: this.catalog.version,
      codexBin: typeof previous.codexBin === "string" ? previous.codexBin : null,
      tools: Object.fromEntries(this.catalog.tools.map((tool) => {
        const existing = previous.tools?.[tool.id];
        return [tool.id, {
          id: tool.id,
          installedVersion: existing?.installedVersion ?? null,
          installState: existing?.installState ?? "not_installed",
          connectionState: existing?.connectionState ?? (tool.status === undefined ? "unsupported" : "unknown"),
          lastError: existing?.lastError,
          updatedAt: existing?.updatedAt ?? now,
        }];
      })),
      skills: Object.fromEntries(this.catalog.skills.map((skill) => {
        const existing = previous.skills?.[skill.id];
        return [skill.id, {
          id: skill.id,
          installedVersion: existing?.installedVersion ?? null,
          installState: existing?.installState ?? "not_installed",
          active: existing?.active ?? skill.activeByDefault === true,
          lastError: existing?.lastError,
          updatedAt: existing?.updatedAt ?? now,
        }];
      })),
      updatedAt: now,
    };
  }

  private async saveState(): Promise<void> {
    if (this.state === null) {
      return;
    }

    const tempFile = `${this.paths.stateFile}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.paths.stateFile), { recursive: true });
    await writeFile(tempFile, `${JSON.stringify(this.state, null, 2)}\n`);
    await rename(tempFile, this.paths.stateFile);
  }

  private async installBundledSkills(onProgress: (progress: CapabilityProgress) => void): Promise<void> {
    for (const skill of this.catalog.skills) {
      const skillState = this.state?.skills[skill.id];
      if (skillState?.installedVersion === skill.version && skillState.installState === "installed") {
        continue;
      }

      onProgress({ message: `Installing bundled skill ${skill.label}` });
      const active = skill.activeByDefault === true ? true : skillState?.active ?? false;
      try {
        await this.writeSkillCatalog(skill);
        this.setSkillState(skill.id, {
          installedVersion: skill.version,
          installState: "installed",
          active,
          lastError: undefined,
        });
        await this.setSkillActiveOnDisk(skill, active);
      } catch (error) {
        if (await this.runHelperIfAvailable("install-skill", skill.id, undefined, onProgress)) {
          this.state = await this.loadState();
          continue;
        }

        throw error;
      }
    }
  }

  private async adoptTools(onProgress: (progress: CapabilityProgress) => void): Promise<void> {
    for (const tool of this.catalog.tools) {
      const exists = await commandExists(tool.command, this.commandEnv());
      if (!exists && tool.required === true) {
        await this.installTool(tool.id, onProgress);
        continue;
      }

      this.setToolState(tool.id, {
        installState: exists ? "installed" : "not_installed",
        installedVersion: exists ? await this.readToolVersion(tool) : null,
        connectionState: tool.status === undefined ? "unsupported" : "unknown",
        lastError: undefined,
      });

      if (tool.id === this.catalog.codexToolId && exists) {
        this.state = {
          ...(this.state as CapabilityState),
          codexBin: await this.resolveCommand(tool.command) ?? tool.command,
        };
      }
    }
  }

  private async enforceLinkedSkills(onProgress: (progress: CapabilityProgress) => void = () => {}): Promise<void> {
    for (const tool of this.catalog.tools) {
      if (tool.attachedSkillIds === undefined || tool.attachedSkillIds.length === 0) {
        continue;
      }

      const toolState = this.state?.tools[tool.id];
      if (toolState?.connectionState !== "connected" && toolState?.connectionState !== "disconnected") {
        continue;
      }

      const active = toolState.connectionState === "connected";
      for (const skillId of tool.attachedSkillIds) {
        const skill = this.catalog.skills.find((candidate) => candidate.id === skillId);
        if (skill === undefined) {
          continue;
        }

        onProgress({ message: `${active ? "Activating" : "Deactivating"} ${skill.label}` });
        await this.writeSkillCatalog(skill);
        await this.setSkillActiveOnDisk(skill, active);
        this.setSkillState(skill.id, {
          installedVersion: skill.version,
          installState: "installed",
          active,
          lastError: undefined,
        });
      }
    }
  }

  private async installToolDefinition(
    tool: AgentToolDefinition,
    onProgress: (progress: CapabilityProgress) => void,
  ): Promise<void> {
    switch (tool.installStrategy.type) {
      case "existing":
        if (!(await commandExists(tool.command, this.commandEnv()))) {
          throw new CapabilityError("TOOL_NOT_FOUND", `${tool.command} is not available on PATH.`);
        }
        return;
      case "npm": {
        const installDir = join(this.paths.toolsRoot, "installed", tool.id);
        await mkdir(installDir, { recursive: true });
        const packageSpec = `${tool.installStrategy.packageName}@${tool.desiredVersion}`;
        await this.runCommand({ command: "npm", args: ["install", "--prefix", installDir, packageSpec] }, onProgress);
        const source = join(installDir, "node_modules", ".bin", tool.installStrategy.binaryName);
        const target = join(this.paths.toolsBinDir, tool.command);
        await linkExecutable(source, target);
        return;
      }
    }
  }

  private async writeSkillCatalog(skill: AgentSkillDefinition): Promise<void> {
    const skillDir = join(this.paths.skillsCatalogDir, skill.id);
    const tempSkillDir = join(this.paths.skillsCatalogDir, `.${skill.id}.${randomUUID()}.tmp`);
    await mkdir(dirname(skillDir), { recursive: true });
    await removeWithRetry(tempSkillDir);
    await cp(skill.sourcePath, tempSkillDir, {
      recursive: true,
      filter: (source) => source !== join(skill.sourcePath, "skill.json"),
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await removeWithRetry(skillDir);
      try {
        await rename(tempSkillDir, skillDir);
        return;
      } catch (error) {
        if (
          attempt === 2 ||
          !isNodeError(error) ||
          (error.code !== "EEXIST" && error.code !== "ENOTEMPTY")
        ) {
          throw error;
        }
        await delay(10);
      }
    }
  }

  private async setSkillActiveOnDisk(skill: AgentSkillDefinition, active: boolean): Promise<void> {
    const activePath = join(this.paths.activeSkillsDir, skill.id);
    await mkdir(this.paths.activeSkillsDir, { recursive: true });
    await rm(activePath, { recursive: true, force: true });

    if (!active) {
      return;
    }

    try {
      await symlink(join(this.paths.skillsCatalogDir, skill.id), activePath, "dir");
    } catch (error) {
      if (!(isNodeError(error) && error.code === "EEXIST")) {
        throw error;
      }
    }
  }

  private async readToolVersion(tool: AgentToolDefinition): Promise<string | null> {
    const command = tool.versionCommand ?? { command: tool.command, args: ["--version"] };
    const result = await run(command, { env: this.commandEnv(), timeoutMs: 20_000 });

    if (result.exitCode !== 0) {
      return null;
    }

    const firstLine = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return firstLine ?? tool.desiredVersion;
  }

  private async readConnectionState(tool: AgentToolDefinition): Promise<ToolConnectionState> {
    if (tool.status === undefined) {
      return "unsupported";
    }

    const result = await run(tool.status, { env: this.commandEnv(), timeoutMs: 20_000 });

    if (result.exitCode === 0) {
      return "connected";
    }

    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (
      output.includes("not logged in") ||
      output.includes("not authenticated") ||
      output.includes("not linked") ||
      output.includes("no existing credentials") ||
      output.includes("access token not provided") ||
      output.includes("supply an access token") ||
      output.includes("starting login flow")
    ) {
      return "disconnected";
    }

    return "error";
  }

  private async runCommand(
    command: CapabilityCommand,
    onProgress: (progress: CapabilityProgress) => void,
  ): Promise<void> {
    const result = await run(command, {
      env: this.commandEnv(),
      timeoutMs: COMMAND_TIMEOUT_MS,
      onOutput: (chunk) => onProgress({ message: chunk.trim() }),
    });

    if (result.exitCode !== 0) {
      throw new CapabilityError("COMMAND_FAILED", result.stderr.trim() || result.stdout.trim() || "Command failed");
    }
  }

  private shouldInstallBeforeConnect(tool: AgentToolDefinition): boolean {
    if (tool.installStrategy.type !== "npm") {
      return false;
    }

    const toolState = (this.state as CapabilityState).tools[tool.id];
    if (toolState.installState !== "installed" || toolState.installedVersion === null) {
      return true;
    }

    return !toolState.installedVersion.includes(tool.desiredVersion);
  }

  private async runHelperIfAvailable(
    operation: "install-tool" | "update-tool" | "install-skill" | "set-skill-active",
    targetId: string,
    value: string | undefined,
    onProgress: (progress: CapabilityProgress) => void,
  ): Promise<boolean> {
    if (this.env.ANK1015_CAPABILITIES_HELPER_MODE === "1") {
      return false;
    }

    const helper = this.env.ANK1015_CAPABILITIES_HELPER?.trim() || "/opt/ank1015/agent-capabilities-helper";

    if (!(await fileIsExecutable(helper))) {
      return false;
    }

    const command = process.platform === "win32"
      ? { command: helper, args: [operation, targetId, ...(value === undefined ? [] : [value])] }
      : { command: "sudo", args: [helper, operation, targetId, ...(value === undefined ? [] : [value])] };
    await this.runCommand(command, onProgress);
    return true;
  }

  private commandEnv(): NodeJS.ProcessEnv {
    return {
      ...this.env,
      PATH: `${this.paths.toolsBinDir}:${this.env.PATH ?? process.env.PATH ?? ""}`,
      HOME: this.env.HOME ?? process.env.HOME,
    };
  }

  private snapshot(): CapabilitiesSnapshot {
    const state = this.state as CapabilityState;
    return {
      catalogVersion: state.catalogVersion,
      codexBin: state.codexBin,
      tools: this.catalog.tools.map((tool) => this.snapshotTool(tool.id)),
      skills: this.catalog.skills.map((skill) => this.snapshotSkill(skill.id)),
    };
  }

  private snapshotTool(toolId: string): AgentToolSnapshot {
    const tool = this.requireTool(toolId);
    const state = (this.state as CapabilityState).tools[tool.id];
    return {
      ...tool,
      installedVersion: state.installedVersion,
      installState: state.installState,
      connectionState: state.connectionState,
      lastError: state.lastError,
      canConnect: tool.connect !== undefined,
      canDisconnect: tool.disconnect !== undefined,
      canRefreshStatus: tool.status !== undefined,
    };
  }

  private snapshotSkill(skillId: string): AgentSkillSnapshot {
    const skill = this.requireSkill(skillId);
    const state = (this.state as CapabilityState).skills[skill.id];
    const { sourcePath: _sourcePath, ...definition } = skill;
    return {
      ...definition,
      installedVersion: state.installedVersion,
      installState: state.installState,
      active: state.active,
      lastError: state.lastError,
    };
  }

  private setToolState(toolId: string, patch: Partial<Omit<CapabilityState["tools"][string], "id">>): void {
    const state = this.state as CapabilityState;
    state.tools[toolId] = {
      ...state.tools[toolId],
      ...patch,
      id: toolId,
      updatedAt: new Date().toISOString(),
    };
    this.state = { ...state, updatedAt: new Date().toISOString() };
  }

  private setSkillState(skillId: string, patch: Partial<Omit<CapabilityState["skills"][string], "id">>): void {
    const state = this.state as CapabilityState;
    state.skills[skillId] = {
      ...state.skills[skillId],
      ...patch,
      id: skillId,
      updatedAt: new Date().toISOString(),
    };
    this.state = { ...state, updatedAt: new Date().toISOString() };
  }

  private requireTool(toolId: string): AgentToolDefinition {
    const tool = this.catalog.tools.find((candidate) => candidate.id === toolId);
    if (tool === undefined) {
      throw new CapabilityError("TOOL_NOT_FOUND", `Unknown agent tool: ${toolId}`);
    }

    return tool;
  }

  private requireSkill(skillId: string): AgentSkillDefinition {
    const skill = this.catalog.skills.find((candidate) => candidate.id === skillId);
    if (skill === undefined) {
      throw new CapabilityError("SKILL_NOT_FOUND", `Unknown agent skill: ${skillId}`);
    }

    return skill;
  }

  private async resolveCommand(command: string): Promise<string | null> {
    const result = await run({ command: `command -v ${shellQuote(command)}` }, { env: this.commandEnv(), shell: true, timeoutMs: 10_000 });
    return result.exitCode === 0 ? result.stdout.trim() || null : null;
  }
}

const renderToolInstruction = (tool: AgentToolSnapshot): string => {
  const connection = tool.connectionState === "unsupported" ? "no connection required" : tool.connectionState;
  return `${tool.label} as \`${tool.command}\` (${connection})`;
};

const commandExists = async (command: string, env: NodeJS.ProcessEnv): Promise<boolean> => {
  try {
    await access(command, fsConstants.X_OK);
    return true;
  } catch {
    const result = await run({ command: `command -v ${shellQuote(command)}` }, { env, shell: true, timeoutMs: 10_000 });
    return result.exitCode === 0;
  }
};

const fileIsExecutable = async (path: string): Promise<boolean> => {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const removeWithRetry = async (path: string): Promise<void> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (
        attempt === 4 ||
        !isNodeError(error) ||
        (error.code !== "ENOTEMPTY" && error.code !== "EBUSY" && error.code !== "EEXIST")
      ) {
        throw error;
      }
      await delay(20);
    }
  }
};

const linkExecutable = async (source: string, target: string): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await rm(target, { force: true });

    try {
      await symlink(source, target);
      return;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }

      try {
        if (await readlink(target) === source) {
          return;
        }
      } catch {
        // The competing process may already be replacing the link; retry below.
      }

      if (attempt === 2) {
        throw error;
      }

      await delay(20);
    }
  }
};

const canFallbackToUserPaths = (error: unknown, env: NodeJS.ProcessEnv): boolean => {
  if (!isNodeError(error) || (error.code !== "EACCES" && error.code !== "EPERM")) {
    return false;
  }

  return env.ANK1015_CAPABILITIES_ROOT === undefined &&
    env.ANK1015_AGENT_TOOLS_ROOT === undefined &&
    env.ANK1015_AGENT_TOOLS_BIN_DIR === undefined &&
    env.ANK1015_AGENT_SKILLS_CATALOG_DIR === undefined &&
    env.ANK1015_ACTIVE_SKILLS_DIR === undefined;
};

interface RunOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly shell?: boolean;
  readonly onOutput?: (chunk: string) => void;
}

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface InteractiveRunResult {
  readonly completed: Promise<void>;
  writeInput(input: string): void;
  cancel(): void;
}

const run = (command: CapabilityCommand, options: RunOptions): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = spawn(command.command, [...(options.shell === true ? [] : command.args ?? [])], {
      env: { ...options.env, ...command.env },
      shell: options.shell === true,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout.push(text);
      options.onOutput?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr.push(text);
      options.onOutput?.(text);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout: stdout.join(""), stderr: error.message });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout: stdout.join(""), stderr: stderr.join("") });
    });
  });

const runInteractive = (command: CapabilityCommand, options: RunOptions): InteractiveRunResult => {
  const child = pty.spawn(command.command, [...(command.args ?? [])], {
    env: { ...options.env, ...command.env },
    cols: 100,
    rows: 30,
    name: "xterm-256color",
  });
  const stdout: string[] = [];
  let settled = false;
  const timer = setTimeout(() => {
    killPty(child.pid);
  }, options.timeoutMs);

  const completed = new Promise<void>((resolve, reject) => {
    child.onData((text) => {
      stdout.push(text);
      respondToTerminalQueries(child, text);
      options.onOutput?.(text);
    });
    child.onExit(({ exitCode }) => {
      clearTimeout(timer);
      settled = true;
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(new CapabilityError("COMMAND_FAILED", stdout.join("").trim() || "Command failed"));
    });
  });

  return {
    completed,
    writeInput(input: string): void {
      if (!settled) {
        child.write(input.endsWith("\r") || input.endsWith("\n") ? input : `${input}\r`);
      }
    },
    cancel(): void {
      if (!settled) {
        killPty(child.pid);
      }
    },
  };
};

const respondToTerminalQueries = (child: { write(data: string): void }, text: string): void => {
  if (text.includes("\x1b[6n")) {
    child.write("\x1b[1;1R");
  }
};

const isGitHubAutoAdvancePrompt = (text: string): boolean =>
  text.includes("Authenticate Git with your GitHub credentials?") ||
  (text.includes("Press Enter") && text.includes("github.com"));

const killPty = (pid: number): void => {
  try {
    process.kill(pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already exited.
      }
    }, 1_000).unref();
  } catch {
    // Process already exited.
  }
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
