import {
    Component,
    Show,
    createSignal,
    createEffect,
    onMount,
    onCleanup,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../i18n";
import {
    pluginStore,
    getPluginSettingTab,
    pluginsVersion,
} from "../../stores/plugins";
import { SettingSection } from "./controls";
import { type PluginManifestFE, type PluginInfoFE } from "./PluginsPanel";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const titleStyle = {
    "font-size": "1.3em",
    "font-weight": "700",
    color: "var(--mz-text-primary)",
    "margin-bottom": "20px",
};


const titleSelectStyle = {
    width: "180px",
    padding: "4px 8px",
    border: "1px solid var(--mz-border)",
    "border-radius": "var(--mz-radius-sm)",
    background: "var(--mz-bg-primary)",
    color: "var(--mz-text-primary)",
    "font-size": "var(--mz-font-size-sm)",
    "font-family": "var(--mz-font-sans)",
    cursor: "pointer",
} as const;

const sectionTitleStyle = {
    "font-size": "var(--mz-font-size-sm)",
    "font-weight": "600",
    color: "var(--mz-text-muted)",
    "text-transform": "uppercase",
    "letter-spacing": "0.5px",
    "margin-bottom": "12px",
    "padding-bottom": "6px",
    "border-bottom": "1px solid var(--mz-border)",
} as const;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Plugin Settings Panel — renders a plugin's PluginSettingTab
// ---------------------------------------------------------------------------

export const PluginSettingsPanel: Component<{ pluginId: string }> = (props) => {
    let containerRef: HTMLDivElement | undefined;
    const [pluginInfo, setPluginInfo] = createSignal<PluginInfoFE | null>(null);
    // Track whether the custom settings tab has been rendered into the container
    const [settingsRendered, setSettingsRendered] = createSignal(false);

    // Reactive: re-evaluate when pluginsVersion changes (after plugin load/reload)
    const hasCustomTab = () => {
        pluginsVersion(); // read the signal so SolidJS tracks it
        return !!getPluginSettingTab(props.pluginId);
    };

    /**
     * Render the plugin's custom settings tab into containerRef.
     * Called from onMount and also re-called when plugins reload.
     */
    async function renderSettingsTab() {
        if (!containerRef) return;
        const settingTab = getPluginSettingTab(props.pluginId);
        if (!settingTab) return;

        // Plugin has a custom settings tab — render it.
        settingTab.containerEl.innerHTML = "";
        try {
            const result = settingTab.display();
            // Await if display() returns a promise (async display methods)
            if (result && typeof result.then === "function") {
                await result;
            }
        } catch (e) {
            console.error(
                `[PluginSettings] display() error for "${props.pluginId}":`,
                e,
            );
        }
        Object.assign(settingTab.containerEl.style, {
            width: "100%",
            "box-sizing": "border-box",
            display: "block",
        });
        // Avoid duplicate appends — clear first
        if (containerRef.contains(settingTab.containerEl)) {
            containerRef.removeChild(settingTab.containerEl);
        }
        containerRef.appendChild(settingTab.containerEl);
        setSettingsRendered(true);
    }

    onMount(async () => {
        (window as any).__mindzj_plugin_settings_active_tab = {
            id: props.pluginId,
            containerEl: containerRef,
        };

        // Fetch plugin info for the default page
        try {
            const plugins = await invoke<PluginInfoFE[]>("list_plugins");
            const found = plugins.find((p) => p.manifest.id === props.pluginId);
            if (found) setPluginInfo(found);
        } catch {}

        // Initial render of settings tab
        await renderSettingsTab();
    });

    // Re-render settings when pluginsVersion changes (e.g. after plugin reload)
    createEffect(() => {
        const _ver = pluginsVersion(); // track reactive dependency
        // Skip the initial run — onMount handles that
        if (_ver === 0) return;
        // Re-render if the tab is available and container exists
        if (containerRef && getPluginSettingTab(props.pluginId)) {
            renderSettingsTab();
        }
    });

    onCleanup(() => {
        if (
            (window as any).__mindzj_plugin_settings_active_tab?.id ===
            props.pluginId
        ) {
            (window as any).__mindzj_plugin_settings_active_tab = null;
        }
        const settingTab = getPluginSettingTab(props.pluginId);
        if (settingTab && typeof settingTab.hide === "function") {
            try {
                settingTab.hide();
            } catch {}
        }
    });

    const infoRowStyle = {
        display: "flex",
        "justify-content": "space-between",
        "align-items": "center",
        padding: "10px 0",
        "border-bottom": "1px solid var(--mz-border)",
        "font-size": "var(--mz-font-size-sm)",
    };

    return (
        <div
            style={{
                "font-size": "var(--mz-font-size-sm)",
                color: "var(--mz-text-primary)",
                width: "100%",
                "min-height": "0",
            }}>
            {/* Default plugin info page (shown for ALL plugins, above custom settings) */}
            <Show when={pluginInfo()}>
                {(info) => (
                    <div
                        style={{
                            "margin-bottom": hasCustomTab() ? "24px" : "0",
                        }}>
                        <SettingSection title={t("settings.pluginInfo")}>
                            <div style={infoRowStyle}>
                                <span style={{ color: "var(--mz-text-muted)" }}>
                                    {t("settings.pluginId")}
                                </span>
                                <span
                                    style={{
                                        "font-family": "var(--mz-font-mono)",
                                        "font-size": "var(--mz-font-size-xs)",
                                    }}>
                                    {info().manifest.id}
                                </span>
                            </div>
                            <div style={infoRowStyle}>
                                <span style={{ color: "var(--mz-text-muted)" }}>
                                    {t("common.version")}
                                </span>
                                <span>{info().manifest.version}</span>
                            </div>
                            <div style={infoRowStyle}>
                                <span style={{ color: "var(--mz-text-muted)" }}>
                                    {t("common.author")}
                                </span>
                                <span>
                                    {info().manifest.author ||
                                        t("common.unknown")}
                                </span>
                            </div>
                            <Show when={info().manifest.description}>
                                <div style={infoRowStyle}>
                                    <span
                                        style={{
                                            color: "var(--mz-text-muted)",
                                        }}>
                                        {t("common.description")}
                                    </span>
                                    <span
                                        style={{
                                            "text-align": "right",
                                            "max-width": "60%",
                                            "word-break": "break-word",
                                        }}>
                                        {info().manifest.description}
                                    </span>
                                </div>
                            </Show>
                            <div style={infoRowStyle}>
                                <span style={{ color: "var(--mz-text-muted)" }}>
                                    {t("settings.dataDirectory")}
                                </span>
                                <span
                                    style={{
                                        "font-family": "var(--mz-font-mono)",
                                        "font-size": "var(--mz-font-size-xs)",
                                    }}>
                                    .mindzj/plugins/
                                    {info()
                                        .dir_path.replace(/[\\/]+$/, "")
                                        .split(/[\\/]/)
                                        .pop()}
                                    /
                                </span>
                            </div>
                        </SettingSection>

                        <SettingSection title={t("settings.actions")}>
                            <div
                                style={{
                                    display: "flex",
                                    gap: "8px",
                                    padding: "8px 0",
                                }}>
                                <button
                                    onClick={async () => {
                                        try {
                                            await pluginStore.reloadPlugin(
                                                props.pluginId,
                                            );
                                            // Re-fetch info after reload
                                            const plugins =
                                                await invoke<PluginInfoFE[]>(
                                                    "list_plugins",
                                                );
                                            const found = plugins.find(
                                                (p) =>
                                                    p.manifest.id ===
                                                    props.pluginId,
                                            );
                                            if (found) setPluginInfo(found);
                                        } catch (e) {
                                            console.error("Reload failed:", e);
                                        }
                                    }}
                                    style={{
                                        padding: "6px 16px",
                                        border: "1px solid var(--mz-border)",
                                        "border-radius": "var(--mz-radius-sm)",
                                        background: "var(--mz-bg-primary)",
                                        color: "var(--mz-text-primary)",
                                        cursor: "pointer",
                                        "font-size": "var(--mz-font-size-sm)",
                                        "font-family": "var(--mz-font-sans)",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor =
                                            "var(--mz-accent)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor =
                                            "var(--mz-border)";
                                    }}>
                                    {t("settings.reloadPlugin")}
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            await invoke(
                                                "open_path_in_file_manager",
                                                {
                                                    absolutePath:
                                                        info().dir_path,
                                                },
                                            );
                                        } catch (e) {
                                            console.error(
                                                "Open folder failed:",
                                                e,
                                            );
                                        }
                                    }}
                                    style={{
                                        padding: "6px 16px",
                                        border: "1px solid var(--mz-border)",
                                        "border-radius": "var(--mz-radius-sm)",
                                        background: "var(--mz-bg-primary)",
                                        color: "var(--mz-text-primary)",
                                        cursor: "pointer",
                                        "font-size": "var(--mz-font-size-sm)",
                                        "font-family": "var(--mz-font-sans)",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor =
                                            "var(--mz-accent)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor =
                                            "var(--mz-border)";
                                    }}>
                                    {t("settings.openPluginFolder")}
                                </button>
                            </div>
                        </SettingSection>
                    </div>
                )}
            </Show>

            {/* Plugin settings container — always present so containerRef is set before onMount.
          The SettingSection heading is shown only when a custom tab exists. */}
            <Show when={hasCustomTab() || settingsRendered()}>
                <SettingSection title={t("settings.pluginSettings")}>
                    <div ref={containerRef} />
                </SettingSection>
            </Show>
            <Show when={!hasCustomTab() && !settingsRendered()}>
                <div
                    ref={(el) => {
                        containerRef = el;
                    }}
                />
            </Show>
        </div>
    );
};

export { titleStyle, titleSelectStyle, sectionTitleStyle };
