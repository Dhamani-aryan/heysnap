import type { AiUsageRequestRecord } from "../db/types.js";

const TOKENS_PER_MILLION = 1_000_000;
const GPT_5_5_LONG_CONTEXT_THRESHOLD = 272_000;

interface RateCard {
  readonly input: number;
  readonly cachedInput: number;
  readonly output: number;
}

interface ClaudeRateCard extends RateCard {
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}

interface ImageModalityTokens {
  readonly textInputTokens: number;
  readonly cachedTextInputTokens: number;
  readonly imageInputTokens: number;
  readonly cachedImageInputTokens: number;
}

export interface AiUsageCostLineItem {
  readonly key: string;
  readonly label: string;
  readonly tokens: number;
  readonly rateUsdPerMillion: number;
  readonly costUsd: number;
}

export interface AiUsageCostBreakdown {
  readonly currency: "USD";
  readonly model: string;
  readonly totalUsd: number;
  readonly rateMode: string;
  readonly lineItems: readonly AiUsageCostLineItem[];
  readonly notes: readonly string[];
}

export const calculateAiUsageCost = (
  usage: Pick<
    AiUsageRequestRecord,
    "model" | "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningOutputTokens" | "metadata"
  >,
): AiUsageCostBreakdown | null => {
  switch (usage.model) {
    case "gpt-5.5":
      return calculateGpt55Cost(usage);
    case "gpt-image-2":
      return calculateGptImage2Cost(usage);
    case "claude-sonnet-4-6":
      return calculateClaudeCost(usage, {
        input: 3,
        cachedInput: 0.3,
        cacheWrite5m: 3.75,
        cacheWrite1h: 6,
        output: 15,
      });
    case "claude-opus-4-7":
      return calculateClaudeCost(usage, {
        input: 5,
        cachedInput: 0.5,
        cacheWrite5m: 6.25,
        cacheWrite1h: 10,
        output: 25,
      });
    default:
      return null;
  }
};

const calculateGpt55Cost = (
  usage: Pick<AiUsageRequestRecord, "model" | "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningOutputTokens">,
): AiUsageCostBreakdown => {
  const longContext = usage.inputTokens > GPT_5_5_LONG_CONTEXT_THRESHOLD;
  const rates: RateCard = longContext
    ? { input: 10, cachedInput: 1, output: 45 }
    : { input: 5, cachedInput: 0.5, output: 30 };
  const cachedInputTokens = clampTokens(usage.cachedInputTokens, usage.inputTokens);
  const uncachedInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);
  const notes = usage.reasoningOutputTokens > 0
    ? ["Reasoning tokens are included in output tokens and billed at the output rate."]
    : [];

  return buildBreakdown({
    model: "gpt-5.5",
    rateMode: longContext ? "standard-long-context" : "standard",
    notes,
    lineItems: [
      buildLineItem("input", "Input", uncachedInputTokens, rates.input),
      buildLineItem("cached-input", "Cached input", cachedInputTokens, rates.cachedInput),
      buildLineItem("output", "Output", usage.outputTokens, rates.output),
    ],
  });
};

const calculateGptImage2Cost = (
  usage: Pick<AiUsageRequestRecord, "model" | "inputTokens" | "outputTokens" | "cachedInputTokens" | "metadata">,
): AiUsageCostBreakdown => {
  const upstreamUsage = readUpstreamUsage(usage.metadata);
  const inputDetails =
    asRecord(upstreamUsage?.["input_tokens_details"]) ??
    asRecord(upstreamUsage?.["prompt_tokens_details"]);
  const modalityTokens = readImageModalityTokens(usage, inputDetails);

  return buildBreakdown({
    model: "gpt-image-2",
    rateMode: "standard",
    notes: modalityTokens.notes,
    lineItems: [
      buildLineItem(
        "text-input",
        "Text input",
        Math.max(modalityTokens.textInputTokens - modalityTokens.cachedTextInputTokens, 0),
        5,
      ),
      buildLineItem(
        "cached-text-input",
        "Cached text input",
        modalityTokens.cachedTextInputTokens,
        1.25,
      ),
      buildLineItem(
        "image-input",
        "Image input",
        Math.max(modalityTokens.imageInputTokens - modalityTokens.cachedImageInputTokens, 0),
        8,
      ),
      buildLineItem(
        "cached-image-input",
        "Cached image input",
        modalityTokens.cachedImageInputTokens,
        2,
      ),
      buildLineItem("image-output", "Image output", usage.outputTokens, 30),
    ],
  });
};

const calculateClaudeCost = (
  usage: Pick<AiUsageRequestRecord, "model" | "inputTokens" | "outputTokens" | "cachedInputTokens" | "metadata">,
  rates: ClaudeRateCard,
): AiUsageCostBreakdown => {
  const upstreamUsage = readUpstreamUsage(usage.metadata);
  const cacheCreation = asRecord(upstreamUsage?.["cache_creation"]);
  const cacheWrite1hTokens = numberField(cacheCreation, "ephemeral_1h_input_tokens") ?? 0;
  const legacyCacheWriteTokens = numberField(upstreamUsage, "cache_creation_input_tokens");
  const cacheWrite5mTokens =
    numberField(cacheCreation, "ephemeral_5m_input_tokens") ??
    Math.max((legacyCacheWriteTokens ?? 0) - cacheWrite1hTokens, 0);
  const cacheReadTokens = clampTokens(
    numberField(upstreamUsage, "cache_read_input_tokens") ?? usage.cachedInputTokens,
    usage.inputTokens,
  );
  const uncachedInputTokens = Math.max(
    usage.inputTokens - cacheWrite5mTokens - cacheWrite1hTokens - cacheReadTokens,
    0,
  );
  const notes = legacyCacheWriteTokens !== undefined && cacheCreation === undefined
    ? ["Anthropic cache creation tokens did not include duration details; cache writes were priced at the 5-minute rate."]
    : [];

  return buildBreakdown({
    model: usage.model ?? "claude",
    rateMode: "standard",
    notes,
    lineItems: [
      buildLineItem("input", "Input", uncachedInputTokens, rates.input),
      buildLineItem("cache-write-5m", "Cache write 5m", cacheWrite5mTokens, rates.cacheWrite5m),
      buildLineItem("cache-write-1h", "Cache write 1h", cacheWrite1hTokens, rates.cacheWrite1h),
      buildLineItem("cache-read", "Cache read", cacheReadTokens, rates.cachedInput),
      buildLineItem("output", "Output", usage.outputTokens, rates.output),
    ],
  });
};

const readImageModalityTokens = (
  usage: Pick<AiUsageRequestRecord, "inputTokens" | "cachedInputTokens">,
  inputDetails: Record<string, unknown> | undefined,
): ImageModalityTokens & { readonly notes: readonly string[] } => {
  const notes: string[] = [];
  let textInputTokens = numberField(inputDetails, "text_tokens");
  let imageInputTokens = numberField(inputDetails, "image_tokens");

  if (textInputTokens === undefined && imageInputTokens === undefined) {
    textInputTokens = usage.inputTokens;
    imageInputTokens = 0;
    notes.push("Input token modality details were not reported; input tokens were priced as text input.");
  } else {
    textInputTokens ??= Math.max(usage.inputTokens - (imageInputTokens ?? 0), 0);
    imageInputTokens ??= Math.max(usage.inputTokens - textInputTokens, 0);
  }

  let cachedTextInputTokens =
    numberField(inputDetails, "cached_text_tokens") ??
    numberField(inputDetails, "text_cached_tokens") ??
    numberField(asRecord(inputDetails?.["cached_tokens_details"]), "text_tokens");
  let cachedImageInputTokens =
    numberField(inputDetails, "cached_image_tokens") ??
    numberField(inputDetails, "image_cached_tokens") ??
    numberField(asRecord(inputDetails?.["cached_tokens_details"]), "image_tokens");
  const cachedInputTokens = clampTokens(usage.cachedInputTokens, usage.inputTokens);

  if (cachedTextInputTokens === undefined && cachedImageInputTokens === undefined) {
    if (cachedInputTokens > 0) {
      const totalByModality = textInputTokens + imageInputTokens;
      if (totalByModality > 0) {
        cachedTextInputTokens = Math.round((cachedInputTokens * textInputTokens) / totalByModality);
        cachedImageInputTokens = cachedInputTokens - cachedTextInputTokens;
        notes.push("Cached input tokens did not include modality details; cached tokens were allocated proportionally.");
      } else {
        cachedTextInputTokens = cachedInputTokens;
        cachedImageInputTokens = 0;
      }
    } else {
      cachedTextInputTokens = 0;
      cachedImageInputTokens = 0;
    }
  } else {
    cachedTextInputTokens ??= Math.max(cachedInputTokens - (cachedImageInputTokens ?? 0), 0);
    cachedImageInputTokens ??= Math.max(cachedInputTokens - cachedTextInputTokens, 0);
  }

  return {
    textInputTokens,
    cachedTextInputTokens: clampTokens(cachedTextInputTokens, textInputTokens),
    imageInputTokens,
    cachedImageInputTokens: clampTokens(cachedImageInputTokens, imageInputTokens),
    notes,
  };
};

const readUpstreamUsage = (metadata: unknown): Record<string, unknown> | undefined => {
  const record = asRecord(metadata);
  return asRecord(record?.["upstreamUsage"]);
};

const buildBreakdown = (input: {
  readonly model: string;
  readonly rateMode: string;
  readonly lineItems: readonly AiUsageCostLineItem[];
  readonly notes: readonly string[];
}): AiUsageCostBreakdown => {
  const lineItems = input.lineItems.filter((item) => item.tokens > 0);
  const totalUsd = roundUsd(lineItems.reduce((total, item) => total + item.costUsd, 0));

  return {
    currency: "USD",
    model: input.model,
    totalUsd,
    rateMode: input.rateMode,
    lineItems,
    notes: input.notes,
  };
};

const buildLineItem = (
  key: string,
  label: string,
  tokens: number,
  rateUsdPerMillion: number,
): AiUsageCostLineItem => ({
  key,
  label,
  tokens,
  rateUsdPerMillion,
  costUsd: roundUsd((tokens / TOKENS_PER_MILLION) * rateUsdPerMillion),
});

const clampTokens = (value: number, max: number): number => Math.max(0, Math.min(value, max));

const roundUsd = (value: number): number => Number(value.toFixed(10));

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
};

const numberField = (record: Record<string, unknown> | undefined, key: string): number | undefined => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};
