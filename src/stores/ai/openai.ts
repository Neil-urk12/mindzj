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
    return raw as NormalizedResponse;
  },
};

export default openAiAdapter;

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
