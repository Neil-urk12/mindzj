import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Tests ────────────────────────────────────────────────────────

describe("router", () => {
    let router: typeof import("./router");

    beforeEach(async () => {
        vi.resetModules();
        router = await import("./router");
    });

    // ── normalizeProviderType ───────────────────────────────────

    describe("normalizeProviderType", () => {
        it("returns known provider types unchanged", () => {
            expect(router.normalizeProviderType("OpenAI")).toBe("OpenAI");
            expect(router.normalizeProviderType("Claude")).toBe("Claude");
            expect(router.normalizeProviderType("Gemini")).toBe("Gemini");
            expect(router.normalizeProviderType("Ollama")).toBe("Ollama");
            expect(router.normalizeProviderType("DeepSeek")).toBe("DeepSeek");
            expect(router.normalizeProviderType("Grok")).toBe("Grok");
            expect(router.normalizeProviderType("Custom")).toBe("Custom");
            expect(router.normalizeProviderType("LMStudio")).toBe("LMStudio");
            expect(router.normalizeProviderType("ApiKeyLLM")).toBe("ApiKeyLLM");
        });

        it("falls back to ApiKeyLLM for unknown type", () => {
            expect(router.normalizeProviderType("NotARealProvider" as any)).toBe("ApiKeyLLM");
        });
    });

    // ── isLocalProviderType ─────────────────────────────────────

    describe("isLocalProviderType", () => {
        it("returns true for Ollama and LMStudio", () => {
            expect(router.isLocalProviderType("Ollama")).toBe(true);
            expect(router.isLocalProviderType("LMStudio")).toBe(true);
        });

        it("returns false for cloud providers", () => {
            expect(router.isLocalProviderType("OpenAI")).toBe(false);
            expect(router.isLocalProviderType("Claude")).toBe(false);
            expect(router.isLocalProviderType("Gemini")).toBe(false);
            expect(router.isLocalProviderType("DeepSeek")).toBe(false);
            expect(router.isLocalProviderType("Grok")).toBe(false);
            expect(router.isLocalProviderType("Custom")).toBe(false);
            expect(router.isLocalProviderType("ApiKeyLLM")).toBe(false);
        });
    });

    // ── providerNeedsRealKey ────────────────────────────────────

    describe("providerNeedsRealKey", () => {
        it("returns false for local providers", () => {
            expect(router.providerNeedsRealKey({
                id: null, display_name: null, provider_type: "Ollama",
                endpoint: "http://localhost:11434/v1", api_key: null,
                has_api_key: false, model: "llama3.2",
            })).toBe(false);
        });

        it("returns true for cloud providers", () => {
            expect(router.providerNeedsRealKey({
                id: null, display_name: "OpenAI", provider_type: "OpenAI",
                endpoint: "https://api.openai.com/v1", api_key: null,
                has_api_key: false, model: "gpt-5.5",
            })).toBe(true);
        });
    });

    // ── inferProviderFamily ─────────────────────────────────────

    describe("inferProviderFamily", () => {
        it("returns anthropic for Claude provider type", () => {
            expect(router.inferProviderFamily({
                id: null, display_name: "Claude", provider_type: "Claude",
                endpoint: "https://api.anthropic.com/v1", api_key: null,
                has_api_key: false, model: "claude-sonnet-4-6",
            })).toBe("anthropic");
        });

        it("returns gemini for Gemini provider type", () => {
            expect(router.inferProviderFamily({
                id: null, display_name: "Gemini", provider_type: "Gemini",
                endpoint: "https://generativelanguage.googleapis.com/v1beta",
                api_key: null, has_api_key: false, model: "gemini-3-flash-preview",
            })).toBe("gemini");
        });

        it("returns anthropic when endpoint contains anthropic.com", () => {
            expect(router.inferProviderFamily({
                id: null, display_name: null, provider_type: "ApiKeyLLM",
                endpoint: "https://api.anthropic.com/v1", api_key: null,
                has_api_key: false, model: "claude-3",
            })).toBe("anthropic");
        });

        it("returns gemini when endpoint contains generativelanguage.googleapis.com", () => {
            expect(router.inferProviderFamily({
                id: null, display_name: null, provider_type: "ApiKeyLLM",
                endpoint: "https://generativelanguage.googleapis.com/v1beta",
                api_key: null, has_api_key: false, model: "gemini-1.5-flash",
            })).toBe("gemini");
        });

        it("returns openai-compatible for OpenAI provider type", () => {
            expect(router.inferProviderFamily({
                id: null, display_name: "OpenAI", provider_type: "OpenAI",
                endpoint: "https://api.openai.com/v1", api_key: null,
                has_api_key: false, model: "gpt-5.5",
            })).toBe("openai-compatible");
        });

        it("falls back to hint-based detection for anthropic", () => {
            expect(router.inferProviderFamily({
                id: null, display_name: null, provider_type: "Custom",
                endpoint: null, api_key: null,
                has_api_key: false, model: "claude-3-opus",
            })).toBe("anthropic");
        });

        it("falls back to hint-based detection for gemini", () => {
            expect(router.inferProviderFamily({
                id: null, display_name: null, provider_type: "Custom",
                endpoint: null, api_key: null,
                has_api_key: false, model: "gemini-2.0-flash",
            })).toBe("gemini");
        });

        it("defaults to openai-compatible when nothing else matches", () => {
            expect(router.inferProviderFamily({
                id: null, display_name: null, provider_type: "Custom",
                endpoint: null, api_key: null,
                has_api_key: false, model: "some-model",
            })).toBe("openai-compatible");
        });

        it("returns openai-compatible when endpoint is present but no special match", () => {
            expect(router.inferProviderFamily({
                id: null, display_name: null, provider_type: "ApiKeyLLM",
                endpoint: "http://localhost:1234/v1", api_key: null,
                has_api_key: false, model: "local-model",
            })).toBe("openai-compatible");
        });
    });

    // ── providerBaseUrl ─────────────────────────────────────────

    describe("providerBaseUrl", () => {
        it("strips trailing slashes", () => {
            expect(router.providerBaseUrl({
                id: null, display_name: "OpenAI", provider_type: "OpenAI",
                endpoint: "https://api.openai.com/v1///", api_key: null,
                has_api_key: false, model: "gpt-5.5",
            })).toBe("https://api.openai.com/v1");
        });

        it("cleans gemini endpoint of /models/ suffix", () => {
            expect(router.providerBaseUrl({
                id: null, display_name: "Gemini", provider_type: "Gemini",
                endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
                api_key: null, has_api_key: false, model: "gemini-1.5-flash",
            })).toBe("https://generativelanguage.googleapis.com/v1beta");
        });

        it("cleans gemini endpoint of /models suffix", () => {
            expect(router.providerBaseUrl({
                id: null, display_name: "Gemini", provider_type: "Gemini",
                endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
                api_key: null, has_api_key: false, model: "gemini-1.5-flash",
            })).toBe("https://generativelanguage.googleapis.com/v1beta");
        });

        it("uses default for Ollama when endpoint is empty", () => {
            expect(router.providerBaseUrl({
                id: null, display_name: null, provider_type: "Ollama",
                endpoint: "", api_key: null, has_api_key: false, model: "llama3.2",
            })).toBe("http://localhost:11434/v1");
        });

        it("uses configured endpoint for Ollama when set", () => {
            expect(router.providerBaseUrl({
                id: null, display_name: null, provider_type: "Ollama",
                endpoint: "http://192.168.1.5:11434/v1", api_key: null,
                has_api_key: false, model: "llama3.2",
            })).toBe("http://192.168.1.5:11434/v1");
        });
    });

    // ── resolveAdapterConfig ────────────────────────────────────

    describe("resolveAdapterConfig", () => {
        it("builds correct config for OpenAI-compatible", () => {
            const result = router.resolveAdapterConfig({
                id: null, display_name: "OpenAI", provider_type: "OpenAI",
                endpoint: "https://api.openai.com/v1", api_key: null,
                has_api_key: false, model: "gpt-5.5",
            }, "sk-test-key");

            expect(result.endpoint).toBe("https://api.openai.com/v1/chat/completions");
            expect(result.authHeaders).toEqual({ Authorization: "Bearer sk-test-key" });
            expect(result.model).toBe("gpt-5.5");
        });

        it("builds correct config for Anthropic", () => {
            const result = router.resolveAdapterConfig({
                id: null, display_name: "Claude", provider_type: "Claude",
                endpoint: "https://api.anthropic.com/v1", api_key: null,
                has_api_key: false, model: "claude-sonnet-4-6",
            }, "sk-ant-test");

            expect(result.endpoint).toBe("https://api.anthropic.com/v1/messages");
            expect(result.authHeaders).toEqual({
                "x-api-key": "sk-ant-test",
                "anthropic-version": "2023-06-01",
            });
            expect(result.model).toBe("claude-sonnet-4-6");
        });

        it("builds correct config for Gemini", () => {
            const result = router.resolveAdapterConfig({
                id: null, display_name: "Gemini", provider_type: "Gemini",
                endpoint: "https://generativelanguage.googleapis.com/v1beta",
                api_key: null, has_api_key: false, model: "gemini-3-flash-preview",
            }, "google-key-123");

            expect(result.endpoint).toBe(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent"
            );
            expect(result.authHeaders).toEqual({ "x-goog-api-key": "google-key-123" });
            expect(result.model).toBe("gemini-3-flash-preview");
        });

        it("returns empty auth headers when api key is null", () => {
            const result = router.resolveAdapterConfig({
                id: null, display_name: "OpenAI", provider_type: "OpenAI",
                endpoint: "https://api.openai.com/v1", api_key: null,
                has_api_key: false, model: "gpt-5.5",
            }, null);

            expect(result.authHeaders).toEqual({});
        });

        it("handles Gemini model with models/ prefix in config", () => {
            const result = router.resolveAdapterConfig({
                id: null, display_name: "Gemini", provider_type: "Gemini",
                endpoint: "https://generativelanguage.googleapis.com/v1beta",
                api_key: null, has_api_key: false, model: "models/gemini-1.5-flash",
            }, "key");

            expect(result.endpoint).toBe(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
            );
        });
    });

    // ── stripCopiedModelPath ────────────────────────────────────

    describe("stripCopiedModelPath", () => {
        it("extracts model name from full URL", () => {
            expect(router.stripCopiedModelPath(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
            )).toBe("gemini-1.5-flash");
        });

        it("extracts model from /models/ path", () => {
            expect(router.stripCopiedModelPath("models/gpt-5.5")).toBe("gpt-5.5");
        });

        it("strips surrounding quotes", () => {
            expect(router.stripCopiedModelPath('"gpt-5.5"')).toBe("gpt-5.5");
            expect(router.stripCopiedModelPath("'gpt-5.5'")).toBe("gpt-5.5");
        });

        it("strips query strings and fragments", () => {
            expect(router.stripCopiedModelPath("gemini-1.5?foo=bar")).toBe("gemini-1.5");
            expect(router.stripCopiedModelPath("gemini-1.5#section")).toBe("gemini-1.5");
        });

        it("returns empty string for empty input", () => {
            expect(router.stripCopiedModelPath("")).toBe("");
            expect(router.stripCopiedModelPath('""')).toBe("");
        });

        it("strips :generateContent suffix", () => {
            expect(router.stripCopiedModelPath("models/gemini-1.5-flash:generateContent")).toBe("gemini-1.5-flash");
        });

        it("strips :streamGenerateContent suffix", () => {
            expect(router.stripCopiedModelPath("models/gemini-1.5-flash:streamGenerateContent")).toBe("gemini-1.5-flash");
        });
    });

    // ── openAiCompatibleModelId ─────────────────────────────────

    describe("openAiCompatibleModelId", () => {
        it("returns model name directly for standard models", () => {
            expect(router.openAiCompatibleModelId({
                id: null, display_name: "OpenAI", provider_type: "OpenAI",
                endpoint: "https://api.openai.com/v1", api_key: null,
                has_api_key: false, model: "gpt-5.5",
            })).toBe("gpt-5.5");
        });

        it("strips provider prefix for non-openrouter endpoints", () => {
            expect(router.openAiCompatibleModelId({
                id: null, display_name: null, provider_type: "ApiKeyLLM",
                endpoint: "https://api.something.com/v1", api_key: null,
                has_api_key: false, model: "some-provider/model-name",
            })).toBe("model-name");
        });

        it("preserves provider prefix for openrouter", () => {
            expect(router.openAiCompatibleModelId({
                id: null, display_name: null, provider_type: "ApiKeyLLM",
                endpoint: "https://openrouter.ai/api/v1", api_key: null,
                has_api_key: false, model: "anthropic/claude-3",
            })).toBe("anthropic/claude-3");
        });

        it("strips models/ prefix", () => {
            expect(router.openAiCompatibleModelId({
                id: null, display_name: null, provider_type: "ApiKeyLLM",
                endpoint: "https://api.example.com/v1", api_key: null,
                has_api_key: false, model: "models/gpt-5.5",
            })).toBe("gpt-5.5");
        });
    });

    // ── geminiModelPath ─────────────────────────────────────────

    describe("geminiModelPath", () => {
        it("adds models/ prefix to simple model name", () => {
            expect(router.geminiModelPath("gemini-1.5-flash")).toBe("models/gemini-1.5-flash");
        });

        it("strips google/ prefix", () => {
            expect(router.geminiModelPath("google/gemini-1.5-flash")).toBe("models/gemini-1.5-flash");
        });

        it("strips gemini/ prefix", () => {
            expect(router.geminiModelPath("gemini/gemini-1.5-flash")).toBe("models/gemini-1.5-flash");
        });

        it("keeps models/ prefix if already present", () => {
            expect(router.geminiModelPath("models/gemini-1.5-flash")).toBe("models/gemini-1.5-flash");
        });

        it("extracts gemini model from deep path", () => {
            expect(router.geminiModelPath("some/path/gemini-2.0-flash")).toBe("models/gemini-2.0-flash");
        });
    });

    // ── isDeepSeekConfig ────────────────────────────────────────

    describe("isDeepSeekConfig", () => {
        it("returns true for DeepSeek provider type", () => {
            expect(router.isDeepSeekConfig({
                id: null, display_name: "DeepSeek", provider_type: "DeepSeek",
                endpoint: "https://api.deepseek.com", api_key: null,
                has_api_key: false, model: "deepseek-v4-pro",
            })).toBe(true);
        });

        it("returns true when endpoint contains deepseek.com", () => {
            expect(router.isDeepSeekConfig({
                id: null, display_name: null, provider_type: "ApiKeyLLM",
                endpoint: "https://api.deepseek.com", api_key: null,
                has_api_key: false, model: "some-model",
            })).toBe(true);
        });

        it("returns true when model hint contains deepseek", () => {
            expect(router.isDeepSeekConfig({
                id: null, display_name: "deepseek", provider_type: "ApiKeyLLM",
                endpoint: "https://other.com", api_key: null,
                has_api_key: false, model: "deepseek-chat",
            })).toBe(true);
        });

        it("returns false for non-deepseek config", () => {
            expect(router.isDeepSeekConfig({
                id: null, display_name: "OpenAI", provider_type: "OpenAI",
                endpoint: "https://api.openai.com/v1", api_key: null,
                has_api_key: false, model: "gpt-5.5",
            })).toBe(false);
        });
    });

    // ── modelHint ───────────────────────────────────────────────

    describe("modelHint", () => {
        it("returns lowercased display_name + model", () => {
            expect(router.modelHint({
                id: null, display_name: "OpenAI", provider_type: "OpenAI",
                endpoint: "", api_key: null, has_api_key: false, model: "GPT-5.5",
            })).toBe("openai gpt-5.5");
        });

        it("handles null display_name", () => {
            expect(router.modelHint({
                id: null, display_name: null, provider_type: "ApiKeyLLM",
                endpoint: "", api_key: null, has_api_key: false, model: "claude-3",
            })).toBe(" claude-3");
        });
    });

    // ── providerStorageId ───────────────────────────────────────

    describe("providerStorageId", () => {
        it("returns id when present", () => {
            expect(router.providerStorageId({
                id: "custom-id-123", display_name: null, provider_type: "OpenAI",
                endpoint: "", api_key: null, has_api_key: false, model: "",
            })).toBe("custom-id-123");
        });

        it("falls back to normalized provider type when id is null", () => {
            expect(router.providerStorageId({
                id: null, display_name: null, provider_type: "OpenAI",
                endpoint: "", api_key: null, has_api_key: false, model: "",
            })).toBe("OpenAI");
        });
    });

    // ── configMatchesProvider ───────────────────────────────────

    describe("configMatchesProvider", () => {
        const config = {
            id: "abc-123", display_name: "OpenAI", provider_type: "OpenAI" as const,
            endpoint: "", api_key: null, has_api_key: false, model: "",
        };

        it("matches by config.id", () => {
            expect(router.configMatchesProvider(config, "abc-123", null)).toBe(true);
        });

        it("matches by provider type", () => {
            expect(router.configMatchesProvider({ ...config, id: null }, null, "OpenAI")).toBe(true);
        });

        it("returns false when nothing matches", () => {
            expect(router.configMatchesProvider(config, "other-id", "Claude")).toBe(false); // id doesn't match
            expect(router.configMatchesProvider({ ...config, id: null }, "other-id", "Claude")).toBe(false);
        });

        it("returns false when all args are null", () => {
            expect(router.configMatchesProvider({ ...config, id: null }, null, null)).toBe(false);
        });
    });

    // ── parseProviderErrorPayload ───────────────────────────────

    describe("parseProviderErrorPayload", () => {
        it("parses JSON error with error.message", () => {
            const raw = '401: {"error":{"message":"Invalid API key","type":"auth_error","code":"invalid_key"}}';
            const result = router.parseProviderErrorPayload(raw);

            expect(result.status).toBe("401");
            expect(result.message).toBe("Invalid API key");
            expect(result.type).toBe("auth_error");
            expect(result.code).toBe("invalid_key");
        });

        it("parses plain JSON error", () => {
            const raw = '400: {"message":"Bad request"}';
            const result = router.parseProviderErrorPayload(raw);

            expect(result.status).toBe("400");
            expect(result.message).toBe("Bad request");
        });

        it("handles non-JSON body", () => {
            const raw = "500: Internal Server Error";
            const result = router.parseProviderErrorPayload(raw);

            expect(result.status).toBe("500");
            expect(result.message).toBe("Internal Server Error");
        });

        it("handles body without status code prefix", () => {
            const raw = '{"error":{"message":"Rate limited"}}';
            const result = router.parseProviderErrorPayload(raw);

            expect(result.status).toBeUndefined();
            expect(result.message).toBe("Rate limited");
        });

        it("handles empty body after status code", () => {
            const raw = "502:";
            const result = router.parseProviderErrorPayload(raw);

            expect(result.status).toBe("502");
        });
    });

    // ── formatAiProviderError ───────────────────────────────────

    describe("formatAiProviderError", () => {
        it("formats simple error message", () => {
            expect(router.formatAiProviderError(new Error("Network timeout"))).toBe("Network timeout");
        });

        it("includes status code when present", () => {
            const result = router.formatAiProviderError(
                new Error('401: {"error":{"message":"Unauthorized"}}')
            );
            expect(result).toContain("401:");
            expect(result).toContain("Unauthorized");
        });

        it("adds Gemini model hint for model name errors", () => {
            const result = router.formatAiProviderError(
                new Error('400: {"error":{"message":"unexpected model name format"}}')
            );
            expect(result).toContain("Gemini");
        });

        it("adds model ID hint for invalid model errors", () => {
            const result = router.formatAiProviderError(
                new Error('404: {"error":{"message":"Invalid model id"}}')
            );
            expect(result).toContain("模型 ID 无效");
        });
    });
});
