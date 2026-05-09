import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentCapabilitiesService } from "../src/capabilities/service.js";
import type { CapabilitiesCatalog, CapabilityPaths } from "../src/capabilities/types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent capabilities service", () => {
  it("installs bundled skills and mirrors connected tool skills", async () => {
    const { root, paths } = await createTempPaths();
    const toolBin = join(root, "bin", "fake-tool");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(toolBin, "#!/usr/bin/env bash\nif [ \"$1\" = status ]; then exit 0; fi\necho fake-tool 1.0\n");
    await chmod(toolBin, 0o755);

    const service = new AgentCapabilitiesService({
      catalog: createCatalog({ tool: { status: { command: "true" } } }),
      paths,
      env: { PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`, HOME: root },
    });

    await service.initialize();
    await service.refreshToolStatus("fake");
    const capabilities = await service.getCapabilities();

    expect(capabilities.tools[0]).toMatchObject({
      id: "fake",
      installState: "installed",
      connectionState: "connected",
    });
    expect(capabilities.skills[0]).toMatchObject({
      id: "fake-skill",
      installState: "installed",
      active: true,
    });
  });

  it("builds a dynamic instruction block from installed capabilities", async () => {
    const { root, paths } = await createTempPaths();
    const toolBin = join(root, "bin", "fake-tool");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(toolBin, "#!/usr/bin/env bash\necho fake-tool 1.0\n");
    await chmod(toolBin, 0o755);

    const service = new AgentCapabilitiesService({
      catalog: createCatalog({ tool: { status: undefined } }),
      paths,
      env: { PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`, HOME: root },
    });

    await service.initialize();
    expect(await service.buildInstructionBlock()).toContain("Fake Tool as `fake-tool`");
  });

  it("activates bundled skills marked active by default", async () => {
    const { root, paths } = await createTempPaths();
    const service = new AgentCapabilitiesService({
      catalog: createCatalog({
        skills: [{ activeByDefault: true }],
      }),
      paths,
      env: { PATH: process.env.PATH ?? "", HOME: root },
    });

    await service.initialize();

    expect((await service.getCapabilities()).skills[0]).toMatchObject({
      id: "fake-skill",
      installState: "installed",
      active: true,
    });
  });

  it("reactivates default-active bundled skills when their version changes", async () => {
    const { root, paths } = await createTempPaths();
    await writeFile(paths.stateFile, JSON.stringify({
      catalogVersion: "older",
      codexBin: null,
      tools: {},
      skills: {
        "fake-skill": {
          id: "fake-skill",
          installedVersion: "1.0",
          installState: "installed",
          active: false,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    const service = new AgentCapabilitiesService({
      catalog: createCatalog({
        skills: [{ version: "1.1", activeByDefault: true }],
      }),
      paths,
      env: { PATH: process.env.PATH ?? "", HOME: root },
    });

    await service.initialize();

    expect((await service.getCapabilities()).skills[0]).toMatchObject({
      installedVersion: "1.1",
      active: true,
    });
  });
});

const createTempPaths = async (): Promise<{ readonly root: string; readonly paths: CapabilityPaths }> => {
  const root = await mkdtemp(join(tmpdir(), "ank1015-capabilities-"));
  tempRoots.push(root);
  return {
    root,
    paths: {
      stateFile: join(root, "state.json"),
      toolsRoot: join(root, "tools"),
      toolsBinDir: join(root, "tools", "bin"),
      skillsCatalogDir: join(root, "skills", "catalog"),
      activeSkillsDir: join(root, "active-skills"),
    },
  };
};

const createCatalog = (options: {
  readonly tool?: Partial<CapabilitiesCatalog["tools"][number]>;
  readonly skills?: readonly Partial<CapabilitiesCatalog["skills"][number]>[];
} = {}): CapabilitiesCatalog => ({
  version: "test",
  codexToolId: "fake",
  tools: [{
    id: "fake",
    label: "Fake Tool",
    command: "fake-tool",
    desiredVersion: "1.0",
    installStrategy: { type: "existing" },
    versionCommand: { command: "fake-tool" },
    status: { command: "fake-tool", args: ["status"] },
    attachedSkillIds: ["fake-skill"],
    ...options.tool,
  }],
  skills: (options.skills ?? [{}]).map((skill) => ({
    id: "fake-skill",
    label: "Fake Skill",
    version: "1.0",
    description: "Fake skill",
    sourcePath: join(process.cwd(), "tests", "fixtures", "fake-skill"),
    ...skill,
  })),
});
