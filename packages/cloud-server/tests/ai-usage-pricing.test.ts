import { describe, expect, it } from "vitest";

import { calculateAiUsageCost } from "../src/ai-usage/pricing.js";

describe("AI usage pricing", () => {
  it("prices gpt-5.5 cached input as a subset of input and reasoning as output", () => {
    const cost = calculateAiUsageCost({
      model: "gpt-5.5",
      inputTokens: 3,
      outputTokens: 4,
      cachedInputTokens: 1,
      reasoningOutputTokens: 2,
      metadata: {},
    });

    expect(cost).toMatchObject({
      model: "gpt-5.5",
      rateMode: "standard",
      totalUsd: 0.0001305,
      notes: ["Reasoning tokens are included in output tokens and billed at the output rate."],
    });
  });

  it("uses the long-context gpt-5.5 rates when input tokens exceed 272k", () => {
    const cost = calculateAiUsageCost({
      model: "gpt-5.5",
      inputTokens: 272_001,
      outputTokens: 10,
      cachedInputTokens: 1_000,
      reasoningOutputTokens: 0,
      metadata: {},
    });

    expect(cost).toMatchObject({
      rateMode: "standard-long-context",
      totalUsd: 2.71146,
    });
  });

  it("prices gpt-image-2 text input, image input, and image output separately", () => {
    const cost = calculateAiUsageCost({
      model: "gpt-image-2",
      inputTokens: 31,
      outputTokens: 42,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
      metadata: {
        upstreamUsage: {
          input_tokens: 31,
          output_tokens: 42,
          total_tokens: 73,
          input_tokens_details: { text_tokens: 10, image_tokens: 21 },
        },
      },
    });

    expect(cost).toMatchObject({
      model: "gpt-image-2",
      totalUsd: 0.001478,
      lineItems: [
        { key: "text-input", tokens: 10, rateUsdPerMillion: 5 },
        { key: "image-input", tokens: 21, rateUsdPerMillion: 8 },
        { key: "image-output", tokens: 42, rateUsdPerMillion: 30 },
      ],
    });
  });

  it("uses modality-specific cached gpt-image-2 tokens when reported", () => {
    const cost = calculateAiUsageCost({
      model: "gpt-image-2",
      inputTokens: 150,
      outputTokens: 2,
      cachedInputTokens: 30,
      reasoningOutputTokens: 0,
      metadata: {
        upstreamUsage: {
          input_tokens: 150,
          output_tokens: 2,
          input_tokens_details: {
            text_tokens: 100,
            image_tokens: 50,
            cached_tokens_details: { text_tokens: 20, image_tokens: 10 },
          },
        },
      },
    });

    expect(cost).toMatchObject({
      totalUsd: 0.000825,
      lineItems: [
        { key: "text-input", tokens: 80 },
        { key: "cached-text-input", tokens: 20 },
        { key: "image-input", tokens: 40 },
        { key: "cached-image-input", tokens: 10 },
        { key: "image-output", tokens: 2 },
      ],
    });
  });

  it("prices claude-sonnet-4-6 cache writes, cache reads, input, and output", () => {
    const cost = calculateAiUsageCost({
      model: "claude-sonnet-4-6",
      inputTokens: 115,
      outputTokens: 7,
      cachedInputTokens: 3,
      reasoningOutputTokens: 0,
      metadata: {
        upstreamUsage: {
          input_tokens: 100,
          output_tokens: 7,
          cache_creation: {
            ephemeral_5m_input_tokens: 10,
            ephemeral_1h_input_tokens: 2,
          },
          cache_read_input_tokens: 3,
        },
      },
    });

    expect(cost).toMatchObject({
      model: "claude-sonnet-4-6",
      rateMode: "standard",
      totalUsd: 0.0004554,
      lineItems: [
        { key: "input", tokens: 100, rateUsdPerMillion: 3 },
        { key: "cache-write-5m", tokens: 10, rateUsdPerMillion: 3.75 },
        { key: "cache-write-1h", tokens: 2, rateUsdPerMillion: 6 },
        { key: "cache-read", tokens: 3, rateUsdPerMillion: 0.3 },
        { key: "output", tokens: 7, rateUsdPerMillion: 15 },
      ],
    });
  });

  it("prices claude-opus-4-8 with standard Anthropic rates", () => {
    const cost = calculateAiUsageCost({
      model: "claude-opus-4-8",
      inputTokens: 10,
      outputTokens: 4,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
      metadata: {},
    });

    expect(cost).toMatchObject({
      model: "claude-opus-4-8",
      rateMode: "standard",
      totalUsd: 0.00015,
      lineItems: [
        { key: "input", tokens: 10, rateUsdPerMillion: 5 },
        { key: "output", tokens: 4, rateUsdPerMillion: 25 },
      ],
    });
  });
});
