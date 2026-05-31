import type { ChatCompletionAdapter, ChatMessage, ToolDefinition, AdapterConfig, AiTransport, NormalizedResponse, GeminiContentPart } from "./types";
import { parseJsonObject } from "./types";

function toGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "additionalProperties") continue;
    result[key] = key === "type" && typeof entry === "string"
      ? entry.toUpperCase()
      : toGeminiSchema(entry);
  }
  return result;
}

function geminiToolDefinitions(tools: ToolDefinition[]) {
  return [{
    functionDeclarations: tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: toGeminiSchema(tool.function.parameters),
    })),
  }];
}

function geminiMessages(messages: ChatMessage[]) {
  const systemParts: Array<{ text: string }> = [];
  const contents: Array<{ role: string; parts: Array<{ text: string } | { functionCall: { name: string; args: Record<string, unknown> } } | { functionResponse: { name: string; response: unknown } }> }> = [];
  const toolNames = new Map<string, string>();

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) systemParts.push({ text: message.content });
      continue;
    }
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content ?? "" }] });
      continue;
    }
    if (message.role === "assistant") {
      const parts: Array<{ text: string } | { functionCall: { name: string; args: Record<string, unknown> } }> = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.tool_calls ?? []) {
        toolNames.set(call.id, call.function.name);
        parts.push({
          functionCall: {
            name: call.function.name,
            args: parseJsonObject(call.function.arguments) ?? {},
          },
        });
      }
      contents.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] });
      continue;
    }
    if (message.role === "tool" && message.tool_call_id) {
      const toolName = toolNames.get(message.tool_call_id) ?? "tool_result";
      const parsed = message.content ? parseJsonObject(message.content) : null;
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: toolName,
            response: parsed ?? { content: message.content ?? "" },
          },
        }],
      });
    }
  }

  return {
    systemInstruction: systemParts.length ? { parts: systemParts } : undefined,
    contents,
  };
}

export function normalizeGeminiResponse(data: unknown): NormalizedResponse {
  const resp = (typeof data === "object" && data !== null ? data : null) as Record<string, unknown> | null;
  const rawCandidates = resp?.candidates;
  const candidates = Array.isArray(rawCandidates) ? rawCandidates as Array<Record<string, unknown>> : [];
  const first = candidates[0];
  const firstContent = first && typeof first.content === "object" && first.content !== null ? first.content as Record<string, unknown> : null;
  const parts: GeminiContentPart[] = Array.isArray(firstContent?.parts) ? firstContent.parts as GeminiContentPart[] : [];
  const text = parts
    .filter((part): part is { text: string } => typeof part?.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  const toolCalls = parts
    .filter((part): part is { functionCall: { name: string; args?: Record<string, unknown> } } =>
      "functionCall" in part && !!part.functionCall?.name
    )
    .map((part, index) => ({
      id: `gemini-tool-${index}`,
      type: "function" as const,
      function: {
        name: String(part.functionCall.name),
        arguments: JSON.stringify(part.functionCall.args ?? {}),
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

const geminiAdapter: ChatCompletionAdapter = {
  async sendCompletion(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: AdapterConfig,
    transport: AiTransport,
  ): Promise<NormalizedResponse> {
    const converted = geminiMessages(messages);
    const raw = await transport(config.endpoint, config.authHeaders, {
      ...converted,
      ...(tools.length
        ? {
            tools: geminiToolDefinitions(tools),
            toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          }
        : {}),
    });
    return normalizeGeminiResponse(raw);
  },
};

export default geminiAdapter;
