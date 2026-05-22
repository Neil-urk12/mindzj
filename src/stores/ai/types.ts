
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
export function parseJsonObject(value: string): any | null {
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
