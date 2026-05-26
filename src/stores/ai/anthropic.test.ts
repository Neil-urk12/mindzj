import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatMessage, ToolDefinition, AdapterConfig, AiTransport } from "./types";

// ── Tests ────────────────────────────────────────────────────────

describe("anthropic adapter", () => {
    let anthropicAdapter: typeof import("./anthropic").default;

    beforeEach(async () => {
        vi.resetModules();
        anthropicAdapter = (await import("./anthropic")).default;
    });

    const makeConfig = (overrides?: Partial<AdapterConfig>): AdapterConfig => ({
        endpoint: "https://api.anthropic.com/v1/messages",
        authHeaders: { "x-api-key": "sk-ant-test", "anthropic-version": "2023-06-01" },
        model: "claude-sonnet-4-6",
        ...overrides,
    });

    // ── sendCompletion — request formatting ─────────────────────

    describe("sendCompletion — request formatting", () => {
        it("sends correct endpoint and auth headers", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "Hello" }],
            });

            await anthropicAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(transport).toHaveBeenCalledWith(
                "https://api.anthropic.com/v1/messages",
                { "x-api-key": "sk-ant-test", "anthropic-version": "2023-06-01" },
                expect.any(Object),
            );
        });

        it("includes model and max_tokens in body", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "Hi" }],
            });

            await anthropicAdapter.sendCompletion(
                [{ role: "user", content: "test", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            expect(body.model).toBe("claude-sonnet-4-6");
            expect(body.max_tokens).toBe(4096);
        });

        it("converts system messages to system field", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "ok" }],
            });

            await anthropicAdapter.sendCompletion(
                [
                    { role: "system", content: "You are helpful.", tool_calls: undefined },
                    { role: "user", content: "Hi", tool_calls: undefined },
                ],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            expect(body.system).toBe("You are helpful.");
            // System messages should NOT appear in messages array
            expect(body.messages.every((m: any) => m.role !== "system")).toBe(true);
        });

        it("joins multiple system messages with double newline", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "ok" }],
            });

            await anthropicAdapter.sendCompletion(
                [
                    { role: "system", content: "Rule 1", tool_calls: undefined },
                    { role: "system", content: "Rule 2", tool_calls: undefined },
                    { role: "user", content: "Hi", tool_calls: undefined },
                ],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            expect(body.system).toBe("Rule 1\n\nRule 2");
        });

        it("converts assistant message with tool_calls to content blocks", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "ok" }],
            });

            await anthropicAdapter.sendCompletion(
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
                    {
                        role: "tool",
                        content: '{"results":[]}',
                        tool_call_id: "call_1",
                    },
                ],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            // Assistant message should have content array with text + tool_use
            const assistantMsg = body.messages.find((m: any) => m.role === "assistant");
            expect(assistantMsg).toBeDefined();
            expect(assistantMsg.content).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ type: "text", text: "Let me search." }),
                    expect.objectContaining({ type: "tool_use", id: "call_1", name: "search" }),
                ]),
            );
        });

        it("converts tool results to user message with tool_result content blocks", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "ok" }],
            });

            await anthropicAdapter.sendCompletion(
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
            const toolResultMsg = body.messages.find((m: any) =>
                m.role === "user" && Array.isArray(m.content)
            );
            expect(toolResultMsg).toBeDefined();
            expect(toolResultMsg.content[0]).toEqual(
                expect.objectContaining({
                    type: "tool_result",
                    tool_use_id: "call_1",
                    content: '{"found":true}',
                }),
            );
        });

        it("marks tool_result as error when content is {ok:false}", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "ok" }],
            });

            await anthropicAdapter.sendCompletion(
                [
                    {
                        role: "assistant",
                        content: null,
                        tool_calls: [{
                            id: "call_err",
                            type: "function",
                            function: { name: "action", arguments: "{}" },
                        }],
                    },
                    {
                        role: "tool",
                        content: '{"ok":false,"message":"Permission denied"}',
                        tool_call_id: "call_err",
                    },
                ],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            const toolResultMsg = body.messages.find((m: any) =>
                m.role === "user" && Array.isArray(m.content)
            );
            expect(toolResultMsg.content[0].is_error).toBe(true);
        });

        it("does not mark tool_result as error for {ok:true}", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "ok" }],
            });

            await anthropicAdapter.sendCompletion(
                [
                    {
                        role: "assistant",
                        content: null,
                        tool_calls: [{
                            id: "call_ok",
                            type: "function",
                            function: { name: "action", arguments: "{}" },
                        }],
                    },
                    {
                        role: "tool",
                        content: '{"ok":true,"data":"done"}',
                        tool_call_id: "call_ok",
                    },
                ],
                [],
                makeConfig(),
                transport,
            );

            const body = (transport as any).mock.calls[0][2];
            const toolResultMsg = body.messages.find((m: any) =>
                m.role === "user" && Array.isArray(m.content)
            );
            expect(toolResultMsg.content[0].is_error).toBeUndefined();
        });

        it("includes tools in anthropic format when provided", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "ok" }],
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

            await anthropicAdapter.sendCompletion([], tools, makeConfig(), transport);

            const body = (transport as any).mock.calls[0][2];
            expect(body.tools).toEqual([{
                name: "search",
                description: "Search the web",
                input_schema: {
                    type: "object",
                    properties: { query: { type: "string" } },
                },
            }]);
        });
    });

    // ── sendCompletion — response normalization ──────────────────

    describe("sendCompletion — response normalization", () => {
        it("extracts text from anthropic response", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "Hello world" }],
            });

            const result = await anthropicAdapter.sendCompletion(
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
                content: [
                    { type: "text", text: "Part 1" },
                    { type: "text", text: "Part 2" },
                ],
            });

            const result = await anthropicAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.content).toBe("Part 1\nPart 2");
        });

        it("extracts tool_use blocks as tool_calls", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [
                    { type: "tool_use", id: "toolu_123", name: "search", input: { query: "test" } },
                ],
            });

            const result = await anthropicAdapter.sendCompletion(
                [{ role: "user", content: "search", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.tool_calls).toHaveLength(1);
            expect(result.choices[0].message.tool_calls![0]).toEqual({
                id: "toolu_123",
                type: "function",
                function: {
                    name: "search",
                    arguments: '{"query":"test"}',
                },
            });
        });

        it("returns undefined tool_calls when no tool_use blocks", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "Just text" }],
            });

            const result = await anthropicAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.tool_calls).toBeUndefined();
        });

        it("handles mixed text and tool_use content", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [
                    { type: "text", text: "Let me search for that." },
                    { type: "tool_use", id: "toolu_456", name: "search", input: { query: "hello" } },
                ],
            });

            const result = await anthropicAdapter.sendCompletion(
                [{ role: "user", content: "find hello", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.content).toBe("Let me search for that.");
            expect(result.choices[0].message.tool_calls).toHaveLength(1);
            expect(result.choices[0].message.tool_calls![0].function.name).toBe("search");
        });

        it("handles empty content array", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [],
            });

            const result = await anthropicAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.content).toBeNull();
        });

        it("handles missing content field gracefully", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({});

            const result = await anthropicAdapter.sendCompletion(
                [{ role: "user", content: "Hi", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.content).toBeNull();
        });

        it("generates fallback id for tool_use without id", async () => {
            const transport: AiTransport = vi.fn().mockResolvedValue({
                content: [
                    { type: "tool_use", name: "search", input: {} },
                ],
            });

            const result = await anthropicAdapter.sendCompletion(
                [{ role: "user", content: "test", tool_calls: undefined }],
                [],
                makeConfig(),
                transport,
            );

            expect(result.choices[0].message.tool_calls![0].id).toBe("anthropic-tool-0");
        });
    });
});
