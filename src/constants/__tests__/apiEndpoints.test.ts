import { describe, it, expect } from "vitest";

// This import will FAIL because src/constants/apiEndpoints.ts does not exist yet.
// Once created, it must export the centralized endpoint constants.
import {
  DEFAULT_ENDPOINTS,
  OLLAMA_ENDPOINT,
  LMSTUDIO_ENDPOINT,
  OPENAI_ENDPOINT,
  ANTHROPIC_ENDPOINT,
  XAI_ENDPOINT,
  GEMINI_ENDPOINT,
  DEEPSEEK_ENDPOINT,
} from "../apiEndpoints";

// ---------------------------------------------------------------------------
// Expected values — extracted from src/stores/ai/router.ts PROVIDER_DEFAULTS
// and src/components/settings/AiSettingsPanel.tsx aiOnlineEndpointPlaceholder
// ---------------------------------------------------------------------------

const EXPECTED_ENDPOINTS = {
  Ollama: "http://localhost:11434/v1",
  LMStudio: "http://localhost:1234/v1",
  OpenAI: "https://api.openai.com/v1",
  Claude: "https://api.anthropic.com/v1",
  Grok: "https://api.x.ai/v1",
  Gemini: "https://generativelanguage.googleapis.com/v1beta",
  DeepSeek: "https://api.deepseek.com",
} as const;

const PROVIDER_KEYS = Object.keys(EXPECTED_ENDPOINTS) as Array<
  keyof typeof EXPECTED_ENDPOINTS
>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("apiEndpoints", () => {
  describe("DEFAULT_ENDPOINTS", () => {
    it("exists as an object", () => {
      expect(DEFAULT_ENDPOINTS).toBeDefined();
      expect(typeof DEFAULT_ENDPOINTS).toBe("object");
    });

    it("contains entries for all 7 providers", () => {
      for (const provider of PROVIDER_KEYS) {
        expect(DEFAULT_ENDPOINTS).toHaveProperty(provider);
      }
      expect(Object.keys(DEFAULT_ENDPOINTS)).toHaveLength(PROVIDER_KEYS.length);
    });

    it("each value matches the expected endpoint URL", () => {
      for (const provider of PROVIDER_KEYS) {
        expect(DEFAULT_ENDPOINTS[provider]).toBe(EXPECTED_ENDPOINTS[provider]);
      }
    });

    it("every endpoint is a valid URL string", () => {
      for (const [provider, url] of Object.entries(DEFAULT_ENDPOINTS)) {
        expect(typeof url).toBe("string");
        expect(url.length).toBeGreaterThan(0);
        // URL constructor throws on invalid URLs
        expect(() => new URL(url), `${provider} endpoint "${url}" is not a valid URL`).not.toThrow();
      }
    });
  });

  describe("named constant exports", () => {
    it("OLLAMA_ENDPOINT matches Ollama default", () => {
      expect(OLLAMA_ENDPOINT).toBe(EXPECTED_ENDPOINTS.Ollama);
    });

    it("LMSTUDIO_ENDPOINT matches LMStudio default", () => {
      expect(LMSTUDIO_ENDPOINT).toBe(EXPECTED_ENDPOINTS.LMStudio);
    });

    it("OPENAI_ENDPOINT matches OpenAI default", () => {
      expect(OPENAI_ENDPOINT).toBe(EXPECTED_ENDPOINTS.OpenAI);
    });

    it("ANTHROPIC_ENDPOINT matches Anthropic (Claude) default", () => {
      expect(ANTHROPIC_ENDPOINT).toBe(EXPECTED_ENDPOINTS.Claude);
    });

    it("XAI_ENDPOINT matches Grok/xAI default", () => {
      expect(XAI_ENDPOINT).toBe(EXPECTED_ENDPOINTS.Grok);
    });

    it("GEMINI_ENDPOINT matches Gemini default", () => {
      expect(GEMINI_ENDPOINT).toBe(EXPECTED_ENDPOINTS.Gemini);
    });

    it("DEEPSEEK_ENDPOINT matches DeepSeek default", () => {
      expect(DEEPSEEK_ENDPOINT).toBe(EXPECTED_ENDPOINTS.DeepSeek);
    });

    it("each named constant equals the corresponding DEFAULT_ENDPOINTS entry", () => {
      expect(OLLAMA_ENDPOINT).toBe(DEFAULT_ENDPOINTS.Ollama);
      expect(LMSTUDIO_ENDPOINT).toBe(DEFAULT_ENDPOINTS.LMStudio);
      expect(OPENAI_ENDPOINT).toBe(DEFAULT_ENDPOINTS.OpenAI);
      expect(ANTHROPIC_ENDPOINT).toBe(DEFAULT_ENDPOINTS.Claude);
      expect(XAI_ENDPOINT).toBe(DEFAULT_ENDPOINTS.Grok);
      expect(GEMINI_ENDPOINT).toBe(DEFAULT_ENDPOINTS.Gemini);
      expect(DEEPSEEK_ENDPOINT).toBe(DEFAULT_ENDPOINTS.DeepSeek);
    });
  });

  describe("router.ts uses centralized constants", () => {
    it("PROVIDER_DEFAULTS in router.ts references apiEndpoints for endpoint values", async () => {
      // Dynamic import so the test body compiles even when this assertion
      // needs the actual router module to be refactored later.
      const router = await import("../../stores/ai/router");
      const defaults = router.PROVIDER_DEFAULTS;

      // Confirm the router module is loaded and has the expected shape
      expect(defaults).toBeDefined();
      expect(defaults.Ollama).toBeDefined();

      // After refactoring, these MUST match the centralized constants.
      // For now, assert against the known values to catch drift.
      expect(defaults.Ollama.endpoint).toBe(DEFAULT_ENDPOINTS.Ollama);
      expect(defaults.LMStudio.endpoint).toBe(DEFAULT_ENDPOINTS.LMStudio);
      expect(defaults.OpenAI.endpoint).toBe(DEFAULT_ENDPOINTS.OpenAI);
      expect(defaults.Claude.endpoint).toBe(DEFAULT_ENDPOINTS.Claude);
      expect(defaults.Grok.endpoint).toBe(DEFAULT_ENDPOINTS.Grok);
      expect(defaults.Gemini.endpoint).toBe(DEFAULT_ENDPOINTS.Gemini);
      expect(defaults.DeepSeek.endpoint).toBe(DEFAULT_ENDPOINTS.DeepSeek);
    });
  });
});
