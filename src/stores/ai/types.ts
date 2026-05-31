
/** Canonical message type for adapter input */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string | null;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ── Provider-specific raw response types ──────────────────────────

/** Anthropic API response content part */
export interface AnthropicTextPart {
  type: "text";
  text: string;
}

export interface AnthropicToolUsePart {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AnthropicContentPart = AnthropicTextPart | AnthropicToolUsePart;

/** Raw Anthropic Messages API response */
export interface AnthropicResponse {
  content: AnthropicContentPart[];
  stop_reason?: string;
  model?: string;
}

/** Gemini API response content part */
export interface GeminiTextPart {
  text: string;
}

export interface GeminiFunctionCallPart {
  functionCall: {
    name: string;
    args?: Record<string, unknown>;
  };
}

export type GeminiContentPart = GeminiTextPart | GeminiFunctionCallPart;

/** Raw Gemini generateContent API response */
export interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts: GeminiContentPart[];
    };
    finishReason?: string;
  }>;
}

/** Raw OpenAI Chat Completions API response */
export interface OpenAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
}

/** Normalized response — all adapters return this shape */
export interface NormalizedResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
}

/** Pre-resolved config the router passes to adapters */
export interface AdapterConfig {
  endpoint: string;
  authHeaders: Record<string, string>;
  model: string;
}

/** Transport function injected into adapters */
export type AiTransport = (
  url: string,
  headers: Record<string, string>,
  body: unknown,
) => Promise<unknown>;

/** The adapter interface */
export interface ChatCompletionAdapter {
  sendCompletion(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: AdapterConfig,
    transport: AiTransport,
  ): Promise<NormalizedResponse>;
}

export type ProviderFamily = "openai-compatible" | "anthropic" | "gemini";

/** Parse JSON from LLM output, tolerating markdown fences and surrounding text */
export function parseJsonObject(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Result type returned by tool execution handlers */
export type ToolResult = {
  ok: boolean;
  message?: string;
  data?: unknown;
};

/** Context passed to tool execution to enforce active-file restrictions */
export interface ToolExecutionContext {
  restrictToActiveFile: boolean;
  activePath: string | null;
  hasExplicitPath: boolean;
}
