import type { ChatCompletionAdapter, ChatMessage, ToolDefinition, AdapterConfig, AiTransport, NormalizedResponse } from "./types";
import { parseJsonObject } from "./types";

function anthropicToolDefinitions(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

function anthropicMessages(messages: ChatMessage[]) {
  const system: string[] = [];
  const result: any[] = [];
  let pendingToolResults: any[] = [];

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
      const content: any[] = [];
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

function normalizeAnthropicResponse(data: any): NormalizedResponse {
  const parts = Array.isArray(data?.content) ? data.content : [];
  const text = parts
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
  const toolCalls = parts
    .filter((part: any) => part?.type === "tool_use" && part.name)
    .map((part: any, index: number) => ({
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
      max_tokens: 4096,
      messages: converted.messages,
      ...(converted.system ? { system: converted.system } : {}),
      ...(tools.length ? { tools: anthropicToolDefinitions(tools) } : {}),
    });
    return normalizeAnthropicResponse(raw);
  },
};

export default anthropicAdapter;
