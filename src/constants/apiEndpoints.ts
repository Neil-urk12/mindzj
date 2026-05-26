/** Centralized AI provider API endpoint URLs. */

export const OLLAMA_ENDPOINT = "http://localhost:11434/v1";
export const LMSTUDIO_ENDPOINT = "http://localhost:1234/v1";
export const OPENAI_ENDPOINT = "https://api.openai.com/v1";
export const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1";
export const XAI_ENDPOINT = "https://api.x.ai/v1";
export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com";

/** Maps provider type names to their default API endpoint URLs. */
export const DEFAULT_ENDPOINTS = {
  Ollama: OLLAMA_ENDPOINT,
  LMStudio: LMSTUDIO_ENDPOINT,
  OpenAI: OPENAI_ENDPOINT,
  Claude: ANTHROPIC_ENDPOINT,
  Grok: XAI_ENDPOINT,
  Gemini: GEMINI_ENDPOINT,
  DeepSeek: DEEPSEEK_ENDPOINT,
} as const;

export type ProviderName = keyof typeof DEFAULT_ENDPOINTS;
