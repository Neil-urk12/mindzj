import { invoke } from "@tauri-apps/api/core";
import { editorStore } from "./editor";
import { aiModelSettingsKey, settingsStore, type AiProviderConfig, type AiProviderType, type AiSkill } from "./settings";
import { listPluginCommands } from "./plugins";
import { vaultStore } from "./vault";
import {
  parseJsonObject,
  type ChatMessage,
  type ToolCall,
  type ToolExecutionContext,
} from "./ai/types";
import {
  inferProviderFamily,
  isLocalProviderType,
  normalizeProviderType,
  providerBaseUrl,
  resolveAdapterConfig,
  PROVIDER_DEFAULTS,
  providerNeedsRealKey,
  configMatchesProvider,
  providerStorageId,
  formatAiProviderError,
} from "./ai/router";
import openAiAdapter, { normalizeAssistantMessageForHistory } from "./ai/openai";
import anthropicAdapter from "./ai/anthropic";
import geminiAdapter from "./ai/gemini";
import {
  getToolDefinitions,
  executeTool,
  appendNaturalResponseToActiveNote,
  runJsonFallback,
  summarizeToolCall,
  buildToolContext,
  looksLikeToolFailureSummary,
} from "./ai/tools";

const MAX_TOOL_LOOP_STEPS = 8;
type AiModelOption = { value: string; label: string };
type AiTextToSpeechResult = { path: string; fileName: string };

interface RunInstructionOptions {
  restrictToActiveFile?: boolean;
  onProgress?: (event: AiInstructionProgressEvent) => void;
}

interface AiConnectionTestResult {
  model?: string | null;
  content?: string | null;
  models?: string[];
}

interface AiInstructionProgressEvent {
  phase: "request" | "tool-call" | "tool-result" | "message" | "done" | "error";
  message: string;
}

export const BUILT_IN_ONLINE_PROVIDER_TYPES = ["OpenAI", "Claude", "Grok", "Gemini", "DeepSeek"] as const;
export const GROK_STT_MODEL = "grok-stt";
export const GROK_TTS_VOICES: AiModelOption[] = [
  { value: "eve", label: "Eve" },
  { value: "ara", label: "Ara" },
  { value: "rex", label: "Rex" },
  { value: "sal", label: "Sal" },
  { value: "leo", label: "Leo" },
];
export const GROK_TTS_LANGUAGE_OPTIONS: AiModelOption[] = [
  { value: "auto", label: "Auto" },
  { value: "zh", label: "Chinese" },
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es-ES", label: "Spanish" },
];


const BUILT_IN_MODEL_OPTIONS: Partial<Record<AiProviderType, AiModelOption[]>> = {
  OpenAI: [
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
  ],
  Claude: [
    { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  Grok: [
    { value: "grok-4.20", label: "Grok 4.20" },
    { value: "grok-4.20-reasoning", label: "Grok 4.20 Reasoning" },
    { value: "grok-4", label: "Grok 4" },
  ],
  Gemini: [
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  DeepSeek: [
    { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { value: "deepseek-chat", label: "DeepSeek Chat" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  ],
};

function cloneConfig(config: AiProviderConfig): AiProviderConfig {
  return { ...config };
}


export function isBuiltInOnlineProviderType(provider: AiProviderType): boolean {
  return (BUILT_IN_ONLINE_PROVIDER_TYPES as readonly string[]).includes(provider);
}

export function builtInModelOptions(provider: AiProviderType): AiModelOption[] {
  return BUILT_IN_MODEL_OPTIONS[normalizeProviderType(provider)] ?? [];
}


function providerDisplayName(config: AiProviderConfig): string {
  const providerType = normalizeProviderType(config.provider_type);
  if (providerType === "LMStudio") return "LM Studio";
  if (providerType === "Ollama") return "Ollama";
  if (providerType === "OpenAI") return "OpenAI";
  if (providerType === "Claude") return "Claude";
  if (providerType === "Grok") return "Grok";
  if (providerType === "Gemini") return "Gemini";
  if (providerType === "DeepSeek") return "DeepSeek";
  return (config.display_name || "Online LLM").trim();
}

function modelDisplayName(config: AiProviderConfig): string {
  const model = config.model.trim();
  if (!model) return "";
  return builtInModelOptions(config.provider_type).find((option) => option.value === model)?.label ?? model;
}

function configuredModelIdentity(config: AiProviderConfig | null | undefined): string {
  if (!config) return "the configured AI model";
  const provider = providerDisplayName(config);
  const model = modelDisplayName(config);
  if (!model || model === provider) return provider;
  return model.toLowerCase().includes(provider.toLowerCase()) ? model : `${provider} ${model}`;
}

export function aiProviderModelLabel(config: AiProviderConfig | null | undefined): string {
  if (!config) return "Ollama";
  const provider = providerDisplayName(config);
  if (isLocalProviderType(config.provider_type)) return provider;
  const model = modelDisplayName(config);
  if (!model || model === provider) return provider;
  return `${provider} · ${model}`;
}

export function defaultAiProviderConfig(provider: AiProviderType): AiProviderConfig {
  return cloneConfig(PROVIDER_DEFAULTS[normalizeProviderType(provider)]);
}

function configuredProvider(): AiProviderConfig | null {
  return settingsStore.settings().ai_provider ?? defaultAiProviderConfig("Ollama");
}

function configuredGrokProvider(): AiProviderConfig {
  const settings = settingsStore.settings();
  if (settings.ai_provider?.provider_type === "Grok") return settings.ai_provider;
  return settings.ai_custom_providers?.find((config) => config.provider_type === "Grok" && !config.id)
    ?? defaultAiProviderConfig("Grok");
}


function emitProgress(options: RunInstructionOptions | undefined, phase: AiInstructionProgressEvent["phase"], message: string) {
  try {
    options?.onProgress?.({ phase, message });
  } catch {
    // Progress rendering must never break the actual AI action.
  }
}


function configuredPromptAndSkills(config: AiProviderConfig): { prompt: string; skills: AiSkill[] } {
  const settings = settingsStore.settings();
  const key = aiModelSettingsKey(config);
  const prompt = (settings.ai_model_prompts?.[key] ?? "").trim();
  const selected = new Set(settings.ai_model_skill_ids?.[key] ?? []);
  const skills = (settings.ai_skills ?? [])
    .filter((skill) => selected.has(skill.id) && skill.content.trim());
  return { prompt, skills };
}

function builtInToolCatalogForPrompt(): string {
  return getToolDefinitions().map((tool) => `- ${tool.function.name}: ${tool.function.description}`).join("\n");
}

function buildSystemPrompt(context?: ToolExecutionContext, config?: AiProviderConfig) {
  const active = vaultStore.activeFile()?.path ?? "(none)";
  const commands = listPluginCommands().map((command) => command.id).slice(0, 80);
  const modelConfig = config ? configuredPromptAndSkills(config) : { prompt: "", skills: [] };
  const modelIdentity = configuredModelIdentity(config);
  const lines = [
    "MindZJ operation base prompt:",
    `Configured AI model identity: ${modelIdentity}.`,
    "You are MindZJ's local automation agent.",
    `If the user asks what model you are, answer that you are based on ${modelIdentity} and work inside MindZJ as a local automation agent.`,
    "Do not describe MindZJ by comparing it with other note apps.",
    "Use tools to inspect and modify the user's current vault. Do not invent file contents or paths.",
    "The AI command panel is primarily for executing note actions; answer simple identity or status questions directly.",
    "MindZJ capabilities available through tools: Markdown notes, .mindzj mind maps, file and folder management, vault search, backlinks, forward links, graph data, active note and view mode inspection, settings updates, file-tree refresh, and plugin commands.",
    ".mindzj files are MindZJ mind maps. Use read_mindmap, create_mindmap_from_markdown, create_mindmap, add_mindmap_node, update_mindmap_node, and delete_mindmap_node for them instead of hand-writing raw JSON.",
    "To turn Markdown into a mind map, call create_mindmap_from_markdown. If the user omits a target path, write beside the source with the .mindzj extension.",
    "For mind map node edits, call read_mindmap first when you need node ids, then edit by node_id or text_path.",
    "If the user asks you to translate, draft, summarize, rewrite, polish, generate, or record content, write the result into the target note with create_note, update_note, or append_note.",
    "If the user did not name a target note, write content changes to the active note.",
    "For destructive changes, only perform the exact action requested by the user.",
    "If a note already exists, update it with the requested content instead of writing a troubleshooting report.",
    "If a tool fails, report the exact failure in one short sentence. Do not produce long summaries or solution lists.",
    "When you finish, summarize what you changed in one concise sentence.",
    `Active note: ${active}`,
    "Available built-in tools:",
    builtInToolCatalogForPrompt(),
    `Available plugin command ids: ${commands.join(", ") || "(none)"}`,
    "If tool calling is unavailable, respond with JSON like {\"tool\":\"read_note\",\"arguments\":{\"path\":\"note.md\"}}, {\"tool\":\"read_mindmap\",\"arguments\":{\"path\":\"map.mindzj\"}}, or {\"actions\":[...]} only.",
  ];
  if (modelConfig.prompt || modelConfig.skills.length > 0) {
    lines.push("", "User supplements for this configured model:");
  }
  if (modelConfig.prompt) {
    lines.push("Current model prompt:", modelConfig.prompt);
  }
  for (const skill of modelConfig.skills) {
    lines.push(
      `Selected skill: ${skill.name}`,
      skill.description ? `Skill description: ${skill.description}` : "",
      skill.content.trim(),
    );
  }
  if (context?.restrictToActiveFile && !context.hasExplicitPath) {
    lines.push(
      `The user did not name a specific file path. Any content-changing operation must target only the current active note: ${context.activePath ?? "(none)"}.`,
      "If the active file is a .mindzj mind map, node edits may target that active mind map with the mind map tools.",
      "Do not create, delete, rename, or modify another note unless the user explicitly names its vault-relative path.",
    );
  }
  return lines.join("\n");
}

async function chatCompletionRequest(
  config: AiProviderConfig,
  messages: ChatMessage[],
  apiKey: string | null,
  includeTools = true,
) {
  const adapterConfig = resolveAdapterConfig(config, apiKey);
  const family = inferProviderFamily(config);
  const adapter = family === "anthropic"
    ? anthropicAdapter
    : family === "gemini"
      ? geminiAdapter
      : openAiAdapter;
  const transport = async (url: string, headers: Record<string, string>, body: unknown) => {
    try {
      return await invoke("ai_chat_completion", { request: { url, headers, body } });
    } catch (error: any) {
      throw new Error(formatAiProviderError(error));
    }
  };
  const tools = includeTools ? getToolDefinitions() : [];
  return adapter.sendCompletion(messages, tools, adapterConfig, transport);
}

async function getAiJson(url: string, headers: Record<string, string>) {
  try {
    return await invoke<any>("ai_get_json", {
      request: { url, headers },
    });
  } catch (error) {
    throw new Error(formatAiProviderError(error));
  }
}

async function listProviderModels(config: AiProviderConfig, apiKey: string | null): Promise<string[]> {
  try {
    const base = providerBaseUrl(config);
    const family = inferProviderFamily(config);
    const providerType = normalizeProviderType(config.provider_type);
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

    if (providerType === "Ollama") {
      const data = await getAiJson(`${base}/api/tags`, {});
      return Array.isArray(data?.models) ? data.models.map((m: any) => m.name ?? m.model ?? "").filter(Boolean) : [];
    }

    if (family === "anthropic") {
      return [];
    }

    if (family === "gemini") {
      const geminiHeaders: Record<string, string> = apiKey ? { "x-goog-api-key": apiKey } : {};
      const data = await getAiJson(`${base}/models`, geminiHeaders);
      return Array.isArray(data?.models) ? data.models.map((m: any) => (m.name ?? "").replace(/^models\//, "")).filter(Boolean) : [];
    }

    const data = await getAiJson(`${base}/models`, headers);
    return Array.isArray(data?.data) ? data.data.map((m: any) => m.id ?? "").filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function postAiAudioTranscription(
  url: string,
  headers: Record<string, string>,
  fileName: string,
  mimeType: string,
  base64Data: string,
) {
  try {
    return await invoke<any>("ai_transcribe_audio", {
      request: { url, headers, fileName, mimeType, base64Data },
    });
  } catch (error) {
    throw new Error(formatAiProviderError(error));
  }
}

async function postAiTextToSpeech(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  outputDir: string | null,
  fileName: string,
): Promise<AiTextToSpeechResult> {
  try {
    return await invoke<AiTextToSpeechResult>("ai_text_to_speech", {
      request: { url, headers, body, outputDir, fileName },
    });
  } catch (error) {
    throw new Error(formatAiProviderError(error));
  }
}

function padAudioTimestamp(value: number): string {
  return String(value).padStart(2, "0");
}

function audioExportFileName(): string {
  const now = new Date();
  return [
    "mindzj_grok_tts_",
    now.getFullYear(),
    padAudioTimestamp(now.getMonth() + 1),
    padAudioTimestamp(now.getDate()),
    "_",
    padAudioTimestamp(now.getHours()),
    padAudioTimestamp(now.getMinutes()),
    padAudioTimestamp(now.getSeconds()),
    ".mp3",
  ].join("");
}


function createAiService() {
  async function getApiKey(config: AiProviderConfig): Promise<string | null> {
    if (!providerNeedsRealKey(config)) return null;
    const value = config.api_key?.trim();
    if (value) return value;
    const provider = providerStorageId(config);
    const migrated = await invoke<string | null>("get_ai_api_key", { provider }).catch(() => null);
    if (migrated?.trim()) {
      await saveApiKey(provider, migrated);
      return migrated.trim();
    }
    return null;
  }

  async function saveApiKey(provider: string, apiKey: string): Promise<void> {
    const value = apiKey.trim();
    const hasApiKey = value.length > 0;
    const updateConfig = (config: AiProviderConfig): AiProviderConfig =>
      configMatchesProvider(config, provider, null)
        ? { ...config, api_key: value || null, has_api_key: hasApiKey }
        : config;
    const current = settingsStore.settings();
    const nextProvider = current.ai_provider ? updateConfig(current.ai_provider) : current.ai_provider;
    const nextCustomProviders = (current.ai_custom_providers ?? []).map(updateConfig);
    await settingsStore.updateSetting("ai_custom_providers", nextCustomProviders);
    await settingsStore.updateSetting("ai_provider", nextProvider);
  }

  async function loadApiKey(config = configuredProvider()): Promise<string | null> {
    if (!config) return null;
    return getApiKey(config);
  }

  function isConfigured(): boolean {
    const config = configuredProvider();
    if (!config?.model || !providerBaseUrl(config)) return false;
    return !providerNeedsRealKey(config) || config.has_api_key;
  }

  function currentModelLabel(): string {
    return aiProviderModelLabel(configuredProvider());
  }

  async function testConnection(config = configuredProvider()): Promise<AiConnectionTestResult> {
    if (!config) throw new Error("AI provider is not configured.");
    if (!providerBaseUrl(config)) throw new Error("AI endpoint is empty.");

    const apiKey = await getApiKey(config);
    if (providerNeedsRealKey(config)) {
      if (!config.model.trim()) throw new Error("AI model is empty.");
      if (!config.has_api_key || !apiKey) throw new Error("API key is required for this provider.");
      const data = await chatCompletionRequest(
        config,
        [{ role: "user", content: "Reply with OK." }],
        apiKey,
        false,
      );
      const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
      return { model: config.display_name || config.model, content: content || null };
    }

    const models = await listProviderModels(config, apiKey);
    const detectedModel = models[0] || config.model.trim();
    if (!detectedModel) throw new Error("AI provider returned no available models.");

    const current = settingsStore.settings().ai_provider ?? config;
    const next: AiProviderConfig = {
      ...current,
      ...config,
      model: detectedModel,
    };
    await settingsStore.updateSetting("ai_provider", next);
    return { model: detectedModel, models };
  }

  async function runInstruction(instruction: string, options?: RunInstructionOptions): Promise<string> {
    const config = configuredProvider();
    if (!config) throw new Error("AI provider is not configured.");
    if (!config.model.trim()) throw new Error("AI model is empty.");
    if (!providerBaseUrl(config)) throw new Error("AI endpoint is empty.");
    if (providerNeedsRealKey(config) && !config.has_api_key) {
      throw new Error("API key is required for this provider.");
    }

    const apiKey = await getApiKey(config);
    if (providerNeedsRealKey(config) && !apiKey) {
      throw new Error("API key is required for this provider.");
    }
    await editorStore.flushAllPendingSaves();
    const toolContext = buildToolContext(instruction, options);
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(toolContext, config) },
      { role: "user", content: instruction },
    ];
    const executed: string[] = [];

    for (let step = 0; step < MAX_TOOL_LOOP_STEPS; step++) {
      emitProgress(options, "request", step === 0 ? "Sending instruction to AI model." : "Sending tool results back to AI model.");
      const data = await chatCompletionRequest(config, messages, apiKey);
      const choice = data?.choices?.[0];
      const message = choice?.message;
      const finishReason = String(choice?.finish_reason ?? "");
      if (!message) throw new Error("AI provider returned an empty response.");
      messages.push(normalizeAssistantMessageForHistory(message as ChatMessage, config));

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls as ToolCall[] : [];
      if (toolCalls.length > 0) {
        for (const call of toolCalls) {
          const args = parseJsonObject(call.function.arguments) ?? {};
          emitProgress(options, "tool-call", `Calling ${summarizeToolCall(call.function.name, args)}.`);
          const result = await executeTool(call.function.name, args, toolContext);
          if (result.message) executed.push(result.message);
          emitProgress(
            options,
            result.ok ? "tool-result" : "error",
            result.message || (result.ok ? `${call.function.name} completed.` : `${call.function.name} failed.`),
          );
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      const content = String(message.content ?? "").trim();
      const fallback = await runJsonFallback(content, toolContext);
      if (fallback) {
        emitProgress(options, "done", fallback);
        return fallback;
      }
      if (finishReason === "length") {
        const result = executed.join("\n") || "AI response was truncated before it produced a note action.";
        emitProgress(options, "error", result);
        return result;
      }
      const naturalWriteFallback = await appendNaturalResponseToActiveNote(instruction, content, toolContext);
      if (naturalWriteFallback) {
        emitProgress(options, "done", naturalWriteFallback);
        return naturalWriteFallback;
      }
      if (looksLikeToolFailureSummary(content) && executed.length) {
        const result = executed.join("\n");
        emitProgress(options, "error", result);
        return result;
      }
      const result = content || executed.join("\n") || "Done.";
      emitProgress(options, "done", result);
      return result;
    }

    const result = executed.join("\n") || "AI tool loop reached the step limit.";
    emitProgress(options, "error", result);
    return result;
  }

  async function transcribeGrokAudio(
    base64Data: string,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    const config = configuredGrokProvider();
    const apiKey = await getApiKey(config);
    if (!apiKey) throw new Error("Grok API key is required for speech-to-text.");
    const data = await postAiAudioTranscription(
      `${providerBaseUrl(config)}/stt`,
      { Authorization: `Bearer ${apiKey}` },
      fileName,
      mimeType || "audio/wav",
      base64Data,
    );
    return String(data?.text ?? "").trim();
  }

  async function synthesizeGrokSpeech(text: string): Promise<AiTextToSpeechResult> {
    const input = text.trim();
    if (!input) throw new Error("Text is required for speech export.");
    if (input.length > 15000) throw new Error("xAI TTS text must be 15,000 characters or fewer.");

    const config = configuredGrokProvider();
    const apiKey = await getApiKey(config);
    if (!apiKey) throw new Error("Grok API key is required for text-to-speech.");
    const settings = settingsStore.settings();
    const voice = settings.ai_tts_voice?.trim() || "eve";
    const language = settings.ai_tts_language?.trim() || "auto";
    return postAiTextToSpeech(
      `${providerBaseUrl(config)}/tts`,
      { Authorization: `Bearer ${apiKey}` },
      {
        text: input,
        voice_id: voice,
        language,
        output_format: { codec: "mp3" },
      },
      settings.ai_voice_export_folder?.trim() || null,
      audioExportFileName(),
    );
  }

  return {
    defaultAiProviderConfig,
    isConfigured,
    currentModelLabel,
    saveApiKey,
    loadApiKey,
    testConnection,
    runInstruction,
    transcribeGrokAudio,
    synthesizeGrokSpeech,
  };
}

export const aiService = createAiService();
