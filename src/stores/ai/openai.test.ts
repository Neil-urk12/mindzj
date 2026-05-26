import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatMessage, ToolDefinition, AdapterConfig, AiTransport } from "./types";

// ── Tests ────────────────────────────────────────────────────────

describe("openai adapter", () => {
    let openaiAdapter: typeof import("./openai").default;

    beforeEach(async () => {
        vi.resetModules();
        openaiAdapter = (await import("./openai")).default;
    });

    const makeConfig = (overrides?: Partial<AdapterConfig>): AdapterConfig => ({
        endpoint: "https://api.openai.com/v1/chat/completions",
        authHeaders: { Authorization: "Bearer sk-test" },
        model: "gpt-5.5",
        ...overrides,
    });

    // ── sendCompletion ──────────────────────────────────────────

    describe("sendCompletion", () => {
        it("sends correct request body to transport", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                choices: [{ message: { role: "assistant", content: "Hello" } }],
            });

            const messages: ChatMessage[] = [
                { role: "user", content: "Hi", tool_calls: undefined },
            ];

            await openaiAdapter.sendCompletion(messages, [], makeConfig(), transport);

            expect(transport).toHaveBeenCalledWith(
                "https://api.openai.com/v1/chat/completions",
                { Authorization: "Bearer sk-test" },
                {
                    model: "gpt-5.5",
                    messages: [{ role: "user", content: "Hi", tool_calls: undefined }],
                },
            );
        });

        it("includes tools and tool_choice when tools provided", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                choices: [{ message: { role: "assistant", content: "ok" } }],
            });

            const tools: ToolDefinition[] = [{
                type: "function",
                function: {
                    name: "search",
                    description: "Search the web",
                    parameters: { type: "object", properties: {} },
                },
            }];

            await openaiAdapter.sendCompletion([], tools, makeConfig(), transport);

            const body = (transport as any).mock.calls[0][2];
            expect(body.tools).toHaveLength(1);
            expect(body.tools[0].function.name).toBe("search");
            expect(body.tool_choice).toBe("auto");
        });

        it("omits tools and tool_choice when tools array is empty", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                choices: [{ message: { role: "assistant", content: "ok" } }],
            });

            await openaiAdapter.sendCompletion([], [], makeConfig(), transport);

            const body = (transport as any).mock.calls[0][2];
            expect(body.tools).toBeUndefined();
            expect(body.tool_choice).toBeUndefined();
        });

        it("passes response through as NormalizedResponse", async () => {
            const mockResponse = {
                choices: [{
                    message: {
                        role: "assistant",
                        content: "test response",
                    },
                    finish_reason: "stop",
                }],
            };
            const transport: AiTransport = vi.fn().mockResolvedValue(mockResponse);

            const result = await openaiAdapter.sendCompletion(
                [{ role: "user", content: "test", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result).toEqual(mockResponse);
        });

        it("returns tool_calls when response includes them", async () => {
            const mockResponse = {
                choices: [{
                    message: {
                        role: "assistant",
                        content: null,
                        tool_calls: [{
                            id: "call_123",
                            type: "function" as const,
                            function: {
                                name: "search",
                                arguments: '{"query":"test"}',
                            },
                        }],
                    },
                    finish_reason: "tool_calls",
                }],
            };
            const transport: AiTransport = vi.fn().mockResolvedValue(mockResponse);

            const result = await openaiAdapter.sendCompletion(
                [{ role: "user", content: "search for test", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.tool_calls).toHaveLength(1);
            expect(result.choices[0].message.tool_calls![0].function.name).toBe("search");
        });
    });

    // ── normalizeAssistantMessageForHistory ──────────────────────

    describe("normalizeAssistantMessageForHistory", () => {
        let normalizeAssistantMessageForHistory: typeof import("./openai").normalizeAssistantMessageForHistory;

        beforeEach(async () => {
            const mod = await import("./openai");
            normalizeAssistantMessageForHistory = mod.normalizeAssistantMessageForHistory;
        });

        it("creates a clean assistant message", () => {
            const result = normalizeAssistantMessageForHistory(
                {
                    role: "assistant",
                    content: "Hello there",
                    tool_calls: undefined,
                },
                {
                    id: null, display_name: "OpenAI", provider_type: "OpenAI",
                    endpoint: "https://api.openai.com/v1", api_key: null,
                    has_api_key: false, model: "gpt-5.5",
                },
            );

            expect(result.role).toBe("assistant");
            expect(result.content).toBe("Hello there");
        });

        it("preserves tool_calls", () => {
            const toolCalls = [{
                id: "call_1",
                type: "function" as const,
                function: { name: "search", arguments: "{}" },
            }];

            const result = normalizeAssistantMessageForHistory(
                { role: "assistant", content: null, tool_calls: toolCalls },
                {
                    id: null, display_name: "OpenAI", provider_type: "OpenAI",
                    endpoint: "https://api.openai.com/v1", api_key: null,
                    has_api_key: false, model: "gpt-5.5",
                },
            );

            expect(result.tool_calls).toEqual(toolCalls);
        });

        it("preserves reasoning_content for DeepSeek config", () => {
            const result = normalizeAssistantMessageForHistory(
                {
                    role: "assistant",
                    content: "Answer",
                    tool_calls: undefined,
                    reasoning_content: "Let me think...",
                },
                {
                    id: null, display_name: "DeepSeek", provider_type: "DeepSeek",
                    endpoint: "https://api.deepseek.com", api_key: null,
                    has_api_key: false, model: "deepseek-v4-pro",
                },
            );

            expect(result.reasoning_content).toBe("Let me think...");
        });

        it("drops reasoning_content for non-DeepSeek config", () => {
            const result = normalizeAssistantMessageForHistory(
                {
                    role: "assistant",
                    content: "Answer",
                    tool_calls: undefined,
                    reasoning_content: "Let me think...",
                },
                {
                    id: null, display_name: "OpenAI", provider_type: "OpenAI",
                    endpoint: "https://api.openai.com/v1", api_key: null,
                    has_api_key: false, model: "gpt-5.5",
                },
            );

            expect(result.reasoning_content).toBeUndefined();
        });
    });
});
