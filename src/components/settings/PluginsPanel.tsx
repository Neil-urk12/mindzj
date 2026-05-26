/**
 * Plugins Panel — extracted from SettingsModal.tsx
 */

import {
    Component,
    Show,
    For,
    createSignal,
    onMount,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { pluginStore } from "../../stores/plugins";
import { SettingSection } from "./controls";
import { t } from "../../i18n";

export interface PluginManifestFE {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    author_url: string;
    min_app_version: string;
    is_desktop_only: boolean;
}

export interface PluginInfoFE {
    manifest: PluginManifestFE;
    enabled: boolean;
    has_styles: boolean;
    dir_path: string;
    is_core?: boolean;
}

export const PluginsPanel: Component<{
    onOpenPluginSettings?: (id: string, name: string) => void;
}> = (props) => {
    const [plugins, setPlugins] = createSignal<PluginInfoFE[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [searchQuery, setSearchQuery] = createSignal("");

    onMount(async () => {
        await loadPlugins();
    });

    async function loadPlugins() {
        setLoading(true);
        try {
            const result = await invoke<PluginInfoFE[]>("list_plugins");
            setPlugins(result);
        } catch (e) {
            console.error("Failed to load plugins:", e);
        } finally {
            setLoading(false);
        }
    }

    async function togglePlugin(pluginId: string, enabled: boolean) {
        try {
            await invoke("toggle_plugin", { pluginId, enabled });
            setPlugins((prev) =>
                prev.map((p) =>
                    p.manifest.id === pluginId ? { ...p, enabled } : p,
                ),
            );
            // Load or unload the plugin immediately
            if (enabled) {
                await pluginStore.reloadPlugin(pluginId);
            } else {
                await pluginStore.unloadPlugin(pluginId);
            }
        } catch (e) {
            console.error("Failed to toggle plugin:", e);
        }
    }

    async function deletePlugin(pluginId: string, pluginName: string) {
        if (!confirm(t("settings.deletePluginConfirm", { name: pluginName })))
            return;
        try {
            await invoke("delete_plugin", { pluginId });
            setPlugins((prev) =>
                prev.filter((p) => p.manifest.id !== pluginId),
            );
        } catch (e) {
            console.error("Failed to delete plugin:", e);
        }
    }

    const filteredPlugins = () => {
        const q = searchQuery().toLowerCase();
        if (!q) return plugins();
        return plugins().filter(
            (p) =>
                p.manifest.name.toLowerCase().includes(q) ||
                p.manifest.description.toLowerCase().includes(q) ||
                p.manifest.author.toLowerCase().includes(q) ||
                p.manifest.id.toLowerCase().includes(q),
        );
    };

    return (
        <>
            {/* Description */}
            <SettingSection title={t("settings.pluginManagement")}>
                <p
                    style={{
                        "font-size": "var(--mz-font-size-sm)",
                        color: "var(--mz-text-secondary)",
                        "line-height": "1.6",
                        "margin-bottom": "12px",
                    }}>
                    {t("settings.pluginsDescription.start")}{" "}
                    <code
                        style={{
                            background: "var(--mz-syntax-code-bg)",
                            padding: "1px 6px",
                            "border-radius": "var(--mz-radius-sm)",
                            "font-family": "var(--mz-font-mono)",
                            "font-size": "var(--mz-font-size-xs)",
                        }}>
                        .mindzj/plugins/
                    </code>{" "}
                    {t("settings.pluginsDescription.middle")}{" "}
                    <code
                        style={{
                            background: "var(--mz-syntax-code-bg)",
                            padding: "1px 6px",
                            "border-radius": "var(--mz-radius-sm)",
                            "font-family": "var(--mz-font-mono)",
                            "font-size": "var(--mz-font-size-xs)",
                        }}>
                        manifest.json
                    </code>{" "}
                    {t("settings.pluginsDescription.and")}{" "}
                    <code
                        style={{
                            background: "var(--mz-syntax-code-bg)",
                            padding: "1px 6px",
                            "border-radius": "var(--mz-radius-sm)",
                            "font-family": "var(--mz-font-mono)",
                            "font-size": "var(--mz-font-size-xs)",
                        }}>
                        main.js
                    </code>
                    {t("settings.pluginsDescription.end")}
                </p>
            </SettingSection>

            {/* Search & Install bar */}
            <div
                style={{
                    display: "flex",
                    gap: "8px",
                    "margin-bottom": "16px",
                }}>
                <div style={{ flex: "1", position: "relative" }}>
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--mz-text-muted)"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        style={{
                            position: "absolute",
                            left: "10px",
                            top: "50%",
                            transform: "translateY(-50%)",
                        }}>
                        <path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
                    </svg>
                    <input
                        type="text"
                        placeholder={t("settings.pluginSearchPlaceholder")}
                        value={searchQuery()}
                        onInput={(e) => setSearchQuery(e.currentTarget.value)}
                        style={{
                            width: "100%",
                            padding: "8px 12px 8px 32px",
                            border: "1px solid var(--mz-border)",
                            "border-radius": "var(--mz-radius-md)",
                            background: "var(--mz-bg-primary)",
                            color: "var(--mz-text-primary)",
                            "font-size": "var(--mz-font-size-sm)",
                            "font-family": "var(--mz-font-sans)",
                        }}
                    />
                </div>

                <button
                    onClick={() => loadPlugins()}
                    title={t("settings.refreshPlugins")}
                    style={{
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        width: "36px",
                        height: "36px",
                        border: "1px solid var(--mz-border)",
                        "border-radius": "var(--mz-radius-md)",
                        background: "transparent",
                        color: "var(--mz-text-secondary)",
                        cursor: "pointer",
                        "flex-shrink": "0",
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--mz-accent)";
                        e.currentTarget.style.color = "var(--mz-accent)";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--mz-border)";
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
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                    </svg>
                </button>
            </div>

            {/* Plugin list */}
            <Show
                when={!loading()}
                fallback={
                    <div
                        style={{
                            padding: "40px",
                            "text-align": "center",
                            color: "var(--mz-text-muted)",
                            "font-size": "var(--mz-font-size-sm)",
                        }}>
                        {t("settings.loadingPlugins")}
                    </div>
                }>
                <Show
                    when={filteredPlugins().length > 0}
                    fallback={
                        <div
                            style={{
                                padding: "40px 20px",
                                "text-align": "center",
                                color: "var(--mz-text-muted)",
                            }}>
                            <svg
                                width="48"
                                height="48"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                style={{
                                    opacity: "0.3",
                                    "margin-bottom": "12px",
                                }}>
                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                            </svg>
                            <div
                                style={{
                                    "font-size": "var(--mz-font-size-sm)",
                                    "margin-bottom": "8px",
                                }}>
                                {searchQuery()
                                    ? t("settings.noMatchingPlugins")
                                    : t("settings.noPluginsInstalled")}
                            </div>
                            <div
                                style={{
                                    "font-size": "var(--mz-font-size-xs)",
                                    opacity: "0.7",
                                }}>
                                {t("settings.installPluginHint")}
                            </div>
                        </div>
                    }>
                    <div
                        style={{
                            display: "flex",
                            "flex-direction": "column",
                            gap: "2px",
                        }}>
                        <For each={filteredPlugins()}>
                            {(plugin) => (
                                <div
                                    style={{
                                        display: "flex",
                                        "align-items": "center",
                                        gap: "12px",
                                        padding: "12px 14px",
                                        background: "var(--mz-bg-primary)",
                                        "border-radius": "var(--mz-radius-md)",
                                        border: "1px solid var(--mz-border)",
                                        transition: "border-color 150ms",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor =
                                            "var(--mz-border-strong)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor =
                                            "var(--mz-border)";
                                    }}>
                                    {/* Plugin icon */}
                                    <div
                                        style={{
                                            width: "40px",
                                            height: "40px",
                                            display: "flex",
                                            "align-items": "center",
                                            "justify-content": "center",
                                            background: plugin.enabled
                                                ? "var(--mz-accent-subtle)"
                                                : "var(--mz-bg-hover)",
                                            "border-radius":
                                                "var(--mz-radius-md)",
                                            "flex-shrink": "0",
                                            color: plugin.enabled
                                                ? "var(--mz-accent)"
                                                : "var(--mz-text-muted)",
                                        }}>
                                        <svg
                                            width="20"
                                            height="20"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="1.5"
                                            stroke-linecap="round"
                                            stroke-linejoin="round">
                                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                                        </svg>
                                    </div>

                                    {/* Plugin info */}
                                    <div
                                        style={{ flex: "1", "min-width": "0" }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                "align-items": "center",
                                                gap: "8px",
                                                "margin-bottom": "2px",
                                            }}>
                                            <span
                                                style={{
                                                    "font-size":
                                                        "var(--mz-font-size-sm)",
                                                    "font-weight": "600",
                                                    color: "var(--mz-text-primary)",
                                                    overflow: "hidden",
                                                    "text-overflow": "ellipsis",
                                                    "white-space": "nowrap",
                                                }}>
                                                {plugin.manifest.name}
                                            </span>
                                            <span
                                                style={{
                                                    "font-size": "10px",
                                                    color: "var(--mz-text-muted)",
                                                    background:
                                                        "var(--mz-bg-hover)",
                                                    padding: "1px 6px",
                                                    "border-radius":
                                                        "var(--mz-radius-sm)",
                                                    "flex-shrink": "0",
                                                }}>
                                                v{plugin.manifest.version}
                                            </span>
                                            <Show when={plugin.is_core}>
                                                <span
                                                    style={{
                                                        "font-size": "10px",
                                                        color: "var(--mz-accent)",
                                                        background:
                                                            "var(--mz-accent-subtle)",
                                                        padding: "1px 6px",
                                                        "border-radius":
                                                            "var(--mz-radius-sm)",
                                                        "flex-shrink": "0",
                                                        "font-weight": "600",
                                                    }}>
                                                    {t("settings.corePlugin")}
                                                </span>
                                            </Show>
                                            <Show when={plugin.has_styles}>
                                                <span
                                                    style={{
                                                        "font-size": "10px",
                                                        color: "var(--mz-info)",
                                                        background:
                                                            "rgba(97,175,239,0.1)",
                                                        padding: "1px 6px",
                                                        "border-radius":
                                                            "var(--mz-radius-sm)",
                                                        "flex-shrink": "0",
                                                    }}>
                                                    CSS
                                                </span>
                                            </Show>
                                        </div>
                                        <div
                                            style={{
                                                "font-size":
                                                    "var(--mz-font-size-xs)",
                                                color: "var(--mz-text-muted)",
                                                overflow: "hidden",
                                                "text-overflow": "ellipsis",
                                                "white-space": "nowrap",
                                            }}>
                                            {plugin.manifest.description ||
                                                plugin.manifest.id}
                                        </div>
                                        <div
                                            style={{
                                                "font-size": "10px",
                                                color: "var(--mz-text-muted)",
                                                "margin-top": "2px",
                                                opacity: "0.7",
                                            }}>
                                            {plugin.manifest.author
                                                ? t("settings.byAuthor", {
                                                      author: plugin.manifest
                                                          .author,
                                                  })
                                                : ""}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div
                                        style={{
                                            display: "flex",
                                            "align-items": "center",
                                            gap: "8px",
                                            "flex-shrink": "0",
                                        }}>
                                        {/* Settings button — shown for ALL enabled plugins */}
                                        <Show when={plugin.enabled}>
                                            <button
                                                onClick={() =>
                                                    props.onOpenPluginSettings?.(
                                                        plugin.manifest.id,
                                                        plugin.manifest.name,
                                                    )
                                                }
                                                title={t(
                                                    "settings.pluginSettings",
                                                )}
                                                style={{
                                                    width: "28px",
                                                    height: "28px",
                                                    display: "flex",
                                                    "align-items": "center",
                                                    "justify-content": "center",
                                                    border: "none",
                                                    "border-radius":
                                                        "var(--mz-radius-sm)",
                                                    background: "transparent",
                                                    color: "var(--mz-text-muted)",
                                                    cursor: "pointer",
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.background =
                                                        "var(--mz-bg-hover)";
                                                    e.currentTarget.style.color =
                                                        "var(--mz-accent)";
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
                                                    <circle
                                                        cx="12"
                                                        cy="12"
                                                        r="3"
                                                    />
                                                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                                                </svg>
                                            </button>
                                        </Show>

                                        {/* Delete button — hidden for core plugins */}
                                        <Show when={!plugin.is_core}>
                                            <button
                                                onClick={() =>
                                                    deletePlugin(
                                                        plugin.manifest.id,
                                                        plugin.manifest.name,
                                                    )
                                                }
                                                title={t(
                                                    "settings.deletePlugin",
                                                )}
                                                style={{
                                                    width: "28px",
                                                    height: "28px",
                                                    display: "flex",
                                                    "align-items": "center",
                                                    "justify-content": "center",
                                                    border: "none",
                                                    "border-radius":
                                                        "var(--mz-radius-sm)",
                                                    background: "transparent",
                                                    color: "var(--mz-text-muted)",
                                                    cursor: "pointer",
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.background =
                                                        "rgba(224,108,117,0.15)";
                                                    e.currentTarget.style.color =
                                                        "var(--mz-error)";
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
                                                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                </svg>
                                            </button>
                                        </Show>

                                        {/* Toggle switch — core plugins are always enabled */}
                                        <button
                                            role="switch"
                                            aria-checked={plugin.enabled}
                                            data-testid={`plugin-toggle-${plugin.manifest.id}`}
                                            onClick={() => {
                                                if (!plugin.is_core)
                                                    togglePlugin(
                                                        plugin.manifest.id,
                                                        !plugin.enabled,
                                                    );
                                            }}
                                            style={{
                                                width: "40px",
                                                height: "22px",
                                                "border-radius": "11px",
                                                border: "none",
                                                background: plugin.enabled
                                                    ? "var(--mz-accent)"
                                                    : "var(--mz-bg-hover)",
                                                cursor: plugin.is_core
                                                    ? "default"
                                                    : "pointer",
                                                position: "relative",
                                                transition:
                                                    "background 150ms ease",
                                                "flex-shrink": "0",
                                                opacity: plugin.is_core
                                                    ? "0.7"
                                                    : "1",
                                            }}
                                            title={
                                                plugin.is_core
                                                    ? t(
                                                          "settings.corePluginCannotDisable",
                                                      )
                                                    : ""
                                            }>
                                            <span
                                                style={{
                                                    position: "absolute",
                                                    top: "2px",
                                                    left: plugin.enabled
                                                        ? "20px"
                                                        : "2px",
                                                    width: "18px",
                                                    height: "18px",
                                                    "border-radius": "50%",
                                                    background: "white",
                                                    transition:
                                                        "left 150ms ease",
                                                    "box-shadow":
                                                        "0 1px 3px rgba(0,0,0,0.3)",
                                                }}
                                            />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </Show>
        </>
    );
};
