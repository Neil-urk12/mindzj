/**
 * Pure normalization and serialization for AppSettings.
 *
 * Every function in this module is side-effect-free and testable without
 * DOM, reactive runtimes, or mocking. Extracted from settings.ts so that
 * normalization logic can be verified independently from the reactive
 * store that applies settings to the DOM.
 */
import { DEFAULT_ATTACHMENT_FOLDER } from "../utils/vaultPaths";
import type {
    AppSettings,
    AiProviderConfig,
    AiSkill,
    AiProviderType,
    HotkeyBinding,
} from "../types";


export const DEFAULT_FONT_FAMILY =
    '"Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Noto Sans", Ubuntu, Cantarell, sans-serif';

/**
 * Active skin identifier.
 *
 * Besides the original `"light" | "dark" | "system"` trio we now accept:
 *   - Any built-in preset ID from `src/styles/themes/index.ts`
 *     (`"github-dark"`, `"nord"`, `"tokyo-night"`, …).
 *   - A `"custom:<name>"` reference that points at
 *     `.mindzj/themes/<name>.css` inside the current vault.
 *
 * The type stays `string` on purpose — backend persistence is a plain
 * string, and narrowing it in TypeScript would force every caller to
 * cast when dealing with user-imported skins whose names we don't know
 * at compile time.
 */
export type Theme = string;
type PersistedTheme = Theme | "Light" | "Dark" | "System";

export interface PersistedSettings
    extends Omit<Partial<AppSettings>, "theme"> {
    theme?: PersistedTheme | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
    theme: "dark",
    font_size: 16,
    font_family: DEFAULT_FONT_FAMILY,
    show_markdown_toolbar: true,
    editor_line_numbers: false,
    markdown_code_block_line_numbers: false,
    editor_word_wrap: true,
    editor_spell_check: false,
    editor_readable_line_length: true,
    auto_save_interval_ms: 2000,
    default_view_mode: "live-preview",
    // Default UI language is English. Users can switch language from the
    // welcome screen (saved to localStorage under "mindzj-pending-locale")
    // or from Settings → Appearance once a vault is open.
    locale: "en",
    accent_color: "#1aad3f",
    heading_color: null,
    link_color: null,
    highlight_color: null,
    bold_color: null,
    auto_link_urls: true,
    selection_color: null,
    drag_indicator_color: null,
    css_snippet: null,
    enabled_css_snippets: [],
    attachment_folder: DEFAULT_ATTACHMENT_FOLDER,
    auto_update_links: true,
    default_new_note_location: "VaultRoot",
    template_folder: null,
    ai_provider: null,
    ai_custom_providers: [],
    ai_model_prompts: {},
    ai_skills: [],
    ai_model_skill_ids: {},
    ai_voice_provider: "Grok",
    ai_stt_model: "grok-stt",
    ai_tts_voice: "eve",
    ai_tts_language: "auto",
    ai_voice_export_folder: null,
    hotkey_overrides: {},

    // Image defaults
    image_resize_options: "25%, 33%, 50%, 100%",
    image_ctrl_click: "open-in-new-tab",
    image_wheel_zoom: true,
    image_wheel_modifier: "Alt",
    image_wheel_zoom_step: 20,
    image_wheel_invert: false,
};

export function createDefaultSettings(): AppSettings {
    return {
        ...DEFAULT_SETTINGS,
        ai_custom_providers: [...DEFAULT_SETTINGS.ai_custom_providers],
        ai_model_prompts: { ...DEFAULT_SETTINGS.ai_model_prompts },
        ai_skills: [...DEFAULT_SETTINGS.ai_skills],
        ai_model_skill_ids: { ...DEFAULT_SETTINGS.ai_model_skill_ids },
        hotkey_overrides: { ...DEFAULT_SETTINGS.hotkey_overrides },
    };
}

export function aiModelSettingsKey(
    config: AiProviderConfig | null | undefined,
): string {
    if (!config)
        return "provider:Ollama|endpoint:http://localhost:11434/v1|model:llama3.2";
    const providerType = normalizeAiProviderType(config.provider_type);
    const id = typeof config.id === "string" ? config.id.trim() : "";
    if (id) return `id:${id}`;
    const endpoint = (config.endpoint ?? "").trim().replace(/\/+$/, "");
    const model = (config.model ?? "").trim();
    return `provider:${providerType}|endpoint:${endpoint}|model:${model || "(default)"}`;
}

export function hotkeyOverridesToBindings(
    overrides: Record<string, string>,
): HotkeyBinding[] {
    return Object.entries(overrides)
        .filter(
            ([, keys]) => typeof keys === "string" && keys.trim().length > 0,
        )
        .map(([command, keys]) => ({ command, keys }));
}

export function normalizeTheme(
    theme: PersistedTheme | null | undefined,
): Theme {
    if (typeof theme !== "string") return DEFAULT_SETTINGS.theme;
    const trimmed = theme.trim();
    if (!trimmed) return DEFAULT_SETTINGS.theme;
    // Normalize the three legacy enum spellings, but preserve any other
    // value (built-in preset IDs and `custom:<name>` references) verbatim.
    switch (trimmed) {
        case "Light":
        case "light":
            return "light";
        case "Dark":
        case "dark":
            return "dark";
        case "System":
        case "system":
            return "system";
        default:
            return trimmed;
    }
}

/**
 * Convert the in-memory skin ID back into the string shape the backend
 * expects. Historically this was the tagged enum `"Light"/"Dark"/"System"`;
 * now the backend accepts any string (see `deserialize_theme` in
 * `types.rs`), so we pass unknown IDs through unchanged. The three
 * legacy spellings are preserved so settings files written by older
 * versions of the app round-trip cleanly.
 */
export function serializeTheme(theme: Theme): string {
    switch (theme) {
        case "light":
            return "Light";
        case "dark":
            return "Dark";
        case "system":
            return "System";
        default:
            return theme;
    }
}

function normalizeAiProviderType(type: unknown): AiProviderType {
    if (
        type === "Ollama" ||
        type === "LMStudio" ||
        type === "ApiKeyLLM" ||
        type === "OpenAI" ||
        type === "Claude" ||
        type === "Grok" ||
        type === "Gemini" ||
        type === "DeepSeek" ||
        type === "Custom"
    ) {
        return type;
    }
    return "Ollama";
}

function normalizeAiConfig(config: unknown): AiProviderConfig | null {
    if (!config || typeof config !== "object") return null;
    const raw = config as Partial<AiProviderConfig>;
    const providerType = normalizeAiProviderType(raw.provider_type);
    const apiKey =
        typeof raw.api_key === "string" && raw.api_key.trim()
            ? raw.api_key.trim()
            : null;
    return {
        id: typeof raw.id === "string" && raw.id.trim() ? raw.id : null,
        display_name:
            typeof raw.display_name === "string" && raw.display_name.trim()
                ? raw.display_name.trim()
                : null,
        provider_type: providerType,
        endpoint:
            typeof raw.endpoint === "string" && raw.endpoint.trim()
                ? raw.endpoint.trim()
                : null,
        api_key: apiKey,
        has_api_key: !!raw.has_api_key || !!apiKey,
        model: typeof raw.model === "string" ? raw.model : "",
    };
}

function normalizeAiSkill(skill: unknown): AiSkill | null {
    if (!skill || typeof skill !== "object") return null;
    const raw = skill as Partial<AiSkill>;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
    const name =
        typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "";
    const content = typeof raw.content === "string" ? raw.content : "";
    if (!id || !name) return null;
    return {
        id,
        name,
        description:
            typeof raw.description === "string" && raw.description.trim()
                ? raw.description.trim()
                : null,
        content,
    };
}

function normalizeStringRecord(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object") return {};
    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(
        value as Record<string, unknown>,
    )) {
        if (typeof entry === "string") result[key] = entry;
    }
    return result;
}

function normalizeStringArrayRecord(
    value: unknown,
): Record<string, string[]> {
    if (!value || typeof value !== "object") return {};
    const result: Record<string, string[]> = {};
    for (const [key, entry] of Object.entries(
        value as Record<string, unknown>,
    )) {
        if (!Array.isArray(entry)) continue;
        result[key] = entry.filter(
            (item): item is string => typeof item === "string",
        );
    }
    return result;
}

export function normalizeLoadedSettings(
    loaded?: PersistedSettings | null,
): AppSettings {
    const base = createDefaultSettings();
    const aiProvider = normalizeAiConfig(loaded?.ai_provider);
    const aiCustomProviders = Array.isArray(loaded?.ai_custom_providers)
        ? loaded!.ai_custom_providers
              .map((config) => normalizeAiConfig(config))
              .filter((config): config is AiProviderConfig => !!config)
        : base.ai_custom_providers;
    return {
        ...base,
        ...(loaded ?? {}),
        theme: normalizeTheme(loaded?.theme),
        ai_provider: aiProvider,
        ai_custom_providers: aiCustomProviders,
        ai_model_prompts: {
            ...base.ai_model_prompts,
            ...normalizeStringRecord(loaded?.ai_model_prompts),
        },
        ai_skills: Array.isArray(loaded?.ai_skills)
            ? loaded!.ai_skills
                  .map((skill) => normalizeAiSkill(skill))
                  .filter((skill): skill is AiSkill => !!skill)
            : base.ai_skills,
        ai_model_skill_ids: {
            ...base.ai_model_skill_ids,
            ...normalizeStringArrayRecord(loaded?.ai_model_skill_ids),
        },
        ai_voice_provider:
            typeof loaded?.ai_voice_provider === "string" &&
            loaded.ai_voice_provider.trim()
                ? loaded.ai_voice_provider.trim()
                : base.ai_voice_provider,
        ai_stt_model:
            typeof loaded?.ai_stt_model === "string" &&
            loaded.ai_stt_model.trim()
                ? loaded.ai_stt_model.trim()
                : base.ai_stt_model,
        ai_tts_voice:
            typeof loaded?.ai_tts_voice === "string" &&
            loaded.ai_tts_voice.trim()
                ? loaded.ai_tts_voice.trim()
                : base.ai_tts_voice,
        ai_tts_language:
            typeof loaded?.ai_tts_language === "string" &&
            loaded.ai_tts_language.trim()
                ? loaded.ai_tts_language.trim()
                : base.ai_tts_language,
        ai_voice_export_folder:
            typeof loaded?.ai_voice_export_folder === "string" &&
            loaded.ai_voice_export_folder.trim()
                ? loaded.ai_voice_export_folder.trim()
                : null,
        font_family:
            typeof loaded?.font_family === "string" && loaded.font_family.trim()
                ? loaded.font_family
                : base.font_family,
        enabled_css_snippets: Array.isArray(loaded?.enabled_css_snippets)
            ? loaded!.enabled_css_snippets
            : base.enabled_css_snippets,
        hotkey_overrides:
            loaded?.hotkey_overrides &&
            typeof loaded.hotkey_overrides === "object"
                ? { ...base.hotkey_overrides, ...loaded.hotkey_overrides }
                : { ...base.hotkey_overrides },
    };
}

export function serializeSettingsForBackend(settings: AppSettings) {
    return {
        ...settings,
        theme: serializeTheme(settings.theme),
    };
}
