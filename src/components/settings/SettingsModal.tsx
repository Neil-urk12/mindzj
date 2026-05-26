/**
 * MindZJ Settings Modal
 * Full-screen settings panel inspired by  settings page.
 */

import {
    Component,
    Show,
    For,
    createSignal,
    createMemo,
    onMount,
    onCleanup,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import {
    settingsStore,
    type AppSettings,
    DEFAULT_FONT_FAMILY,
} from "../../stores/settings";
import type { ViewMode } from "../../types";
import {
    SettingToggle,
    SettingInput,
    SettingSelect,
    SettingColor,
    SettingSection,
    SettingSlider,
} from "./controls";
import { getLanguageOptions, t } from "../../i18n";
import { DEFAULT_ATTACHMENT_FOLDER } from "../../constants/vaultPaths";
import { AiSettingsPanel } from "./AiSettingsPanel";
import { PluginsPanel } from "./PluginsPanel";
import { HotkeysPanel } from "./HotkeysPanel";
import { AboutPanel } from "./AboutPanel";
import { PluginSettingsPanel } from "./PluginSettingsPanel";
import { CssSnippetsPanel } from "./CssSnippetsPanel";
import { SkinPickerPanel } from "./SkinPickerPanel";
import { titleStyle, titleSelectStyle } from "./styles";


type SettingsCategory =
    | "editor"
    | "appearance"
    | "images"
    | "ai"
    | "files"
    | "hotkeys"
    | "plugins"
    | "plugin-settings"
    | "about";

interface SettingsModalProps {
    onClose: () => void;
}

const CATEGORIES: { id: SettingsCategory; key: string; icon: string }[] = [
    {
        id: "editor",
        key: "settings.editor",
        icon: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7",
    },
    {
        id: "appearance",
        key: "settings.appearance",
        icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
    },
    {
        id: "images",
        key: "settings.images",
        icon: "M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z M21 15l-5-5L5 21",
    },
    {
        id: "ai",
        key: "settings.ai",
        icon: "M12 2a10 10 0 100 20 10 10 0 000-20z M8 12h8 M12 8v8 M7.5 7.5l9 9 M16.5 7.5l-9 9",
    },
    {
        id: "files",
        key: "settings.files",
        icon: "M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z M13 2v7h7",
    },
    {
        id: "hotkeys",
        key: "settings.hotkeys",
        icon: "M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z",
    },
    {
        id: "plugins",
        key: "settings.plugins",
        icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    },
    {
        id: "about",
        key: "settings.about",
        icon: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 16v-4 M12 8h.01",
    },
];

const FONT_FAMILY_OPTIONS = [
    { value: DEFAULT_FONT_FAMILY, label: "Inter / Cross-platform" },
    {
        value: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
        label: "Segoe UI / Windows",
    },
    {
        value: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", sans-serif',
        label: "SF Pro / macOS",
    },
    {
        value: '"Ubuntu", "Noto Sans", "DejaVu Sans", "Liberation Sans", sans-serif',
        label: "Ubuntu / Linux",
    },
    {
        value: '"Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif',
        label: "Noto Sans",
    },
    {
        value: '"Source Sans 3", "Segoe UI", sans-serif',
        label: "Source Sans 3",
    },
    {
        value: '"IBM Plex Sans", "Segoe UI", sans-serif',
        label: "IBM Plex Sans",
    },
    { value: 'Georgia, "Times New Roman", serif', label: "Georgia / Serif" },
];

export const SettingsModal: Component<SettingsModalProps> = (props) => {
    const [activeTab, setActiveTab] = createSignal<SettingsCategory>("editor");
    const [activePluginId, setActivePluginId] = createSignal<string | null>(
        null,
    );
    const [activePluginName, setActivePluginName] = createSignal<string>("");
    let modalRootRef: HTMLDivElement | undefined;

    function handleKeydown(e: KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        props.onClose();
    }

    onMount(() => {
        // Capture phase so we handle Escape before any input inside the
        // plugin's injected settings UI can eat the keydown event.
        window.addEventListener("keydown", handleKeydown, true);
        document.addEventListener("keydown", handleKeydown, true);
        // Listen for plugin settings navigation from plugin's openPluginSettings()
        const handleNav = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.pluginId) {
                // Look up plugin name from loaded plugins
                const plugins = window.__mindzj_loadedPlugins || [];
                const found = plugins.find(
                    (p: any) => p.id === detail.pluginId,
                );
                setActivePluginId(detail.pluginId);
                setActivePluginName(found?.manifest?.name || detail.pluginId);
                setActiveTab("plugin-settings");
            }
        };
        document.addEventListener("mindzj:settings-navigate", handleNav);
        onCleanup(() =>
            document.removeEventListener("mindzj:settings-navigate", handleNav),
        );
    });
    onCleanup(() => {
        window.removeEventListener("keydown", handleKeydown, true);
        document.removeEventListener("keydown", handleKeydown, true);
    });

    const s = () => settingsStore.settings();
    const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
        settingsStore.updateSetting(key, value);
    const fontFamilyOptions = createMemo(() => {
        const current = s().font_family?.trim() || DEFAULT_FONT_FAMILY;
        return FONT_FAMILY_OPTIONS.some((option) => option.value === current)
            ? FONT_FAMILY_OPTIONS
            : [
                  {
                      value: current,
                      label: t("settings.fontFamilyCustomOption"),
                  },
                  ...FONT_FAMILY_OPTIONS,
              ];
    });

    const renderCustomEditorSettings = () => (
        <SettingSection title={t("settings.custom")}>
            <SettingColor
                label={t("settings.accentColor")}
                description={t("settings.accentColorDescription")}
                value={s().accent_color || "#1aad3f"}
                onChange={(v) => set("accent_color", v)}
                onClear={() => set("accent_color", "#1aad3f")}
            />
            <SettingColor
                label={t("settings.headingColor")}
                description={t("settings.headingColorDescription")}
                value={s().heading_color || "#e5c07b"}
                onChange={(v) => set("heading_color", v)}
                onClear={() => set("heading_color", null)}
            />
            <SettingColor
                label={t("settings.linkColor")}
                description={t("settings.linkColorDescription")}
                value={s().link_color || "#528bff"}
                onChange={(v) => set("link_color", v)}
                onClear={() => set("link_color", null)}
            />
            <SettingColor
                label={t("settings.highlightColor")}
                description={t("settings.highlightColorDescription")}
                value={s().highlight_color || "#fff59d"}
                onChange={(v) => set("highlight_color", v)}
                onClear={() => set("highlight_color", null)}
            />
            <SettingColor
                label={t("settings.boldColor")}
                description={t("settings.boldColorDescription")}
                value={s().bold_color || "#e06c75"}
                onChange={(v) => set("bold_color", v)}
                onClear={() => set("bold_color", null)}
            />
            <SettingColor
                label={t("settings.selectionColor")}
                description={t("settings.selectionColorDescription")}
                value={s().selection_color || "#528bff"}
                onChange={(v) => set("selection_color", v)}
                onClear={() => set("selection_color", null)}
            />
            <SettingColor
                label={t("settings.dragIndicatorColor")}
                description={t("settings.dragIndicatorColorDescription")}
                value={s().drag_indicator_color || "#1aad3f"}
                onChange={(v) => set("drag_indicator_color", v)}
                onClear={() => set("drag_indicator_color", null)}
            />
            <SettingToggle
                label={t("settings.showMarkdownToolbar")}
                description={t("settings.showMarkdownToolbarDescription")}
                value={s().show_markdown_toolbar}
                onChange={(v) => set("show_markdown_toolbar", v)}
            />
            <SettingToggle
                label={t("settings.autoLinkUrls")}
                description={t("settings.autoLinkUrlsDescription")}
                value={s().auto_link_urls}
                onChange={(v) => set("auto_link_urls", v)}
            />
        </SettingSection>
    );

    return (
        <div
            ref={modalRootRef}
            class="mz-settings-modal"
            style={{
                position: "fixed",
                inset: "0",
                "z-index": "9999",
                display: "flex",
                background: "rgba(0,0,0,0.5)",
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) props.onClose();
            }}>
            <div
                style={{
                    display: "flex",
                    width: "min(1040px, 92vw)",
                    height: "min(780px, 90vh)",
                    margin: "auto",
                    background: "var(--mz-bg-secondary)",
                    "border-radius": "var(--mz-radius-lg)",
                    "box-shadow": "0 20px 60px rgba(0,0,0,0.4)",
                    overflow: "hidden",
                    border: "1px solid var(--mz-border)",
                }}>
                {/* ===== LEFT: Category List ===== */}
                <nav
                    style={{
                        width: "200px",
                        "min-width": "200px",
                        background: "var(--mz-bg-tertiary)",
                        "border-right": "1px solid var(--mz-border)",
                        display: "flex",
                        "flex-direction": "column",
                        padding: "16px 0",
                    }}>
                    <div
                        style={{
                            padding: "0 16px 12px",
                            "font-size": "var(--mz-font-size-lg)",
                            "font-weight": "700",
                            color: "var(--mz-text-primary)",
                        }}>
                        {t("settings.title")}
                    </div>

                    <For each={CATEGORIES}>
                        {(cat) => (
                            <button
                                onClick={() => setActiveTab(cat.id)}
                                style={{
                                    display: "flex",
                                    "align-items": "center",
                                    gap: "10px",
                                    width: "100%",
                                    padding: "8px 16px",
                                    border: "none",
                                    background:
                                        activeTab() === cat.id
                                            ? "var(--mz-bg-active)"
                                            : "transparent",
                                    color:
                                        activeTab() === cat.id
                                            ? "var(--mz-accent)"
                                            : "var(--mz-text-secondary)",
                                    cursor: "pointer",
                                    "font-size": "var(--mz-font-size-sm)",
                                    "font-family": "var(--mz-font-sans)",
                                    "font-weight":
                                        activeTab() === cat.id ? "600" : "400",
                                    "text-align": "left",
                                    transition: "all 100ms",
                                    "border-left":
                                        activeTab() === cat.id
                                            ? "3px solid var(--mz-accent)"
                                            : "3px solid transparent",
                                }}
                                onMouseEnter={(e) => {
                                    if (activeTab() !== cat.id)
                                        e.currentTarget.style.background =
                                            "var(--mz-bg-hover)";
                                }}
                                onMouseLeave={(e) => {
                                    if (activeTab() !== cat.id)
                                        e.currentTarget.style.background =
                                            "transparent";
                                }}>
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round">
                                    <path d={cat.icon} />
                                </svg>
                                {t(cat.key)}
                            </button>
                        )}
                    </For>

                    {/* Active plugin settings entry (shown when viewing plugin settings) */}
                    <Show
                        when={
                            activeTab() === "plugin-settings" &&
                            activePluginName()
                        }>
                        <div
                            style={{
                                padding: "8px 0 0",
                                "margin-top": "4px",
                                "border-top": "1px solid var(--mz-border)",
                            }}>
                            <button
                                style={{
                                    display: "flex",
                                    "align-items": "center",
                                    gap: "10px",
                                    width: "100%",
                                    padding: "8px 16px",
                                    border: "none",
                                    background: "var(--mz-bg-active)",
                                    color: "var(--mz-accent)",
                                    cursor: "pointer",
                                    "font-size": "var(--mz-font-size-sm)",
                                    "font-family": "var(--mz-font-sans)",
                                    "font-weight": "600",
                                    "text-align": "left",
                                    "border-left": "3px solid var(--mz-accent)",
                                }}>
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round">
                                    <circle
                                        cx="12"
                                        cy="12"
                                        r="3"
                                    />
                                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                                </svg>
                                {activePluginName()}
                            </button>
                        </div>
                    </Show>

                    {/* Spacer */}
                    <div style={{ flex: "1" }} />

                    {/* Close button */}
                    <button
                        onClick={props.onClose}
                        style={{
                            margin: "8px 16px",
                            padding: "6px",
                            border: "1px solid var(--mz-border)",
                            background: "transparent",
                            color: "var(--mz-text-secondary)",
                            "border-radius": "var(--mz-radius-sm)",
                            cursor: "pointer",
                            "font-size": "var(--mz-font-size-sm)",
                            "font-family": "var(--mz-font-sans)",
                        }}>
                        {t("settings.close")}
                    </button>
                </nav>

                {/* ===== RIGHT: Content Area ===== */}
                <div
                    style={{
                        flex: "1",
                        overflow: "auto",
                        padding: "24px 32px",
                    }}>
                    {/* Editor Settings */}
                    <Show when={activeTab() === "editor"}>
                        <h2 style={titleStyle}>{t("settings.editor")}</h2>

                        <SettingSection title={t("settings.font")}>
                            <SettingInput
                                label={t("settings.fontSize")}
                                description={t("settings.fontSizeDescription")}
                                value={s().font_size}
                                type="number"
                                min={8}
                                max={72}
                                commitOnBlur
                                onChange={(v) => {
                                    const trimmed = v.trim();
                                    if (!trimmed) return;
                                    const parsed = Number.parseInt(trimmed, 10);
                                    if (!Number.isFinite(parsed)) return;
                                    set(
                                        "font_size",
                                        Math.max(8, Math.min(72, parsed)),
                                    );
                                }}
                            />
                            <SettingSelect
                                label={t("settings.fontFamily")}
                                description={t(
                                    "settings.fontFamilyDescription",
                                )}
                                value={s().font_family || DEFAULT_FONT_FAMILY}
                                options={fontFamilyOptions()}
                                width="320px"
                                onChange={(v) => set("font_family", v)}
                            />
                            <SettingInput
                                label={t("settings.fontFamilyCustom")}
                                description={t(
                                    "settings.fontFamilyCustomDescription",
                                )}
                                value={s().font_family}
                                placeholder={DEFAULT_FONT_FAMILY}
                                width="320px"
                                onChange={(v) => set("font_family", v)}
                            />
                        </SettingSection>

                        <SettingSection title={t("settings.editing")}>
                            <SettingToggle
                                label={t("settings.showLineNumbers")}
                                description={t(
                                    "settings.showLineNumbersDescription",
                                )}
                                value={s().editor_line_numbers}
                                onChange={(v) => set("editor_line_numbers", v)}
                            />
                            <SettingToggle
                                label={t("settings.codeBlockLineNumbers")}
                                description={t(
                                    "settings.codeBlockLineNumbersDescription",
                                )}
                                value={s().markdown_code_block_line_numbers}
                                onChange={(v) =>
                                    set("markdown_code_block_line_numbers", v)
                                }
                            />
                            <SettingToggle
                                label={t("settings.wordWrap")}
                                description={t("settings.wordWrapDescription")}
                                value={s().editor_word_wrap}
                                onChange={(v) => set("editor_word_wrap", v)}
                            />
                            <SettingToggle
                                label={t("settings.readableLineLength")}
                                description={t(
                                    "settings.readableLineLengthDescription",
                                )}
                                value={s().editor_readable_line_length}
                                onChange={(v) =>
                                    set("editor_readable_line_length", v)
                                }
                            />
                            <SettingToggle
                                label={t("settings.spellCheck")}
                                description={t(
                                    "settings.spellCheckDescription",
                                )}
                                value={s().editor_spell_check}
                                onChange={(v) => set("editor_spell_check", v)}
                            />
                        </SettingSection>

                        <SettingSection title={t("settings.saveSection")}>
                            <SettingInput
                                label={t("settings.autoSaveInterval")}
                                description={t(
                                    "settings.autoSaveIntervalDescription",
                                )}
                                value={s().auto_save_interval_ms}
                                type="text"
                                inputMode="numeric"
                                min={500}
                                max={30000}
                                commitOnBlur
                                onChange={(v) => {
                                    const trimmed = v.trim();
                                    if (!trimmed) return;
                                    const parsed = Number.parseInt(trimmed, 10);
                                    if (!Number.isFinite(parsed)) return;
                                    set(
                                        "auto_save_interval_ms",
                                        Math.max(500, Math.min(30000, parsed)),
                                    );
                                }}
                            />
                            <SettingSelect
                                label={t("settings.defaultViewMode")}
                                description={t(
                                    "settings.defaultViewModeDescription",
                                )}
                                value={s().default_view_mode}
                                options={[
                                    {
                                        value: "source",
                                        label: t("settings.viewMode.source"),
                                    },
                                    {
                                        value: "live-preview",
                                        label: t(
                                            "settings.viewMode.livePreview",
                                        ),
                                    },
                                    {
                                        value: "reading",
                                        label: t("settings.viewMode.reading"),
                                    },
                                ]}
                                onChange={(v) => set("default_view_mode", v as ViewMode)}
                            />
                        </SettingSection>

                        {renderCustomEditorSettings()}
                    </Show>

                    {/* Appearance Settings */}
                    <Show when={activeTab() === "appearance"}>
                        <h2 style={titleStyle}>{t("settings.appearance")}</h2>

                        <SettingSection title={t("common.interfaceLanguage")}>
                            <div
                                style={{
                                    display: "flex",
                                    "justify-content": "flex-end",
                                    padding: "8px 0",
                                }}>
                                <select
                                    title={t("common.interfaceLanguage")}
                                    aria-label={t("common.interfaceLanguage")}
                                    value={s().locale}
                                    onChange={(event) =>
                                        set(
                                            "locale",
                                            event.currentTarget
                                                .value as AppSettings["locale"],
                                        )
                                    }
                                    style={titleSelectStyle}>
                                    <For each={getLanguageOptions()}>
                                        {(option) => (
                                            <option value={option.value}>
                                                {option.label}
                                            </option>
                                        )}
                                    </For>
                                </select>
                            </div>
                        </SettingSection>

                        <SettingSection title={t("settings.themeSection")}>
                            <SkinPickerPanel />
                        </SettingSection>

                        {/* CSS Snippets —  user stylesheet manager */}
                        <CssSnippetsPanel />
                    </Show>

                    {/* Image Settings */}
                    <Show when={activeTab() === "images"}>
                        <h2 style={titleStyle}>{t("settings.images")}</h2>

                        <SettingSection title={t("settings.contextMenu")}>
                            <SettingInput
                                label={t("settings.imageResizeOptions")}
                                description={t(
                                    "settings.imageResizeOptionsDescription",
                                )}
                                value={s().image_resize_options}
                                placeholder="25%, 33%, 50%, 100%"
                                onChange={(v) => set("image_resize_options", v)}
                            />
                        </SettingSection>

                        <SettingSection title={t("settings.ctrlClickBehavior")}>
                            <SettingSelect
                                label={t("settings.imageCtrlClick")}
                                description={t(
                                    "settings.imageCtrlClickDescription",
                                )}
                                value={s().image_ctrl_click}
                                options={[
                                    {
                                        value: "open-in-new-tab",
                                        label: t(
                                            "settings.imageCtrlClick.openInNewTab",
                                        ),
                                    },
                                    {
                                        value: "open-in-default-app",
                                        label: t(
                                            "settings.imageCtrlClick.openInDefaultApp",
                                        ),
                                    },
                                    {
                                        value: "show-in-explorer",
                                        label: t("context.showInExplorer"),
                                    },
                                ]}
                                onChange={(v) =>
                                    set("image_ctrl_click", v as any)
                                }
                            />
                        </SettingSection>

                        <SettingSection title={t("settings.wheelZoom")}>
                            <SettingToggle
                                label={t("settings.enableWheelZoom")}
                                description={t(
                                    "settings.enableWheelZoomDescription",
                                )}
                                value={s().image_wheel_zoom}
                                onChange={(v) => set("image_wheel_zoom", v)}
                            />
                            <Show when={s().image_wheel_zoom}>
                                <SettingSelect
                                    label={t("settings.wheelModifier")}
                                    description={t(
                                        "settings.wheelModifierDescription",
                                    )}
                                    value={s().image_wheel_modifier}
                                    options={[
                                        { value: "Alt", label: "Alt" },
                                        { value: "Ctrl", label: "Ctrl" },
                                        { value: "Shift", label: "Shift" },
                                    ]}
                                    onChange={(v) =>
                                        set("image_wheel_modifier", v as any)
                                    }
                                />
                                <SettingSlider
                                    label={t("settings.wheelZoomStep")}
                                    description={t(
                                        "settings.wheelZoomStepDescription",
                                    )}
                                    value={s().image_wheel_zoom_step}
                                    min={5}
                                    max={50}
                                    step={5}
                                    suffix="%"
                                    onReset={() =>
                                        set("image_wheel_zoom_step", 20)
                                    }
                                    onChange={(v) =>
                                        set("image_wheel_zoom_step", v)
                                    }
                                />
                                <SettingToggle
                                    label={t("settings.invertWheelDirection")}
                                    description={t(
                                        "settings.invertWheelDirectionDescription",
                                    )}
                                    value={s().image_wheel_invert}
                                    onChange={(v) =>
                                        set("image_wheel_invert", v)
                                    }
                                />
                            </Show>
                        </SettingSection>
                    </Show>

                    {/* AI Settings */}
                    <Show when={activeTab() === "ai"}>
                        <AiSettingsPanel />
                    </Show>

                    {/* Files & Links Settings */}
                    <Show when={activeTab() === "files"}>
                        <h2 style={titleStyle}>{t("settings.files")}</h2>

                        <SettingSection title={t("settings.filesSection")}>
                            <div
                                style={{
                                    display: "flex",
                                    "align-items": "center",
                                    "justify-content": "space-between",
                                    padding: "8px 0",
                                    gap: "16px",
                                    "min-height": "40px",
                                }}>
                                <div style={{ flex: "1" }}>
                                    <div
                                        style={{
                                            "font-size":
                                                "var(--mz-font-size-sm)",
                                            color: "var(--mz-text-primary)",
                                            "font-weight": "500",
                                        }}>
                                        {t("settings.attachmentFolder")}
                                    </div>
                                    <div
                                        style={{
                                            "font-size":
                                                "var(--mz-font-size-xs)",
                                            color: "var(--mz-text-muted)",
                                            "margin-top": "2px",
                                        }}>
                                        {t(
                                            "settings.attachmentFolderDescription",
                                        )}
                                    </div>
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        "align-items": "center",
                                        gap: "6px",
                                        "flex-shrink": "0",
                                    }}>
                                    <input
                                        type="text"
                                        value={s().attachment_folder}
                                        placeholder=".mindzj/images"
                                        onInput={(e) =>
                                            set(
                                                "attachment_folder",
                                                e.currentTarget.value ||
                                                    DEFAULT_ATTACHMENT_FOLDER,
                                            )
                                        }
                                        style={{
                                            width: "160px",
                                            padding: "4px 8px",
                                            border: "1px solid var(--mz-border)",
                                            "border-radius":
                                                "var(--mz-radius-sm)",
                                            background: "var(--mz-bg-primary)",
                                            color: "var(--mz-text-primary)",
                                            "font-size":
                                                "var(--mz-font-size-sm)",
                                            "font-family":
                                                "var(--mz-font-sans)",
                                        }}
                                    />
                                    <button
                                        onClick={async () => {
                                            try {
                                                const selected =
                                                    await dialogOpen({
                                                        directory: true,
                                                        title: t(
                                                            "settings.selectAttachmentFolder",
                                                        ),
                                                    });
                                                if (
                                                    selected &&
                                                    typeof selected === "string"
                                                ) {
                                                    // Convert absolute path to relative path within vault
                                                    const vaultPath = (
                                                        await invoke<any>(
                                                            "get_vault_info",
                                                        )
                                                    )?.path;
                                                    if (vaultPath) {
                                                        const normalizedVault =
                                                            String(vaultPath)
                                                                .replace(
                                                                    /\\/g,
                                                                    "/",
                                                                )
                                                                .replace(
                                                                    /\/$/,
                                                                    "",
                                                                );
                                                        const normalizedSelected =
                                                            selected.replace(
                                                                /\\/g,
                                                                "/",
                                                            );
                                                        if (
                                                            normalizedSelected.startsWith(
                                                                normalizedVault +
                                                                    "/",
                                                            )
                                                        ) {
                                                            set(
                                                                "attachment_folder",
                                                                normalizedSelected.slice(
                                                                    normalizedVault.length +
                                                                        1,
                                                                ),
                                                            );
                                                        } else {
                                                            // If outside vault, use the folder name as a relative path
                                                            const folderName =
                                                                normalizedSelected
                                                                    .split("/")
                                                                    .pop() ||
                                                                DEFAULT_ATTACHMENT_FOLDER;
                                                            set(
                                                                "attachment_folder",
                                                                folderName,
                                                            );
                                                        }
                                                    }
                                                }
                                            } catch (e) {
                                                console.error(
                                                    "Failed to open folder dialog:",
                                                    e,
                                                );
                                            }
                                        }}
                                        title={t("settings.selectLocalFolder")}
                                        style={{
                                            display: "flex",
                                            "align-items": "center",
                                            "justify-content": "center",
                                            width: "32px",
                                            height: "28px",
                                            border: "1px solid var(--mz-border)",
                                            "border-radius":
                                                "var(--mz-radius-sm)",
                                            background:
                                                "var(--mz-bg-secondary)",
                                            color: "var(--mz-text-secondary)",
                                            cursor: "pointer",
                                            "flex-shrink": "0",
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor =
                                                "var(--mz-accent)";
                                            e.currentTarget.style.color =
                                                "var(--mz-accent)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor =
                                                "var(--mz-border)";
                                            e.currentTarget.style.color =
                                                "var(--mz-text-secondary)";
                                        }}>
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round">
                                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <SettingSelect
                                label={t("settings.newNoteLocation")}
                                description={t(
                                    "settings.newNoteLocationDescription",
                                )}
                                value={s().default_new_note_location}
                                options={[
                                    {
                                        value: "VaultRoot",
                                        label: t(
                                            "settings.newNoteLocation.vaultRoot",
                                        ),
                                    },
                                    {
                                        value: "SameFolder",
                                        label: t(
                                            "settings.newNoteLocation.sameFolder",
                                        ),
                                    },
                                ]}
                                onChange={(v) =>
                                    set("default_new_note_location", v)
                                }
                            />
                            <SettingInput
                                label={t("settings.templateFolder")}
                                description={t(
                                    "settings.templateFolderDescription",
                                )}
                                value={s().template_folder || ""}
                                placeholder="templates"
                                onChange={(v) =>
                                    set("template_folder", v || null)
                                }
                            />
                        </SettingSection>

                        <SettingSection title={t("settings.linksSection")}>
                            <SettingToggle
                                label={t("settings.autoUpdateLinks")}
                                description={t(
                                    "settings.autoUpdateLinksDescription",
                                )}
                                value={s().auto_update_links}
                                onChange={(v) => set("auto_update_links", v)}
                            />
                        </SettingSection>
                    </Show>

                    {/* Hotkeys Settings */}
                    <Show when={activeTab() === "hotkeys"}>
                        <h2 style={titleStyle}>{t("settings.hotkeys")}</h2>
                        <HotkeysPanel />
                    </Show>

                    {/* Plugins */}
                    <Show when={activeTab() === "plugins"}>
                        <h2 style={titleStyle}>{t("settings.plugins")}</h2>
                        <PluginsPanel
                            onOpenPluginSettings={(
                                id: string,
                                name: string,
                            ) => {
                                setActivePluginId(id);
                                setActivePluginName(name);
                                setActiveTab("plugin-settings");
                            }}
                        />
                    </Show>

                    {/* Plugin Settings */}
                    <Show
                        when={
                            activeTab() === "plugin-settings" &&
                            activePluginId()
                        }>
                        <div
                            style={{
                                display: "flex",
                                "align-items": "center",
                                gap: "12px",
                                "margin-bottom": "16px",
                            }}>
                            <button
                                onClick={() => {
                                    setActiveTab("plugins");
                                    setActivePluginId(null);
                                }}
                                style={{
                                    display: "flex",
                                    "align-items": "center",
                                    gap: "4px",
                                    border: "none",
                                    background: "transparent",
                                    color: "var(--mz-text-muted)",
                                    cursor: "pointer",
                                    "font-size": "var(--mz-font-size-sm)",
                                    "font-family": "var(--mz-font-sans)",
                                    padding: "4px 8px",
                                    "border-radius": "var(--mz-radius-sm)",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background =
                                        "var(--mz-bg-hover)";
                                    e.currentTarget.style.color =
                                        "var(--mz-text-primary)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background =
                                        "transparent";
                                    e.currentTarget.style.color =
                                        "var(--mz-text-muted)";
                                }}>
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round">
                                    <path d="M19 12H5M12 19l-7-7 7-7" />
                                </svg>
                                {t("settings.backToPluginList")}
                            </button>
                        </div>
                        <h2 style={titleStyle}>
                            {t("settings.pluginSettingsTitle", {
                                name: activePluginName(),
                            })}
                        </h2>
                        <PluginSettingsPanel pluginId={activePluginId()!} />
                    </Show>

                    {/* About */}
                    <Show when={activeTab() === "about"}>
                        <AboutPanel />
                    </Show>
                </div>
            </div>
        </div>
    );
};