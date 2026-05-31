import type { AiProviderConfig } from "../settings";
import type { ChatCompletionAdapter, ChatMessage, ToolDefinition, AdapterConfig, AiTransport, NormalizedResponse } from "./types";
import { isDeepSeekConfig } from "./router";

const openAiAdapter: ChatCompletionAdapter = {
  async sendCompletion(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: AdapterConfig,
    transport: AiTransport,
  ): Promise<NormalizedResponse> {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    };
    const raw = await transport(config.endpoint, config.authHeaders, body);
    return normalizeOpenAIResponse(raw);
  },
};

export default openAiAdapter;

/** Normalize raw OpenAI-compatible response to standard shape */
export function normalizeOpenAIResponse(data: unknown): NormalizedResponse {
  const resp = (typeof data === "object" && data !== null ? data : null) as Record<string, unknown> | null;
  const rawChoices = resp?.choices;
  const choices: unknown[] = Array.isArray(rawChoices) ? rawChoices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const msg = (first && typeof first.message === "object" && first.message !== null
    ? first.message
    : null) as Record<string, unknown> | null;
  const content = typeof msg?.content === "string" ? msg.content : null;
  const rawToolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
  const toolCalls = rawToolCalls
    .filter((tc): tc is { id?: unknown; function: { name: string; arguments?: unknown } } => {
      if (typeof tc !== "object" || tc === null) return false;
      const fn = (tc as Record<string, unknown>).function;
      return typeof fn === "object" && fn !== null && typeof (fn as Record<string, unknown>).name === "string";
    })
    .map((tc, index) => ({
      id: String(tc.id ?? `openai-tool-${index}`),
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: String(tc.function.arguments ?? "{}"),
      },
    }));
  return {
    choices: [{
      message: {
        role: "assistant",
        content,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
    }],
  };
}

/** Preserve DeepSeek reasoning_content across conversation turns */
export function normalizeAssistantMessageForHistory(
  message: ChatMessage,
  config: AiProviderConfig,
): ChatMessage {
  const result: ChatMessage = {
    role: "assistant",
    content: message.content ?? null,
    tool_calls: message.tool_calls,
  };
  if (isDeepSeekConfig(config) && typeof message.reasoning_content === "string") {
    result.reasoning_content = message.reasoning_content;
  }
  return result;
}
