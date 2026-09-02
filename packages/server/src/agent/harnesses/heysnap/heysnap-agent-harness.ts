import { AgentError } from "../../errors.js";
import { compareThreadsByUpdatedAtDesc, groupThreadSummariesByStartPath } from "../../thread-groups.js";
import type {
  AgentHarnessName,
  AgentRunEvent,
  AgentThread,
  AgentThreadGroup,
  AgentThreadSummary,
  CancelRunInput,
  EditThreadUserMessageInput,
  GetThreadInput,
  IAgentHarness,
  RetrieveThreadsInput,
  RetrieveThreadsResult,
  SendMessageInput,
  SetupInput,
  SteerRunInput,
  SteerRunResult,
} from "../../types.js";

export interface HeysnapAgentHarnessOptions {
  readonly codex: IAgentHarness;
  readonly pi: IAgentHarness;
  readonly defaultHarness?: AgentHarnessName;
}

interface RoutedThreadId {
  readonly harness: AgentHarnessName;
  readonly nativeThreadId: string;
}

interface RoutedHarness {
  readonly name: AgentHarnessName;
  readonly harness: IAgentHarness;
}

const HARNESS_PREFIXES: readonly AgentHarnessName[] = ["codex", "pi"];

export class HeysnapAgentHarness implements IAgentHarness {
  private readonly codex: IAgentHarness;
  private readonly pi: IAgentHarness;
  private readonly defaultHarness: AgentHarnessName;

  constructor(options: HeysnapAgentHarnessOptions) {
    this.codex = options.codex;
    this.pi = options.pi;
    this.defaultHarness = options.defaultHarness ?? "codex";
  }

  async setup(input: SetupInput): Promise<void> {
    await Promise.all([
      this.codex.setup(input),
      this.pi.setup(input),
    ]);
  }

  async retrieveThreads(input: RetrieveThreadsInput = {}): Promise<RetrieveThreadsResult> {
    const childInput = {
      ...input,
      limit: input.limit === undefined ? undefined : input.limit * HARNESS_PREFIXES.length,
    };
    const [codexResult, piResult] = await Promise.all([
      this.codex.retrieveThreads(childInput),
      this.pi.retrieveThreads(childInput),
    ]);
    const entries = [
      ...flattenThreadGroups("codex", codexResult.groups),
      ...flattenThreadGroups("pi", piResult.groups),
    ]
      .sort(compareThreadsByUpdatedAtDesc)
      .slice(0, input.limit);

    return { groups: groupRoutedThreads(entries) };
  }

  async getThread(input: GetThreadInput): Promise<AgentThread> {
    const routed = parseRoutedThreadId(input.threadId);
    const child = this.getHarness(routed.harness);
    const thread = await child.harness.getThread({ threadId: routed.nativeThreadId });

    return rewriteThread(child.name, thread);
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<AgentRunEvent> {
    const child = this.selectHarnessForSend(input);
    const nativeThreadId = input.threadId === undefined
      ? undefined
      : parseRoutedThreadId(input.threadId).nativeThreadId;
    const childInput = child.name === "pi"
      ? { ...input, threadId: nativeThreadId, harness: undefined }
      : {
        ...input,
        threadId: nativeThreadId,
        harness: undefined,
        provider: undefined,
        model: undefined,
      };

    yield* rewriteRunEvents(child.name, child.harness.sendMessage(childInput));
  }

  async *editThreadUserMessage(input: EditThreadUserMessageInput): AsyncIterable<AgentRunEvent> {
    const routed = parseRoutedThreadId(input.threadId);
    const child = this.getHarness(routed.harness);

    if (child.harness.editThreadUserMessage === undefined) {
      throw new AgentError("EDIT_NOT_SUPPORTED", "Editing thread messages is not supported by this agent harness");
    }

    yield* rewriteRunEvents(child.name, child.harness.editThreadUserMessage({
      ...input,
      threadId: routed.nativeThreadId,
    }));
  }

  async cancelRun(input: CancelRunInput): Promise<void> {
    const routed = parseRoutedThreadId(input.threadId);
    const child = this.getHarness(routed.harness);

    await child.harness.cancelRun?.({
      ...input,
      threadId: routed.nativeThreadId,
    });
  }

  async steerRun(input: SteerRunInput): Promise<SteerRunResult> {
    const routed = parseRoutedThreadId(input.threadId);
    const child = this.getHarness(routed.harness);

    if (child.harness.steerRun === undefined) {
      throw new AgentError("STEER_NOT_SUPPORTED", "Steering active turns is not supported by this agent harness");
    }

    return child.harness.steerRun({
      ...input,
      threadId: routed.nativeThreadId,
    });
  }

  private selectHarnessForSend(input: SendMessageInput): RoutedHarness {
    if (input.threadId === undefined) {
      return this.getHarness(input.harness ?? this.defaultHarness);
    }

    const routed = parseRoutedThreadId(input.threadId);

    if (input.harness !== undefined && input.harness !== routed.harness) {
      throw new AgentError(
        "AGENT_HARNESS_THREAD_MISMATCH",
        "Requested harness does not own the requested thread",
      );
    }

    return this.getHarness(routed.harness);
  }

  private getHarness(name: AgentHarnessName): RoutedHarness {
    return {
      name,
      harness: name === "pi" ? this.pi : this.codex,
    };
  }
}

const flattenThreadGroups = (
  harness: AgentHarnessName,
  groups: readonly AgentThreadGroup[],
): AgentThreadSummary[] =>
  groups.flatMap((group) =>
    group.threads.map((thread) => rewriteThreadSummary(harness, thread))
  );

const groupRoutedThreads = (
  entries: readonly AgentThreadSummary[],
): AgentThreadGroup[] => {
  return groupThreadSummariesByStartPath(entries);
};

const parseRoutedThreadId = (threadId: string): RoutedThreadId => {
  const normalizedThreadId = safeDecodeURIComponent(threadId);

  for (const harness of HARNESS_PREFIXES) {
    const prefix = `${harness}:`;

    if (normalizedThreadId.startsWith(prefix)) {
      return {
        harness,
        nativeThreadId: safeDecodeURIComponent(normalizedThreadId.slice(prefix.length)),
      };
    }
  }

  return {
    harness: "codex",
    nativeThreadId: normalizedThreadId,
  };
};

const formatRoutedThreadId = (harness: AgentHarnessName, nativeThreadId: string): string =>
  harness === "codex" ? nativeThreadId : `${harness}:${encodeURIComponent(nativeThreadId)}`;

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const rewriteThreadSummary = (harness: AgentHarnessName, thread: AgentThreadSummary): AgentThreadSummary => ({
  ...thread,
  id: formatRoutedThreadId(harness, thread.id),
});

const rewriteThread = (harness: AgentHarnessName, thread: AgentThread): AgentThread => ({
  ...thread,
  id: formatRoutedThreadId(harness, thread.id),
});

async function* rewriteRunEvents(
  harness: AgentHarnessName,
  events: AsyncIterable<AgentRunEvent>,
): AsyncIterable<AgentRunEvent> {
  for await (const event of events) {
    yield rewriteRunEvent(harness, event);
  }
}

const rewriteRunEvent = (harness: AgentHarnessName, event: AgentRunEvent): AgentRunEvent => {
  const routedThreadId = formatRoutedThreadId(harness, event.threadId);

  switch (event.type) {
    case "thread.created":
    case "thread.updated":
      return {
        ...event,
        threadId: routedThreadId,
        thread: {
          ...event.thread,
          id: routedThreadId,
        },
      };
    case "turn.started":
    case "turn.completed":
    case "message.started":
    case "message.completed":
    case "content.delta":
    case "item.started":
    case "item.updated":
    case "item.completed":
    case "request.opened":
    case "request.resolved":
    case "runtime.warning":
    case "runtime.error":
      return {
        ...event,
        threadId: routedThreadId,
      };
  }
};
