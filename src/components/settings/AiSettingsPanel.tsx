/**
 * AI Settings Panel — extracted from SettingsModal.tsx
 * Self-contained component for AI provider, voice, prompt, and skills settings.
 */

import { Component, Show, For, createSignal, createEffect, createMemo } from "solid-js";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { Eye, EyeOff } from "lucide-solid";
import {
    BUILT_IN_ONLINE_PROVIDER_TYPES,
    GROK_STT_MODEL,
    GROK_TTS_VOICES,
    GROK_TTS_LANGUAGE_OPTIONS,
    aiService,
    builtInModelOptions,
    defaultAiProviderConfig,
    isBuiltInOnlineProviderType,
} from "../../stores/aiService";
import {
    aiModelSettingsKey,
    settingsStore,
    type AiProviderConfig,
    type AiProviderType,
    type AiSkill,
    type AppSettings,
} from "../../stores/settings";
import { SettingInput, SettingSelect, SettingSection } from "./controls";
import { confirmDialog } from "../common/ConfirmDialog";
import { t } from "../../i18n";

import { ANTHROPIC_ENDPOINT, DEEPSEEK_ENDPOINT, GEMINI_ENDPOINT, OPENAI_ENDPOINT, XAI_ENDPOINT } from "../../constants/apiEndpoints";
// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const titleStyle = {
    "font-size": "1.3em",
    "font-weight": "700",
    color: "var(--mz-text-primary)",
    "margin-bottom": "20px",
};

const titleActionRowStyle = {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    gap: "12px",
    "margin-bottom": "20px",
} as const;

const settingsButtonStyle = {
    border: "1px solid var(--mz-border)",
    background: "var(--mz-bg-primary)",
    color: "var(--mz-text-primary)",
    "border-radius": "var(--mz-radius-sm)",
    padding: "5px 10px",
    cursor: "pointer",
    "font-size": "var(--mz-font-size-sm)",
    "font-family": "var(--mz-font-sans)",
};

const settingsDangerButtonStyle = {
    ...settingsButtonStyle,
    color: "var(--mz-error)",
};

const settingsRowStyle = {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    padding: "8px 0",
    gap: "16px",
    "min-height": "40px",
};

const settingsLabelStyle = {
    "font-size": "var(--mz-font-size-sm)",
    color: "var(--mz-text-primary)",
    "font-weight": "500",
};

const settingsDescStyle = {
    "font-size": "var(--mz-font-size-xs)",
    color: "var(--mz-text-muted)",
    "margin-top": "2px",
};

const settingsInputBareStyle = {
    padding: "4px 8px",
    color: "var(--mz-text-primary)",
    "font-size": "var(--mz-font-size-sm)",
    "font-family": "var(--mz-font-sans)",
    outline: "none",
};

const aiPromptTextareaStyle = {
    width: "min(520px, 100%)",
    "box-sizing": "border-box",
    height: "120px",
    resize: "vertical",
    padding: "8px 10px",
    border: "1px solid var(--mz-border)",
    "border-radius": "var(--mz-radius-sm)",
    background: "var(--mz-bg-primary)",
    color: "var(--mz-text-primary)",
    "font-size": "var(--mz-font-size-sm)",
    "font-family": "var(--mz-font-sans)",
    outline: "none",
    "line-height": "1.5",
    "flex-shrink": "0",
} as const;

const aiSkillEditorStyle = {
    width: "min(520px, 100%)",
    "box-sizing": "border-box",
    display: "flex",
    "flex-direction": "column",
    gap: "8px",
    "flex-shrink": "0",
} as const;

const aiSkillInputStyle = {
    width: "100%",
    "box-sizing": "border-box",
    border: "1px solid var(--mz-border)",
    "border-radius": "var(--mz-radius-sm)",
    background: "var(--mz-bg-primary)",
} as const;

const aiSkillTextareaStyle = {
    ...aiPromptTextareaStyle,
    width: "100%",
    height: "96px",
} as const;

const aiSkillListStyle = {
    display: "flex",
    "flex-direction": "column",
    gap: "8px",
    "margin-top": "12px",
} as const;

const aiSkillRowStyle = {
    display: "flex",
    "flex-wrap": "wrap",
    "align-items": "flex-start",
    "justify-content": "space-between",
    gap: "12px",
    padding: "10px 0",
    "border-top": "1px solid var(--mz-border)",
} as const;

const aiSkillPreviewStyle = {
    "font-size": "var(--mz-font-size-xs)",
    color: "var(--mz-text-muted)",
    "margin-top": "4px",
    "white-space": "nowrap",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "max-width": "52vw",
} as const;

const aiVoiceExportInputStyle = {
    width: "min(360px, 40vw)",
    "box-sizing": "border-box",
    border: "1px solid var(--mz-border)",
    "border-radius": "var(--mz-radius-sm)",
    background: "var(--mz-bg-primary)",
} as const;

// ---------------------------------------------------------------------------
// Sub-component: AiApiKeyInput
// ---------------------------------------------------------------------------

const AiApiKeyInput: Component<{
    label: string;
    description?: string;
    value: string;
    visible: boolean;
    placeholder?: string;
    width?: string;
    onChange: (value: string) => void;
    onToggleVisible: () => void;
}> = (props) => (
    <div style={settingsRowStyle}>
        <div style={{ flex: "1" }}>
            <div style={settingsLabelStyle}>{props.label}</div>
            <Show when={props.description}>
                <div style={settingsDescStyle}>{props.description}</div>
            </Show>
        </div>
        <div
            style={{
                display: "flex",
                "align-items": "center",
                width: props.width || "220px",
                border: "1px solid var(--mz-border)",
                "border-radius": "var(--mz-radius-sm)",
                background: "var(--mz-bg-primary)",
                "flex-shrink": "0",
            }}>
            <input
                type={props.visible ? "text" : "password"}
                value={props.value}
                placeholder={props.placeholder}
                onInput={(event) => props.onChange(event.currentTarget.value)}
                style={{
                    ...settingsInputBareStyle,
                    flex: "1",
                    width: "0",
                    border: "none",
                    background: "transparent",
                }}
            />
            <button
                type="button"
                title={
                    props.visible
                        ? t("settings.aiHideApiKey")
                        : t("settings.aiShowApiKey")
                }
                aria-label={
                    props.visible
                        ? t("settings.aiHideApiKey")
                        : t("settings.aiShowApiKey")
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={props.onToggleVisible}
                style={{
                    width: "32px",
                    height: "28px",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    border: "none",
                    background: "transparent",
                    color: "var(--mz-text-muted)",
                    cursor: "pointer",
                    "flex-shrink": "0",
                }}>
                <Show
                    when={props.visible}
                    fallback={<Eye size={16} />}>
                    <EyeOff size={16} />
                </Show>
            </button>
        </div>
    </div>
);

// ---------------------------------------------------------------------------
// AiSettingsPanel
// ---------------------------------------------------------------------------

export const AiSettingsPanel: Component = () => {
    // --- Signals ---
    const [aiApiKeyDraft, setAiApiKeyDraft] = createSignal("");
    const [aiApiKeyVisible, setAiApiKeyVisible] = createSignal(false);
    const [aiTestResult, setAiTestResult] = createSignal<string | null>(null);
    const [aiProviderSelectDraft, setAiProviderSelectDraft] = createSignal<
        string | null
    >(null);
    const [aiAddingModel, setAiAddingModel] = createSignal(false);
    const [aiAddModelDraft, setAiAddModelDraft] = createSignal("");
    const [aiAddEndpointDraft, setAiAddEndpointDraft] = createSignal("");
    const [aiSkillEditingId, setAiSkillEditingId] = createSignal<string | null>(
        null,
    );
    const [aiSkillNameDraft, setAiSkillNameDraft] = createSignal("");
    const [aiSkillDescriptionDraft, setAiSkillDescriptionDraft] =
        createSignal("");
    const [aiSkillContentDraft, setAiSkillContentDraft] = createSignal("");
    let aiApiKeyLoadToken = 0;

    // --- Derived memos ---
    const s = () => settingsStore.settings();
    const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
        settingsStore.updateSetting(key, value);
    const aiConfig = (): AiProviderConfig =>
        s().ai_provider ?? defaultAiProviderConfig("Ollama");
    const aiModelKey = () => aiModelSettingsKey(aiConfig());
    const customAiProviders = () => s().ai_custom_providers ?? [];
    const isApiKeyAiProvider = (config = aiConfig()) =>
        config.provider_type !== "Ollama" &&
        config.provider_type !== "LMStudio";
    const isBuiltInOnlineAiProvider = (config = aiConfig()) =>
        isBuiltInOnlineProviderType(config.provider_type);
    const aiBuiltInModelOptions = (config = aiConfig()) => {
        const options = builtInModelOptions(config.provider_type);
        const current = config.model.trim();
        if (!current || options.some((option) => option.value === current))
            return options;
        return [{ value: current, label: current }, ...options];
    };
    const aiCurrentApiProviderOption = () => {
        const config = aiConfig();
        if (!isApiKeyAiProvider(config)) return null;
        if (isBuiltInOnlineAiProvider(config)) return null;
        if (
            config.id &&
            customAiProviders().some((item) => item.id === config.id)
        )
            return null;
        return {
            value: config.id ? `custom:${config.id}` : "current-api-key-llm",
            label:
                config.display_name ||
                config.model ||
                t("settings.aiProviderSavedFallback"),
        };
    };
    const aiProviderValueForConfig = (config: AiProviderConfig) => {
        if (
            config.provider_type === "Ollama" ||
            config.provider_type === "LMStudio" ||
            isBuiltInOnlineProviderType(config.provider_type) ||
            (config.provider_type === "Custom" && !config.id)
        ) {
            return config.provider_type;
        }
        return config.id ? `custom:${config.id}` : "current-api-key-llm";
    };
    const aiProviderSelectValue = () =>
        aiProviderSelectDraft() ?? aiProviderValueForConfig(aiConfig());
    const aiProviderOptions = createMemo(() => {
        const options = [
            { value: "LMStudio", label: "LM Studio" },
            { value: "Ollama", label: "Ollama" },
            ...BUILT_IN_ONLINE_PROVIDER_TYPES.map((provider) => ({
                value: provider,
                label:
                    defaultAiProviderConfig(provider).display_name || provider,
            })),
            ...(aiCurrentApiProviderOption()
                ? [aiCurrentApiProviderOption()!]
                : []),
            ...customAiProviders()
                .filter((config) => !!config.id)
                .map((config) => ({
                    value: `custom:${config.id}`,
                    label:
                        config.display_name ||
                        config.model ||
                        t("settings.aiProviderSavedFallback"),
                })),
        ];
        const selected = aiProviderSelectValue();
        if (!options.some((option) => option.value === selected)) {
            const config = aiConfig();
            options.push({
                value: selected,
                label:
                    config.display_name ||
                    config.model ||
                    t("settings.aiProviderSavedFallback"),
            });
        }
        return options;
    });
    createEffect(() => {
        const draft = aiProviderSelectDraft();
        if (draft && draft === aiProviderValueForConfig(aiConfig())) {
            setAiProviderSelectDraft(null);
        }
    });
    const activeCustomProviderSaved = () => {
        const id = aiConfig().id;
        return !!id && customAiProviders().some((config) => config.id === id);
    };
    const isLocalAiProvider = (config = aiConfig()) =>
        config.provider_type === "Ollama" ||
        config.provider_type === "LMStudio";
    const aiVoiceProviderOptions = [{ value: "Grok", label: "Grok STT / TTS" }];
    const aiSttModelOptions = [{ value: GROK_STT_MODEL, label: "Grok STT" }];
    const aiAddMode = () => aiAddingModel();
    const aiProviderKindLabel = () =>
        isLocalAiProvider()
            ? t("settings.aiLocalModel")
            : t("settings.aiOnlineModel");
    const aiOnlineEndpointPlaceholder = () => {
        const providerDefault = defaultAiProviderConfig(
            aiConfig().provider_type,
        ).endpoint;
        if (!aiAddMode() && providerDefault) return providerDefault;
        const model = aiAddMode()
            ? aiAddModelDraft().toLowerCase()
            : `${aiConfig().display_name ?? ""} ${aiConfig().model ?? ""}`.toLowerCase();
        if (model.includes("gemini"))
            return GEMINI_ENDPOINT;
        if (model.includes("grok") || model.includes("xai"))
            return XAI_ENDPOINT;
        if (model.includes("claude")) return ANTHROPIC_ENDPOINT;
        if (model.includes("deepseek")) return DEEPSEEK_ENDPOINT;
        return OPENAI_ENDPOINT;
    };

    // --- Handlers ---
    function loadAiApiKeyIntoDraft(config: AiProviderConfig) {
        const token = ++aiApiKeyLoadToken;
        if (aiAddMode()) {
            setAiApiKeyVisible(false);
            return;
        }
        if (!isApiKeyAiProvider(config)) {
            setAiApiKeyVisible(false);
            setAiApiKeyDraft("");
            return;
        }
        setAiApiKeyVisible(false);
        void aiService.loadApiKey(config).then((key) => {
            if (token !== aiApiKeyLoadToken) return;
            setAiApiKeyDraft(key ?? "");
        }).catch(console.error);
    }
    createEffect(() => {
        loadAiApiKeyIntoDraft(aiConfig());
    });
    function selectAiProvider(value: string) {
        setAiTestResult(null);
        setAiApiKeyVisible(false);
        if (value === "current-api-key-llm") {
            setAiProviderSelectDraft(value);
            setAiAddingModel(false);
            loadAiApiKeyIntoDraft(aiConfig());
            return;
        }
        if (value.startsWith("custom:")) {
            const id = value.slice("custom:".length);
            const config =
                customAiProviders().find((item) => item.id === id) ??
                (aiConfig().id === id ? aiConfig() : null);
            if (!config) {
                setAiProviderSelectDraft(null);
                return;
            }
            setAiProviderSelectDraft(value);
            setAiAddingModel(false);
            setAiApiKeyDraft("");
            set("ai_provider", { ...config });
            loadAiApiKeyIntoDraft(config);
            return;
        }
        const providerType = value as AiProviderType;
        const config = isBuiltInOnlineProviderType(providerType)
            ? (customAiProviders().find(
                  (item) => item.provider_type === providerType && !item.id,
              ) ?? defaultAiProviderConfig(providerType))
            : defaultAiProviderConfig(providerType);
        setAiProviderSelectDraft(value);
        setAiAddingModel(false);
        setAiApiKeyDraft("");
        set("ai_provider", config);
        loadAiApiKeyIntoDraft(config);
    }
    function createApiKeyProviderConfig(): AiProviderConfig {
        return {
            ...defaultAiProviderConfig("ApiKeyLLM"),
            id: `api-key-llm-${Date.now()}`,
        };
    }
    function updateAiConfig(patch: Partial<AiProviderConfig>) {
        set("ai_provider", { ...aiConfig(), ...patch });
        setAiTestResult(null);
    }
    const aiModelPrompt = () => s().ai_model_prompts?.[aiModelKey()] ?? "";
    const aiSkills = () => s().ai_skills ?? [];
    const selectedAiSkillIds = () =>
        new Set(s().ai_model_skill_ids?.[aiModelKey()] ?? []);
    function updateAiModelPrompt(value: string) {
        const key = aiModelKey();
        void set("ai_model_prompts", {
            ...(s().ai_model_prompts ?? {}),
            [key]: value,
        });
    }
    function updateAiModelSkillSelection(skillId: string, enabled: boolean) {
        const key = aiModelKey();
        const existing = s().ai_model_skill_ids?.[key] ?? [];
        const next = enabled
            ? Array.from(new Set([...existing, skillId]))
            : existing.filter((id) => id !== skillId);
        void set("ai_model_skill_ids", {
            ...(s().ai_model_skill_ids ?? {}),
            [key]: next,
        });
    }
    async function selectAiVoiceExportFolder() {
        try {
            const selected = await dialogOpen({
                directory: true,
                title: t("settings.aiVoiceExportFolderSelect"),
            });
            if (selected && typeof selected === "string") {
                await set("ai_voice_export_folder", selected);
            }
        } catch (e) {
            console.error("Failed to select AI voice export folder:", e);
        }
    }
    function resetAiSkillDrafts() {
        setAiSkillEditingId(null);
        setAiSkillNameDraft("");
        setAiSkillDescriptionDraft("");
        setAiSkillContentDraft("");
    }
    function editAiSkill(skill: AiSkill) {
        setAiSkillEditingId(skill.id);
        setAiSkillNameDraft(skill.name);
        setAiSkillDescriptionDraft(skill.description ?? "");
        setAiSkillContentDraft(skill.content);
    }
    async function saveAiSkill() {
        try {
            const name = aiSkillNameDraft().trim();
            if (!name) {
                setAiTestResult(t("settings.aiSkillNameRequired"));
                return;
            }
            const nextSkill: AiSkill = {
                id: aiSkillEditingId() || `skill-${Date.now()}`,
                name,
                description: aiSkillDescriptionDraft().trim() || null,
                content: aiSkillContentDraft().trim(),
            };
            const existing = aiSkills();
            const next = existing.some((skill) => skill.id === nextSkill.id)
                ? existing.map((skill) =>
                      skill.id === nextSkill.id ? nextSkill : skill,
                  )
                : [...existing, nextSkill];
            await set("ai_skills", next);
            resetAiSkillDrafts();
            setAiTestResult(t("settings.aiSkillSaved"));
        } catch (e: any) {
            setAiTestResult(`${t("settings.aiSkillSaveError")}: ${e?.message || String(e)}`);
        }
    }
    async function deleteAiSkill(skill: AiSkill) {
        try {
            const confirmed = await confirmDialog(
                t("settings.aiSkillDeleteConfirm", { name: skill.name }),
                { confirmLabel: t("common.delete"), variant: "danger" },
            );
            if (!confirmed) return;
            const nextSkills = aiSkills().filter((item) => item.id !== skill.id);
            const nextSelections = Object.fromEntries(
                Object.entries(s().ai_model_skill_ids ?? {}).map(([key, ids]) => [
                    key,
                    ids.filter((id) => id !== skill.id),
                ]),
            );
            await set("ai_skills", nextSkills);
            await set("ai_model_skill_ids", nextSelections);
            if (aiSkillEditingId() === skill.id) resetAiSkillDrafts();
            setAiTestResult(t("settings.aiSkillDeleted"));
        } catch (e: any) {
            setAiTestResult(`${t("settings.aiSkillDeleteError")}: ${e?.message || String(e)}`);
        }
    }
    async function saveAiProvider(showStatus = true): Promise<boolean> {
        try {
            const current = aiConfig();
            const providerDefault = defaultAiProviderConfig(current.provider_type);
            const next: AiProviderConfig = {
                ...current,
                endpoint: current.endpoint?.trim() || null,
                display_name: isBuiltInOnlineAiProvider(current)
                    ? (providerDefault.display_name ?? current.display_name ?? null)
                    : current.model.trim() || current.display_name || null,
            };
            if (!next.model.trim()) {
                if (showStatus) setAiTestResult(t("settings.aiModelRequired"));
                return false;
            }
            const value = aiApiKeyDraft().trim();
            if (isApiKeyAiProvider(next)) {
                next.api_key = value || null;
                next.has_api_key = value.length > 0;
            }
            if (isApiKeyAiProvider(next) && isBuiltInOnlineAiProvider(next)) {
                const providers = customAiProviders();
                const exists = providers.some(
                    (config) =>
                        config.provider_type === next.provider_type && !config.id,
                );
                const updated = exists
                    ? providers.map((config) =>
                          config.provider_type === next.provider_type && !config.id
                              ? next
                              : config,
                      )
                    : [...providers, next];
                await set("ai_custom_providers", updated);
            } else if (isApiKeyAiProvider(next)) {
                next.id = next.id || `api-key-llm-${Date.now()}`;
                const providers = customAiProviders();
                const exists = providers.some((config) => config.id === next.id);
                const updated = exists
                    ? providers.map((config) =>
                          config.id === next.id ? next : config,
                      )
                    : [...providers, next];
                await set("ai_custom_providers", updated);
            }
            await set("ai_provider", next);
            setAiApiKeyDraft(value);
            setAiApiKeyVisible(false);
            if (showStatus) setAiTestResult(t("settings.aiProviderSaved"));
            return true;
        } catch (e: any) {
            if (showStatus) setAiTestResult(`${t("settings.aiProviderSaveError")}: ${e?.message || String(e)}`);
            return false;
        }
    }
    async function saveNewAiProvider() {
        try {
            const model = aiAddModelDraft().trim();
            if (!model) {
                setAiTestResult(t("settings.aiModelRequired"));
                return;
            }
            const apiKey = aiApiKeyDraft().trim();
            const endpoint = aiAddEndpointDraft().trim();
            const next: AiProviderConfig = {
                ...createApiKeyProviderConfig(),
                model,
                display_name: model,
                endpoint: endpoint || null,
                api_key: apiKey || null,
                has_api_key: apiKey.length > 0,
            };
            await set("ai_custom_providers", [...customAiProviders(), next]);
            await set("ai_provider", next);
            setAiAddModelDraft("");
            setAiAddEndpointDraft("");
            setAiApiKeyDraft(apiKey);
            setAiApiKeyVisible(false);
            setAiAddingModel(false);
            setAiTestResult(t("settings.aiProviderSaved"));
        } catch (e: any) {
            setAiTestResult(`${t("settings.aiProviderSaveError")}: ${e?.message || String(e)}`);
        }
    }
    async function deleteAiProvider() {
        try {
            const current = aiConfig();
            if (!current.id) return;
            const confirmed = await confirmDialog(
                t("settings.aiDeleteProviderConfirm", {
                    name:
                        current.display_name ||
                        current.model ||
                        t("settings.aiProviderSavedFallback"),
                }),
                { confirmLabel: t("common.delete"), variant: "danger" },
            );
            if (!confirmed) return;
            await set(
                "ai_custom_providers",
                customAiProviders().filter((config) => config.id !== current.id),
            );
            await set("ai_provider", defaultAiProviderConfig("Ollama"));
            setAiApiKeyDraft("");
            setAiApiKeyVisible(false);
            setAiAddingModel(false);
            setAiTestResult(t("settings.aiProviderDeleted"));
        } catch (e: any) {
            setAiTestResult(`${t("settings.aiProviderDeleteError")}: ${e?.message || String(e)}`);
        }
    }
    async function testAiConfig() {
        setAiTestResult(t("settings.aiTesting"));
        try {
            if (isApiKeyAiProvider()) {
                const saved = await saveAiProvider(false);
                if (!saved) {
                    setAiTestResult(t("settings.aiModelRequired"));
                    return;
                }
            }
            const result = await aiService.testConnection(aiConfig());
            const lines = [t("settings.aiConnected")];
            if (result.model) {
                lines.push(
                    t("settings.aiDetectedModel", { model: result.model }),
                );
            }
            if (result.content) {
                lines.push(result.content);
            }
            setAiTestResult(lines.join("\n"));
        } catch (e: any) {
            setAiTestResult(
                `${t("settings.aiConnectionFailed")}: ${e?.message || String(e)}`,
            );
        }
    }

    // --- JSX ---
    return (
        <>
            <div style={titleActionRowStyle}>
                <h2 style={{ ...titleStyle, "margin-bottom": "0" }}>
                    {t("settings.ai")}
                </h2>
                <Show when={!aiAddMode()}>
                    <button
                        onClick={() => {
                            setAiAddingModel(true);
                            setAiAddModelDraft("");
                            setAiAddEndpointDraft("");
                            setAiApiKeyDraft("");
                            setAiApiKeyVisible(false);
                            setAiTestResult(null);
                        }}
                        style={settingsButtonStyle}>
                        {t("settings.aiAddNewModel")}
                    </button>
                </Show>
            </div>

            <SettingSection
                title={
                    aiAddMode()
                        ? t("settings.aiAddModelSection")
                        : t("settings.aiProviderSection")
                }>
                <Show
                    when={aiAddMode()}
                    fallback={
                        <>
                            <SettingSelect
                                label={aiProviderKindLabel()}
                                description={
                                    isLocalAiProvider()
                                        ? t(
                                              "settings.aiLocalModelDescription",
                                          )
                                        : t(
                                              "settings.aiOnlineModelDescription",
                                          )
                                }
                                value={aiProviderSelectValue()}
                                options={aiProviderOptions()}
                                width="190px"
                                onChange={selectAiProvider}
                            />
                            <Show when={isLocalAiProvider()}>
                                <SettingInput
                                    label={t("settings.aiEndpoint")}
                                    description={t(
                                        "settings.aiEndpointDescription",
                                    )}
                                    value={
                                        aiConfig().endpoint ?? ""
                                    }
                                    placeholder={
                                        defaultAiProviderConfig(
                                            aiConfig()
                                                .provider_type,
                                        ).endpoint ?? ""
                                    }
                                    width="290px"
                                    onChange={(value) =>
                                        updateAiConfig({
                                            endpoint:
                                                value.trim() ||
                                                null,
                                        })
                                    }
                                />
                            </Show>
                            <Show when={isApiKeyAiProvider()}>
                                <Show
                                    when={isBuiltInOnlineAiProvider()}
                                    fallback={
                                        <SettingInput
                                            label={t(
                                                "settings.aiModel",
                                            )}
                                            description={t(
                                                "settings.aiModelDescription",
                                            )}
                                            value={aiConfig().model}
                                            placeholder={t(
                                                "settings.aiModelPlaceholder",
                                            )}
                                            width="290px"
                                            onChange={(value) =>
                                                updateAiConfig({
                                                    model: value.trim(),
                                                })
                                            }
                                        />
                                    }>
                                    <SettingSelect
                                        label={t(
                                            "settings.aiModel",
                                        )}
                                        description={t(
                                            "settings.aiModelDescription",
                                        )}
                                        value={aiConfig().model}
                                        options={aiBuiltInModelOptions()}
                                        width="290px"
                                        onChange={(value) =>
                                            updateAiConfig({
                                                model: value,
                                            })
                                        }
                                    />
                                </Show>
                                <AiApiKeyInput
                                    label={t("settings.aiApiKey")}
                                    description={
                                        aiConfig().has_api_key
                                            ? t(
                                                  "settings.aiApiKeyStored",
                                              )
                                            : t(
                                                  "settings.aiApiKeyDescription",
                                              )
                                    }
                                    value={aiApiKeyDraft()}
                                    visible={aiApiKeyVisible()}
                                    placeholder={t(
                                        "settings.aiApiKeyPlaceholder",
                                    )}
                                    width="290px"
                                    onChange={setAiApiKeyDraft}
                                    onToggleVisible={() =>
                                        setAiApiKeyVisible(
                                            (value) => !value,
                                        )
                                    }
                                />
                                <Show
                                    when={
                                        !isBuiltInOnlineAiProvider()
                                    }>
                                    <SettingInput
                                        label={t(
                                            "settings.aiEndpoint",
                                        )}
                                        description={t(
                                            "settings.aiOnlineEndpointDescription",
                                        )}
                                        value={
                                            aiConfig().endpoint ??
                                            ""
                                        }
                                        placeholder={aiOnlineEndpointPlaceholder()}
                                        width="360px"
                                        onChange={(value) =>
                                            updateAiConfig({
                                                endpoint:
                                                    value.trim() ||
                                                    null,
                                            })
                                        }
                                    />
                                </Show>
                            </Show>
                            <div
                                style={{
                                    display: "flex",
                                    gap: "12px",
                                    "justify-content": "flex-end",
                                    padding: "14px 0 4px",
                                }}>
                                <Show when={isApiKeyAiProvider()}>
                                    <Show
                                        when={activeCustomProviderSaved()}>
                                        <button
                                            onClick={() =>
                                                void deleteAiProvider()
                                            }
                                            style={
                                                settingsDangerButtonStyle
                                            }>
                                            {t(
                                                "settings.aiDeleteProvider",
                                            )}
                                        </button>
                                    </Show>
                                    <button
                                        onClick={() =>
                                            void saveAiProvider()
                                        }
                                        style={settingsButtonStyle}>
                                        {t("common.save")}
                                    </button>
                                </Show>
                                <button
                                    onClick={() =>
                                        void testAiConfig()
                                    }
                                    style={settingsButtonStyle}>
                                    {t("settings.aiTest")}
                                </button>
                            </div>
                        </>
                    }>
                    <SettingInput
                        label={t("settings.aiModel")}
                        description={t(
                            "settings.aiModelDescription",
                        )}
                        value={aiAddModelDraft()}
                        placeholder={t(
                            "settings.aiModelPlaceholder",
                        )}
                        width="360px"
                        onChange={setAiAddModelDraft}
                    />
                    <AiApiKeyInput
                        label={t("settings.aiApiKey")}
                        description={t(
                            "settings.aiApiKeyDescription",
                        )}
                        value={aiApiKeyDraft()}
                        visible={aiApiKeyVisible()}
                        placeholder={t(
                            "settings.aiApiKeyPlaceholder",
                        )}
                        width="360px"
                        onChange={setAiApiKeyDraft}
                        onToggleVisible={() =>
                            setAiApiKeyVisible((value) => !value)
                        }
                    />
                    <SettingInput
                        label={t("settings.aiEndpoint")}
                        description={t(
                            "settings.aiOnlineEndpointDescription",
                        )}
                        value={aiAddEndpointDraft()}
                        placeholder={aiOnlineEndpointPlaceholder()}
                        width="360px"
                        onChange={(value) => {
                            setAiAddEndpointDraft(value.trim());
                            setAiTestResult(null);
                        }}
                    />
                    <div
                        style={{
                            display: "flex",
                            gap: "36px",
                            "justify-content": "flex-end",
                            padding: "48px 0 4px",
                        }}>
                        <button
                            onClick={() => {
                                setAiAddingModel(false);
                                setAiAddModelDraft("");
                                setAiAddEndpointDraft("");
                                setAiApiKeyDraft("");
                                setAiApiKeyVisible(false);
                                setAiTestResult(null);
                            }}
                            style={{
                                ...settingsButtonStyle,
                                width: "160px",
                            }}>
                            {t("common.cancel")}
                        </button>
                        <button
                            onClick={() => void saveNewAiProvider()}
                            style={{
                                ...settingsButtonStyle,
                                width: "160px",
                                color: "var(--mz-accent)",
                                border: "1px solid var(--mz-accent)",
                            }}>
                            {t("settings.aiSaveAdd")}
                        </button>
                    </div>
                </Show>
                <Show when={aiTestResult()}>
                    <div
                        style={{
                            color: "var(--mz-text-muted)",
                            "font-size": "var(--mz-font-size-xs)",
                            "white-space": "pre-wrap",
                            "padding-top": "8px",
                            "user-select": "text",
                            "-webkit-user-select": "text",
                            cursor: "text",
                        }}>
                        {aiTestResult()}
                    </div>
                </Show>
            </SettingSection>

            <Show when={!aiAddMode()}>
                <Show when={false}>
                    <SettingSection
                        title={t("settings.aiVoiceSection")}>
                        <SettingSelect
                            label={t("settings.aiVoiceProvider")}
                            description={t(
                                "settings.aiVoiceProviderDescription",
                            )}
                            value={s().ai_voice_provider}
                            options={aiVoiceProviderOptions}
                            width="190px"
                            onChange={(value) =>
                                set("ai_voice_provider", value)
                            }
                        />
                        <SettingSelect
                            label={t("settings.aiSttModel")}
                            description={t(
                                "settings.aiSttModelDescription",
                            )}
                            value={s().ai_stt_model}
                            options={aiSttModelOptions}
                            width="190px"
                            onChange={(value) =>
                                set("ai_stt_model", value)
                            }
                        />
                        <SettingSelect
                            label={t("settings.aiTtsVoice")}
                            description={t(
                                "settings.aiTtsVoiceDescription",
                            )}
                            value={s().ai_tts_voice}
                            options={GROK_TTS_VOICES}
                            width="190px"
                            onChange={(value) =>
                                set("ai_tts_voice", value)
                            }
                        />
                        <SettingSelect
                            label={t("settings.aiTtsLanguage")}
                            description={t(
                                "settings.aiTtsLanguageDescription",
                            )}
                            value={s().ai_tts_language}
                            options={GROK_TTS_LANGUAGE_OPTIONS}
                            width="190px"
                            onChange={(value) =>
                                set("ai_tts_language", value)
                            }
                        />
                        <div
                            style={{
                                ...settingsRowStyle,
                                "align-items": "center",
                                "flex-wrap": "wrap",
                            }}>
                            <div
                                style={{
                                    flex: "1",
                                    "min-width": "180px",
                                }}>
                                <div style={settingsLabelStyle}>
                                    {t(
                                        "settings.aiVoiceExportFolder",
                                    )}
                                </div>
                                <div style={settingsDescStyle}>
                                    {t(
                                        "settings.aiVoiceExportFolderDescription",
                                    )}
                                </div>
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    "align-items": "center",
                                    gap: "8px",
                                    "flex-shrink": "0",
                                    "max-width": "100%",
                                }}>
                                <input
                                    type="text"
                                    value={
                                        s()
                                            .ai_voice_export_folder ||
                                        ""
                                    }
                                    placeholder={t(
                                        "settings.aiVoiceExportFolderPlaceholder",
                                    )}
                                    onInput={(event) =>
                                        set(
                                            "ai_voice_export_folder",
                                            event.currentTarget.value.trim() ||
                                                null,
                                        )
                                    }
                                    style={{
                                        ...settingsInputBareStyle,
                                        ...aiVoiceExportInputStyle,
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() =>
                                        void selectAiVoiceExportFolder()
                                    }
                                    style={settingsButtonStyle}>
                                    {t(
                                        "settings.aiVoiceExportFolderChoose",
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        set(
                                            "ai_voice_export_folder",
                                            null,
                                        )
                                    }
                                    style={settingsButtonStyle}>
                                    {t("common.reset")}
                                </button>
                            </div>
                        </div>
                    </SettingSection>
                </Show>

                <SettingSection
                    title={t("settings.aiPromptSection")}>
                    <div
                        style={{
                            ...settingsRowStyle,
                            "align-items": "flex-start",
                            "flex-wrap": "wrap",
                        }}>
                        <div
                            style={{
                                flex: "1",
                                "min-width": "180px",
                            }}>
                            <div style={settingsLabelStyle}>
                                {t("settings.aiModelPrompt")}
                            </div>
                            <div style={settingsDescStyle}>
                                {t(
                                    "settings.aiModelPromptDescription",
                                )}
                            </div>
                        </div>
                        <textarea
                            value={aiModelPrompt()}
                            placeholder={t(
                                "settings.aiModelPromptPlaceholder",
                            )}
                            onInput={(event) =>
                                updateAiModelPrompt(
                                    event.currentTarget.value,
                                )
                            }
                            style={aiPromptTextareaStyle}
                        />
                    </div>
                </SettingSection>

                <SettingSection
                    title={t("settings.aiSkillsSection")}>
                    <div
                        style={{
                            ...settingsRowStyle,
                            "align-items": "flex-start",
                            "flex-wrap": "wrap",
                        }}>
                        <div
                            style={{
                                flex: "1",
                                "min-width": "180px",
                            }}>
                            <div style={settingsLabelStyle}>
                                {t("settings.aiSkillEditor")}
                            </div>
                            <div style={settingsDescStyle}>
                                {t("settings.aiSkillsDescription")}
                            </div>
                        </div>
                        <div style={aiSkillEditorStyle}>
                            <input
                                value={aiSkillNameDraft()}
                                placeholder={t(
                                    "settings.aiSkillNamePlaceholder",
                                )}
                                onInput={(event) =>
                                    setAiSkillNameDraft(
                                        event.currentTarget.value,
                                    )
                                }
                                style={{
                                    ...settingsInputBareStyle,
                                    ...aiSkillInputStyle,
                                }}
                            />
                            <input
                                value={aiSkillDescriptionDraft()}
                                placeholder={t(
                                    "settings.aiSkillDescriptionPlaceholder",
                                )}
                                onInput={(event) =>
                                    setAiSkillDescriptionDraft(
                                        event.currentTarget.value,
                                    )
                                }
                                style={{
                                    ...settingsInputBareStyle,
                                    ...aiSkillInputStyle,
                                }}
                            />
                            <textarea
                                value={aiSkillContentDraft()}
                                placeholder={t(
                                    "settings.aiSkillContentPlaceholder",
                                )}
                                onInput={(event) =>
                                    setAiSkillContentDraft(
                                        event.currentTarget.value,
                                    )
                                }
                                style={aiSkillTextareaStyle}
                            />
                            <div
                                style={{
                                    display: "flex",
                                    "justify-content": "flex-end",
                                    gap: "8px",
                                }}>
                                <Show when={aiSkillEditingId()}>
                                    <button
                                        onClick={resetAiSkillDrafts}
                                        style={settingsButtonStyle}>
                                        {t("common.cancel")}
                                    </button>
                                </Show>
                                <button
                                    onClick={() =>
                                        void saveAiSkill()
                                    }
                                    style={settingsButtonStyle}>
                                    {aiSkillEditingId()
                                        ? t(
                                              "settings.aiSkillUpdate",
                                          )
                                        : t("settings.aiSkillAdd")}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div style={aiSkillListStyle}>
                        <Show
                            when={aiSkills().length > 0}
                            fallback={
                                <div
                                    style={{
                                        color: "var(--mz-text-muted)",
                                        "font-size":
                                            "var(--mz-font-size-xs)",
                                        padding: "8px 0",
                                    }}>
                                    {t("settings.aiSkillsEmpty")}
                                </div>
                            }>
                            <For each={aiSkills()}>
                                {(skill) => {
                                    const selected = () =>
                                        selectedAiSkillIds().has(
                                            skill.id,
                                        );
                                    return (
                                        <div
                                            style={aiSkillRowStyle}>
                                            <label
                                                style={{
                                                    display: "flex",
                                                    "align-items":
                                                        "flex-start",
                                                    gap: "10px",
                                                    flex: "1",
                                                    "min-width":
                                                        "0",
                                                    cursor: "pointer",
                                                }}>
                                                <span
                                                    style={{
                                                        width: "16px",
                                                        height: "20px",
                                                        display:
                                                            "inline-flex",
                                                        "align-items":
                                                            "center",
                                                        "justify-content":
                                                            "center",
                                                        "flex-shrink":
                                                            "0",
                                                    }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selected()}
                                                        onChange={(
                                                            event,
                                                        ) =>
                                                            updateAiModelSkillSelection(
                                                                skill.id,
                                                                event
                                                                    .currentTarget
                                                                    .checked,
                                                            )
                                                        }
                                                        style={{
                                                            margin: "0",
                                                            width: "14px",
                                                            height: "14px",
                                                        }}
                                                    />
                                                </span>
                                                <div
                                                    style={{
                                                        "min-width":
                                                            "0",
                                                    }}>
                                                    <div
                                                        style={
                                                            settingsLabelStyle
                                                        }>
                                                        {skill.name}
                                                    </div>
                                                    <Show
                                                        when={
                                                            skill.description
                                                        }>
                                                        <div
                                                            style={
                                                                settingsDescStyle
                                                            }>
                                                            {
                                                                skill.description
                                                            }
                                                        </div>
                                                    </Show>
                                                    <div
                                                        style={
                                                            aiSkillPreviewStyle
                                                        }>
                                                        {skill.content ||
                                                            t(
                                                                "settings.aiSkillNoContent",
                                                            )}
                                                    </div>
                                                </div>
                                            </label>
                                            <div
                                                style={{
                                                    display: "flex",
                                                    gap: "8px",
                                                    "flex-shrink":
                                                        "0",
                                                }}>
                                                <button
                                                    onClick={() =>
                                                        editAiSkill(
                                                            skill,
                                                        )
                                                    }
                                                    style={
                                                        settingsButtonStyle
                                                    }>
                                                    {t(
                                                        "settings.aiSkillEdit",
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        void deleteAiSkill(
                                                            skill,
                                                        )
                                                    }
                                                    style={
                                                        settingsDangerButtonStyle
                                                    }>
                                                    {t(
                                                        "common.delete",
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                }}
                            </For>
                        </Show>
                    </div>
                </SettingSection>
            </Show>
        </>
    );
};
