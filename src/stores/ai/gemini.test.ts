import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatMessage, ToolDefinition, AdapterConfig, AiTransport } from "./types";

// ── Tests ────────────────────────────────────────────────────────

describe("gemini adapter", () => {
    let geminiAdapter: typeof import("./gemini").default;

    beforeEach(async () => {
        vi.resetModules();
        geminiAdapter = (await import("./gemini")).default;
    });

    const makeConfig = (overrides?: Partial<AdapterConfig>): AdapterConfig => ({
        endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
        authHeaders: { "x-goog-api-key": "google-key-123" },
        model: "gemini-3-flash-preview",
        ...overrides,
    });

    // ── sendCompletion — request formatting ─────────────────────

    describe("sendCompletion — request formatting", () => {
        it("sends correct endpoint and auth headers", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "Hello" }] } }],
            });

            await geminiAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(transport).toHaveBeenCalledWith(
                makeConfig().endpoint,
                { "x-goog-api-key": "google-key-123" },
                expect.any(Object),
            );
        });

        it("converts user message to contents with role 'user'", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            await geminiAdapter.sendCompletion(
                [{ role: "user", content: "Hello!", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            expect(body.contents).toEqual([{
                role: "user",
                parts: [{ text: "Hello!" }],
            }]);
        });

        it("converts system messages to systemInstruction", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            await geminiAdapter.sendCompletion(
                [
                    { role: "system", content: "You are a helpful assistant.", tool_calls: undefined },
                    { role: "user", content: "Hi", tool_calls: undefined },
                ],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            expect(body.systemInstruction).toEqual({
                parts: [{ text: "You are a helpful assistant." }],
            });
            // System message should not appear in contents
            expect(body.contents.every((c: any) => c.role !== "system")).toBe(true);
        });

        it("omits systemInstruction when no system messages", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            await geminiAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            expect(body.systemInstruction).toBeUndefined();
        });

        it("converts assistant message to role 'model'", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            await geminiAdapter.sendCompletion(
                [
                    { role: "user", content: "Hi", tool_calls: undefined },
                    { role: "assistant", content: "Hello!", tool_calls: undefined },
                    { role: "user", content: "Bye", tool_calls: undefined },
                ],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            expect(body.contents[1]).toEqual({
                role: "model",
                parts: [{ text: "Hello!" }],
            });
        });

        it("converts tool_calls to functionCall parts", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            await geminiAdapter.sendCompletion(
                [
                    { role: "user", content: "search", tool_calls: undefined },
                    {
                        role: "assistant",
                        content: "Let me search.",
                        tool_calls: [{
                            id: "call_1",
                            type: "function",
                            function: { name: "search", arguments: '{"query":"test"}' },
                        }],
                    },
                ],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            const modelMsg = body.contents[1];
            expect(modelMsg.parts).toEqual(
                expect.arrayContaining([
                    { text: "Let me search." },
                    { functionCall: { name: "search", args: { query: "test" } } },
                ]),
            );
        });

        it("converts tool results to functionResponse with role 'user'", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            await geminiAdapter.sendCompletion(
                [
                    {
                        role: "assistant",
                        content: null,
                        tool_calls: [{
                            id: "call_1",
                            type: "function",
                            function: { name: "search", arguments: '{"q":"x"}' },
                        }],
                    },
                    {
                        role: "tool",
                        content: '{"found":true}',
                        tool_call_id: "call_1",
                    },
                ],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            // Tool result should be a user message with functionResponse
            const toolResultMsg = body.contents.find((c: any) =>
                c.role === "user" && c.parts?.[0]?.functionResponse
            );
            expect(toolResultMsg).toBeDefined();
            expect(toolResultMsg.parts[0]).toEqual({
                functionResponse: {
                    name: "search",
                    response: { found: true },
                },
            });
        });

        it("uses fallback tool name 'tool_result' when call_id not tracked", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            await geminiAdapter.sendCompletion(
                [
                    // No prior assistant message with tool_calls
                    {
                        role: "tool",
                        content: '{"result":"data"}',
                        tool_call_id: "unknown_call_id",
                    },
                ],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            const toolResultMsg = body.contents[0];
            expect(toolResultMsg.parts[0].functionResponse.name).toBe("tool_result");
        });

        it("includes tools in gemini format when provided", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            const tools: ToolDefinition[] = [{
                type: "function",
                function: {
                    name: "search",
                    description: "Search the web",
                    parameters: {
                        type: "object",
                        properties: { query: { type: "string" } },
                    },
                },
            }];

            await geminiAdapter.sendCompletion([], tools, makeConfig(), transport);

            const body = (transport as any).mock.calls[0][2];
            expect(body.tools).toEqual([{
                functionDeclarations: [{
                    name: "search",
                    description: "Search the web",
                    parameters: {
                        type: "OBJECT",
                        properties: { query: { type: "STRING" } },
                    },
                }],
            }]);
            expect(body.toolConfig).toEqual({
                functionCallingConfig: { mode: "AUTO" },
            });
        });

        it("omits tools when array is empty", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            await geminiAdapter.sendCompletion([], [], makeConfig(), transport);

            const body = (transport as any).mock.calls[0][2];
            expect(body.tools).toBeUndefined();
            expect(body.toolConfig).toBeUndefined();
        });

        it("uppercases types in gemini tool schema", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            const tools: ToolDefinition[] = [{
                type: "function",
                function: {
                    name: "calc",
                    description: "Calculator",
                    parameters: {
                        type: "object",
                        properties: {
                            num: { type: "number" },
                            flag: { type: "boolean" },
                        },
                    },
                },
            }];

            await geminiAdapter.sendCompletion([], tools, makeConfig(), transport);

            const body = (transport as any).mock.calls[0][2];
            const params = body.tools[0].functionDeclarations[0].parameters;
            expect(params.type).toBe("OBJECT");
            expect(params.properties.num.type).toBe("NUMBER");
            expect(params.properties.flag.type).toBe("BOOLEAN");
        });

        it("strips additionalProperties from gemini tool schema", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "ok" }] } }],
            });

            const tools: ToolDefinition[] = [{
                type: "function",
                function: {
                    name: "test",
                    description: "test",
                    parameters: {
                        type: "object",
                        properties: {},
                        additionalProperties: false,
                    },
                },
            }];

            await geminiAdapter.sendCompletion([], tools, makeConfig(), transport);

            const body = (transport as any).mock.calls[0][2];
            const params = body.tools[0].functionDeclarations[0].parameters;
            expect(params.additionalProperties).toBeUndefined();
        });
    });

    // ── sendCompletion — response normalization ──────────────────

    describe("sendCompletion — response normalization", () => {
        it("extracts text from gemini response", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "Hello world" }] } }],
            });

            const result = await geminiAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.content).toBe("Hello world");
            expect(result.choices[0].message.role).toBe("assistant");
        });

        it("joins multiple text parts with newline", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "Part 1" }, { text: "Part 2" }] } }],
            });

            const result = await geminiAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.content).toBe("Part 1\nPart 2");
        });

        it("extracts functionCall parts as tool_calls", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{
                    content: {
                        parts: [{
                            functionCall: {
                                name: "search",
                                args: { query: "test" },
                            },
                        }],
                    },
                }],
            });

            const result = await geminiAdapter.sendCompletion(
                [{ role: "user", content: "search", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.tool_calls).toHaveLength(1);
            expect(result.choices[0].message.tool_calls![0]).toEqual({
                id: "gemini-tool-0",
                type: "function",
                function: {
                    name: "search",
                    arguments: '{"query":"test"}',
                },
            });
        });

        it("returns undefined tool_calls when no functionCall parts", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: "Just text" }] } }],
            });

            const result = await geminiAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.tool_calls).toBeUndefined();
        });

        it("handles mixed text and functionCall parts", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{
                    content: {
                        parts: [
                            { text: "Let me look that up." },
                            { functionCall: { name: "search", args: { query: "hello" } } },
                        ],
                    },
                }],
            });

            const result = await geminiAdapter.sendCompletion(
                [{ role: "user", content: "find hello", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.content).toBe("Let me look that up.");
            expect(result.choices[0].message.tool_calls).toHaveLength(1);
        });

        it("handles empty candidates gracefully", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [],
            });

            const result = await geminiAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.content).toBeNull();
        });

        it("handles missing candidates field gracefully", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({});

            const result = await geminiAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.content).toBeNull();
        });

        it("handles empty parts array gracefully", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{ content: { parts: [] } }],
            });

            const result = await geminiAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.content).toBeNull();
        });

        it("generates sequential ids for multiple tool calls", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{
                    content: {
                        parts: [
                            { functionCall: { name: "search", args: {} } },
                            { functionCall: { name: "lookup", args: {} } },
                        ],
                    },
                }],
            });

            const result = await geminiAdapter.sendCompletion(
                [{ role: "user", content: "do stuff", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.tool_calls![0].id).toBe("gemini-tool-0");
            expect(result.choices[0].message.tool_calls![1].id).toBe("gemini-tool-1");
        });

        it("returns empty args when functionCall.args is missing", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                candidates: [{
                    content: {
                        parts: [{ functionCall: { name: "noop" } }],
                    },
                }],
            });

            const result = await geminiAdapter.sendCompletion(
                [{ role: "user", content: "test", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.tool_calls![0].function.arguments).toBe("{}");
        });
    });
});
