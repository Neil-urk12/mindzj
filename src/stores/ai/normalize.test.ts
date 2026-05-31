// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { NormalizedResponse } from "./types";

// These will fail until implementation exports the functions
import { normalizeAnthropicResponse } from "./anthropic";
import { normalizeGeminiResponse } from "./gemini";
import { normalizeOpenAIResponse } from "./openai";

describe("normalizeAnthropicResponse", () => {
    it("handles null input", () => {
        const result = normalizeAnthropicResponse(null);
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles undefined input", () => {
        const result = normalizeAnthropicResponse(undefined);
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles primitive input", () => {
        const result = normalizeAnthropicResponse(123);
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles empty object", () => {
        const result = normalizeAnthropicResponse({});
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles empty content array", () => {
        const result = normalizeAnthropicResponse({ content: [] });
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("extracts text content", () => {
        const result = normalizeAnthropicResponse({
            content: [{ type: "text", text: "hello" }],
        });
        expect(result.choices[0].message.content).toBe("hello");
    });

    it("extracts tool calls", () => {
        const result = normalizeAnthropicResponse({
            content: [{ type: "tool_use", id: "1", name: "fn", input: { a: 1 } }],
        });
        expect(result.choices[0].message.tool_calls).toHaveLength(1);
        expect(result.choices[0].message.tool_calls![0].function.name).toBe("fn");
    });
    it("joins multiple text parts with newline", () => {
        const result = normalizeAnthropicResponse({
            content: [
                { type: "text", text: "line1" },
                { type: "text", text: "line2" },
            ],
        });
        expect(result.choices[0].message.content).toBe("line1\nline2");
    });

    it("handles mixed text and tool_use parts", () => {
        const result = normalizeAnthropicResponse({
            content: [
                { type: "text", text: "thinking..." },
                { type: "tool_use", id: "1", name: "fn", input: {} },
            ],
        });
        expect(result.choices[0].message.content).toBe("thinking...");
        expect(result.choices[0].message.tool_calls).toHaveLength(1);
    });

    it("filters out tool_use with missing name", () => {
        const result = normalizeAnthropicResponse({
            content: [{ type: "tool_use", id: "1", name: "", input: {} }],
        });
        expect(result.choices[0].message.tool_calls).toBeUndefined();
    });
});

describe("normalizeGeminiResponse", () => {
    it("handles null input", () => {
        const result = normalizeGeminiResponse(null);
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles undefined input", () => {
        const result = normalizeGeminiResponse(undefined);
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles primitive input", () => {
        const result = normalizeGeminiResponse(123);
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles empty object", () => {
        const result = normalizeGeminiResponse({});
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles empty candidates", () => {
        const result = normalizeGeminiResponse({ candidates: [] });
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("extracts text content", () => {
        const result = normalizeGeminiResponse({
            candidates: [{ content: { parts: [{ text: "hi" }] } }],
        });
        expect(result.choices[0].message.content).toBe("hi");
    });

    it("extracts function calls", () => {
        const result = normalizeGeminiResponse({
            candidates: [{
                content: {
                    parts: [{ functionCall: { name: "do_thing", args: { x: 1 } } }],
                },
            }],
        });
        expect(result.choices[0].message.tool_calls).toHaveLength(1);
        expect(result.choices[0].message.tool_calls![0].function.name).toBe("do_thing");
    });

    it("filters out functionCall with missing name", () => {
        const result = normalizeGeminiResponse({
            candidates: [{ content: { parts: [{ functionCall: { name: "", args: {} } }] } }],
        });
        expect(result.choices[0].message.tool_calls).toBeUndefined();
    });
    });

describe("normalizeOpenAIResponse", () => {
    it("handles null input", () => {
        const result = normalizeOpenAIResponse(null);
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles undefined input", () => {
        const result = normalizeOpenAIResponse(undefined);
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles primitive input", () => {
        const result = normalizeOpenAIResponse(123);
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles empty object", () => {
        const result = normalizeOpenAIResponse({});
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("handles empty choices", () => {
        const result = normalizeOpenAIResponse({ choices: [] });
        expect(result.choices).toHaveLength(1);
        expect(result.choices[0].message.content).toBeNull();
    });

    it("extracts content from choices", () => {
        const result = normalizeOpenAIResponse({
            choices: [{ message: { role: "assistant", content: "hello" } }],
        });
        expect(result.choices[0].message.content).toBe("hello");
    });

    it("extracts tool calls from choices", () => {
        const result = normalizeOpenAIResponse({
            choices: [{
                message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [{
                        id: "1",
                        type: "function",
                        function: { name: "fn", arguments: "{}" },
                    }],
                },
            }],
        });
        expect(result.choices[0].message.tool_calls).toHaveLength(1);
        expect(result.choices[0].message.tool_calls![0].function.name).toBe("fn");
    });

    it("filters out tool_calls with missing function property", () => {
        const result = normalizeOpenAIResponse({
            choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "1" }] } }],
        });
        expect(result.choices[0].message.tool_calls).toBeUndefined();
    });

    it("filters out tool_calls with function as null", () => {
        const result = normalizeOpenAIResponse({
            choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "1", function: null }] } }],
        });
        expect(result.choices[0].message.tool_calls).toBeUndefined();
    });

    it("filters out tool_calls with function as string", () => {
        const result = normalizeOpenAIResponse({
            choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "1", function: "not-an-object" }] } }],
        });
        expect(result.choices[0].message.tool_calls).toBeUndefined();
    });

    it("filters out tool_calls with function.name as number", () => {
        const result = normalizeOpenAIResponse({
            choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "1", function: { name: 123 } }] } }],
        });
        expect(result.choices[0].message.tool_calls).toBeUndefined();
    });
});
