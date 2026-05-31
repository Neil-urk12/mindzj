import type { ChatCompletionAdapter, ChatMessage, ToolDefinition, AdapterConfig, AiTransport, NormalizedResponse, AnthropicContentPart } from "./types";
import { parseJsonObject } from "./types";
import { AI_MAX_TOKENS } from "../../constants/timeouts";

function anthropicToolDefinitions(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

function anthropicMessages(messages: ChatMessage[]) {
  const system: string[] = [];
  const result: Array<{ role: string; content: string | AnthropicContentPart[] }> = [];
  let pendingToolResults: Array<{ type: string; tool_use_id: string; content: string; is_error?: boolean }> = [];

  const flushToolResults = () => {
    if (!pendingToolResults.length) return;
    result.push({ role: "user", content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) system.push(message.content);
      continue;
    }
    if (message.role === "user") {
      flushToolResults();
      result.push({ role: "user", content: message.content ?? "" });
      continue;
    }
    if (message.role === "assistant") {
      flushToolResults();
      const content: AnthropicContentPart[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.tool_calls ?? []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: parseJsonObject(call.function.arguments) ?? {},
        });
      }
      result.push({ role: "assistant", content: content.length ? content : "" });
      continue;
    }
    if (message.role === "tool" && message.tool_call_id) {
      const parsed = message.content ? parseJsonObject(message.content) : null;
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: message.content ?? "",
        ...(parsed?.ok === false ? { is_error: true } : {}),
      });
    }
  }
  flushToolResults();

  return { system: system.join("\n\n"), messages: result };
}

export function normalizeAnthropicResponse(data: unknown): NormalizedResponse {
  const resp = (typeof data === "object" && data !== null ? data : null) as Record<string, unknown> | null;
  const rawParts = resp?.content;
  const parts: AnthropicContentPart[] = Array.isArray(rawParts) ? rawParts as AnthropicContentPart[] : [];
  const text = parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  const toolCalls = parts
    .filter((part): part is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
      part.type === "tool_use" && "name" in part && !!part.name
    )
    .map((part, index) => ({
      id: String(part.id ?? `anthropic-tool-${index}`),
      type: "function" as const,
      function: {
        name: String(part.name),
        arguments: JSON.stringify(part.input ?? {}),
      },
    }));
  return {
    choices: [{
      message: {
        role: "assistant",
        content: text || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
    }],
  };
}

const anthropicAdapter: ChatCompletionAdapter = {
  async sendCompletion(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: AdapterConfig,
    transport: AiTransport,
  ): Promise<NormalizedResponse> {
    const converted = anthropicMessages(messages);
    const raw = await transport(config.endpoint, config.authHeaders, {
      model: config.model,
      max_tokens: AI_MAX_TOKENS,
      messages: converted.messages,
      ...(converted.system ? { system: converted.system } : {}),
      ...(tools.length ? { tools: anthropicToolDefinitions(tools) } : {}),
    });
    return normalizeAnthropicResponse(raw);
  },
};

export default anthropicAdapter;
