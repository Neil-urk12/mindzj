import type { AiProviderConfig, AiProviderType } from "../settings";
import type { AdapterConfig, ProviderFamily } from "./types";
import { ANTHROPIC_ENDPOINT, DEEPSEEK_ENDPOINT, GEMINI_ENDPOINT, LMSTUDIO_ENDPOINT, OLLAMA_ENDPOINT, OPENAI_ENDPOINT, XAI_ENDPOINT } from "../../constants/apiEndpoints";

export const PROVIDER_DEFAULTS: Record<AiProviderType, AiProviderConfig> = {
  Ollama: {
    id: null,
    display_name: null,
    provider_type: "Ollama",
    endpoint: OLLAMA_ENDPOINT,
    api_key: null,
    has_api_key: false,
    model: "llama3.2",
  },
  LMStudio: {
    id: null,
    display_name: null,
    provider_type: "LMStudio",
    endpoint: LMSTUDIO_ENDPOINT,
    api_key: null,
    has_api_key: false,
    model: "local-model",
  },
  ApiKeyLLM: {
    id: null,
    display_name: null,
    provider_type: "ApiKeyLLM",
    endpoint: null,
    api_key: null,
    has_api_key: false,
    model: "",
  },
  OpenAI: {
    id: null,
    display_name: "OpenAI",
    provider_type: "OpenAI",
    endpoint: OPENAI_ENDPOINT,
    api_key: null,
    has_api_key: false,
    model: "gpt-5.5",
  },
  Claude: {
    id: null,
    display_name: "Claude",
    provider_type: "Claude",
    endpoint: ANTHROPIC_ENDPOINT,
    api_key: null,
    has_api_key: false,
    model: "claude-sonnet-4-6",
  },
  Grok: {
    id: null,
    display_name: "Grok",
    provider_type: "Grok",
    endpoint: XAI_ENDPOINT,
    api_key: null,
    has_api_key: false,
    model: "grok-4.20",
  },
  Gemini: {
    id: null,
    display_name: "Gemini",
    provider_type: "Gemini",
    endpoint: GEMINI_ENDPOINT,
    api_key: null,
    has_api_key: false,
    model: "gemini-3-flash-preview",
  },
  DeepSeek: {
    id: null,
    display_name: "DeepSeek",
    provider_type: "DeepSeek",
    endpoint: DEEPSEEK_ENDPOINT,
    api_key: null,
    has_api_key: false,
    model: "deepseek-v4-pro",
  },
  Custom: {
    id: null,
    display_name: "Custom",
    provider_type: "Custom",
    endpoint: null,
    api_key: null,
    has_api_key: false,
    model: "",
  },
};

export function normalizeProviderType(provider: AiProviderType): AiProviderType {
  return provider in PROVIDER_DEFAULTS ? provider : "ApiKeyLLM";
}

export function isLocalProviderType(provider: AiProviderType): boolean {
  return provider === "Ollama" || provider === "LMStudio";
}

export function providerBaseUrl(config: AiProviderConfig): string {
  const providerType = normalizeProviderType(config.provider_type);
  const fallback = !isLocalProviderType(providerType)
    ? defaultApiKeyEndpoint(config)
    : PROVIDER_DEFAULTS[providerType]?.endpoint ?? "";
  const base = (config.endpoint || fallback || "").replace(/\/+$/, "");
  if (inferProviderFamily(config) === "gemini") {
    return base
      .replace(/\/models\/[^/]+(?::(?:generateContent|streamGenerateContent))?$/i, "")
      .replace(/\/models$/i, "");
  }
  return base;
}

export function modelHint(config: AiProviderConfig): string {
  return `${config.display_name ?? ""} ${config.model ?? ""}`.toLowerCase();
}

export function inferProviderFamily(config: AiProviderConfig): ProviderFamily {
  const providerType = normalizeProviderType(config.provider_type);
  if (providerType === "Claude") return "anthropic";
  if (providerType === "Gemini") return "gemini";
  const endpoint = (config.endpoint ?? "").toLowerCase();
  const hint = modelHint(config);
  if (endpoint.includes("anthropic.com")) return "anthropic";
  if (endpoint.includes("generativelanguage.googleapis.com")) return "gemini";
  if (endpoint) return "openai-compatible";
  if (hint.includes("claude")) return "anthropic";
  if (hint.includes("gemini")) return "gemini";
  return "openai-compatible";
}

export function defaultApiKeyEndpoint(config: AiProviderConfig): string {
  const providerType = normalizeProviderType(config.provider_type);
  const providerDefault = !isLocalProviderType(providerType)
    ? PROVIDER_DEFAULTS[providerType]?.endpoint
    : null;
  if (providerDefault) return providerDefault;
  const family = inferProviderFamily(config);
  if (family === "anthropic") return ANTHROPIC_ENDPOINT;
  if (family === "gemini") return GEMINI_ENDPOINT;
  if (modelHint(config).includes("grok") || modelHint(config).includes("xai")) {
    return XAI_ENDPOINT;
  }
  if (modelHint(config).includes("deepseek")) return DEEPSEEK_ENDPOINT;
  return OPENAI_ENDPOINT;
}

export function isDeepSeekConfig(config: AiProviderConfig): boolean {
  const providerType = normalizeProviderType(config.provider_type);
  if (providerType === "DeepSeek") return true;
  return providerBaseUrl(config).toLowerCase().includes("deepseek.com")
    || modelHint(config).includes("deepseek");
}

export function providerNeedsRealKey(config: AiProviderConfig): boolean {
  return !isLocalProviderType(normalizeProviderType(config.provider_type));
}

export function configMatchesProvider(
  config: AiProviderConfig,
  providerId: string | null,
  providerType: AiProviderType | null,
): boolean {
  if (config.id) return config.id === providerId;
  if (providerType) return normalizeProviderType(config.provider_type) === normalizeProviderType(providerType);
  // Fallback: match by storage ID (covers callers that only have the storage key)
  if (providerId) return providerStorageId(config) === providerId;
  return false;
}

export function providerStorageId(config: AiProviderConfig): string {
  return config.id ?? normalizeProviderType(config.provider_type);
}

export function stripCopiedModelPath(value: string): string {
  let model = value.trim().replace(/^["']|["']$/g, "");
  if (!model) return "";
  try {
    if (/^https?:\/\//i.test(model)) {
      const url = new URL(model);
      model = url.pathname;
    }
  } catch {
    // Keep the original value; the provider will report a precise error.
  }
  model = model
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/:(?:generateContent|streamGenerateContent)$/i, "");
  const modelsMatch = model.match(/(?:^|\/)models\/([^/:]+)$/i);
  if (modelsMatch?.[1]) return modelsMatch[1];
  return model;
}

export function openAiCompatibleModelId(config: AiProviderConfig): string {
  let model = stripCopiedModelPath(config.model).replace(/^models\//i, "");
  const base = providerBaseUrl(config).toLowerCase();
  const preserveProviderPrefix = base.includes("openrouter.ai");
  if (!preserveProviderPrefix && model.includes("/")) {
    model = model.split("/").filter(Boolean).pop() ?? model;
  }
  return model;
}

export function geminiModelPath(model: string): string {
  let id = stripCopiedModelPath(model)
    .replace(/^models\//i, "")
    .replace(/^(?:google|gemini)\//i, "");
  if (id.includes("/")) {
    const last = id.split("/").filter(Boolean).pop();
    if (last?.toLowerCase().startsWith("gemini-")) id = last;
  }
  return `models/${id}`;
}

/** Resolve AiProviderConfig + apiKey → AdapterConfig for the matching adapter */
export function resolveAdapterConfig(
  config: AiProviderConfig,
  apiKey: string | null,
): AdapterConfig {
  const family = inferProviderFamily(config);
  const base = providerBaseUrl(config);

  let endpoint: string;
  let authHeaders: Record<string, string>;
  let model: string;

  switch (family) {
    case "anthropic":
      endpoint = `${base}/messages`;
      authHeaders = apiKey
        ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        : {};
      model = config.model;
      break;
    case "gemini":
      endpoint = `${base}/${geminiModelPath(config.model)}:generateContent`;
      authHeaders = apiKey ? { "x-goog-api-key": apiKey } : {};
      model = config.model;
      break;
    default:
      endpoint = `${base}/chat/completions`;
      authHeaders = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      model = openAiCompatibleModelId(config);
      break;
  }

  return { endpoint, authHeaders, model };
}

export function parseProviderErrorPayload(raw: string): { status?: string; message: string; code?: string; type?: string; param?: string | null } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{3})(?::\s*)?([\s\S]*)$/);
  const status = match?.[1];
  const body = (match?.[2] ?? trimmed).trim();
  if (!body) return { status, message: trimmed };
  try {
    const parsed = JSON.parse(body);
    const error = parsed?.error ?? parsed;
    return {
      status,
      message: String(error?.message ?? parsed?.message ?? body),
      code: error?.code != null ? String(error.code) : parsed?.code != null ? String(parsed.code) : undefined,
      type: error?.type != null ? String(error.type) : undefined,
      param: error?.param ?? null,
    };
  } catch {
    const message = body
      .replace(/^\{|\}$/g, "")
      .replace(/\bmessage\s*:\s*/i, "")
      .replace(/\bstatus\s*:\s*/i, "status: ")
      .trim();
    return { status, message: message || trimmed };
  }
}

export function formatAiProviderError(error: any): string {
  const raw = String(error?.message ?? error ?? "").trim();
  const payload = parseProviderErrorPayload(raw);
  const lower = payload.message.toLowerCase();
  const status = payload.status ? `${payload.status}: ` : "";
  let hint = "";
  if (lower.includes("generatecontentrequest.model") || lower.includes("unexpected model name format")) {
    hint = " Gemini 模型名格式不正确。请填写类似 gemini-1.5-flash、gemini-2.0-flash 或 models/gemini-2.0-flash 的模型名，不要填写完整 URL。";
  } else if (lower.includes("invalid model id") || lower.includes("invalid model")) {
    hint = " 模型 ID 无效。请确认模型名、API Key 和 endpoint 属于同一家服务；OpenAI/xAI 通常不要使用 models/ 前缀。";
  }
  return `${status}${payload.message}${hint}`.trim();
}