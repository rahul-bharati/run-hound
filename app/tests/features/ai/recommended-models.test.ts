/**
 * RECOMMENDED_MODELS (docs/onboarding-spec.md "Recommended models"): the pair onboarding and Settings preselect from a
 * provider's live list. The first pattern that matches any listed model wins, the newest match is taken, and with no
 * pattern or no match both start on the first usable model.
 */
import { describe, expect, it } from "vitest";
import { recommendModels } from "../../../src/ai/recommend.js";
import type { AiModelInfo } from "../../../src/ai/types.js";
import { RECOMMENDED_MODELS } from "../../../src/constants/ai-constants.js";

const list = (...ids: string[]): AiModelInfo[] => ids.map((id) => ({ id, details: null, suitable: null }));

describe("recommendModels", () => {
  it("picks an Opus model as main and a Sonnet model as helper for Anthropic, the newest of each", () => {
    // The app sorts a list by id, so the newest model is not the first one listed.
    const models = list("claude-3-7-sonnet-20250219", "claude-haiku-4-5-20251001", "claude-haiku-5-5", "claude-opus-4-1-20250805", "claude-opus-4-5-20251101", "claude-opus-5-5", "claude-sonnet-4-5-20250929", "claude-sonnet-5-5");
    expect(recommendModels("anthropic", models)).toEqual({ main: "claude-opus-5-5", helper: "claude-sonnet-5-5" });
  });

  it("falls to the next pattern when the first matches nothing: Sonnet as main, Haiku as helper when the key has no Opus", () => {
    expect(recommendModels("anthropic", list("claude-haiku-5-5", "claude-sonnet-5-5"))).toEqual({ main: "claude-sonnet-5-5", helper: "claude-sonnet-5-5" });
    expect(recommendModels("anthropic", list("claude-haiku-5-5"))).toEqual({ main: "claude-haiku-5-5", helper: "claude-haiku-5-5" });
  });

  it("prefers an alias to its dated snapshot of the same version", () => {
    expect(recommendModels("anthropic", list("claude-opus-5-5-20261001", "claude-opus-5-5")).main).toBe("claude-opus-5-5");
  });

  it("works for Claude on Bedrock: anthropic.claude-… and us.anthropic.claude-… ids", () => {
    const models = list("amazon.nova-pro-v1:0", "anthropic.claude-sonnet-5-5-v1:0", "us.anthropic.claude-opus-5-5-v1:0", "us.anthropic.claude-haiku-5-5-v1:0");
    expect(recommendModels("bedrock", models)).toEqual({ main: "us.anthropic.claude-opus-5-5-v1:0", helper: "anthropic.claude-sonnet-5-5-v1:0" });
  });

  it("starts both on the first usable model when no pattern matches", () => {
    expect(recommendModels("anthropic", list("mystery-1", "mystery-2"))).toEqual({ main: "mystery-1", helper: "mystery-1" });
    expect(recommendModels("openai", list("babbage-002", "davinci-002"))).toEqual({ main: "babbage-002", helper: "babbage-002" });
  });

  it("starts both on the first usable model for a provider without patterns, skipping a model that can't generate text", () => {
    const models: AiModelInfo[] = [
      { id: "nomic-embed-text", details: null, suitable: false },
      { id: "qwen3:4b", details: null, suitable: null },
      { id: "ornith-1.5:9b", details: null, suitable: true },
    ];
    expect(RECOMMENDED_MODELS.ollama).toBeUndefined();
    expect(recommendModels("ollama", models)).toEqual({ main: "qwen3:4b", helper: "qwen3:4b" });
    expect(recommendModels("openai-compatible", models)).toEqual({ main: "qwen3:4b", helper: "qwen3:4b" });
  });

  it("has no recommendation for an empty list or for a list of unusable models only", () => {
    expect(recommendModels("anthropic", [])).toEqual({ main: null, helper: null });
    expect(recommendModels("ollama", [{ id: "nomic-embed-text", details: null, suitable: false }])).toEqual({ main: null, helper: null });
    expect(recommendModels(null, list("a"))).toEqual({ main: "a", helper: "a" });
  });

  it("picks the flagship tier of OpenAI as main and the balanced tier as helper, never a pro, mini, codex or audio id", () => {
    const models = list("gpt-5.5", "gpt-5.5-pro", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6-astra-codex", "gpt-realtime-6", "gpt-image-2", "chat-latest");
    expect(recommendModels("openai", models)).toEqual({ main: "gpt-6-astra", helper: "gpt-6.1-sol" });
    // Without the flagship tier: the balanced one, newest first; the helper then is the same model.
    expect(recommendModels("openai", list("gpt-6-sol", "gpt-6.1-sol", "gpt-6-luna"))).toEqual({ main: "gpt-6.1-sol", helper: "gpt-6.1-sol" });
    // An older key: the plain legacy flagship.
    expect(recommendModels("openai", list("gpt-5.4", "gpt-5.5", "gpt-5.5-mini", "gpt-5.5-pro")).main).toBe("gpt-5.5");
  });

  it("picks Gemini's flagship as main and a Flash model as helper, never a TTS, image, live or lite variant", () => {
    const models = list("gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.8-flash-image", "gemini-3.8-flash-live-preview", "gemini-3.8-flash-tts", "gemini-4-argon", "gemini-embedding-2");
    expect(recommendModels("gemini", models)).toEqual({ main: "gemini-4-argon", helper: "gemini-3.8-flash" });
    expect(recommendModels("gemini", list("gemini-3.1-pro-preview", "gemini-3.8-flash")).main).toBe("gemini-3.1-pro-preview");
    expect(recommendModels("gemini", list("gemini-3.8-flash", "gemini-3.5-flash-lite")).main).toBe("gemini-3.8-flash");
    expect(recommendModels("gemini", list("gemini-3.5-flash-lite")).helper).toBe("gemini-3.5-flash-lite");
  });

  it("never leaves a pattern unanchored where it could match a non-chat model", () => {
    for (const provider of ["openai", "gemini"] as const) {
      for (const pattern of [...RECOMMENDED_MODELS[provider]!.main, ...RECOMMENDED_MODELS[provider]!.helper]) {
        expect(pattern.source.startsWith("^") && pattern.source.endsWith("$"), String(pattern)).toBe(true);
      }
    }
  });
});
