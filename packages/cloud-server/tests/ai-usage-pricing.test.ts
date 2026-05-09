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
});
