/**
 * HotkeysPanel — keyboard shortcut configuration for SettingsModal.
 */

import {
    Component,
    Show,
    For,
    createSignal,
    createEffect,
    onMount,
    onCleanup,
} from "solid-js";
import { t } from "../../i18n";
import { settingsStore } from "../../stores/settings";

interface HotkeyDef {
    command: string;
    labelKey: string;
    defaultKeys: string;
}

const DEFAULT_HOTKEYS: HotkeyDef[] = [
    { command: "save", labelKey: "hotkeys.saveFile", defaultKeys: "Ctrl+S" },
    { command: "new-note", labelKey: "hotkeys.newNote", defaultKeys: "Ctrl+N" },
    {
        command: "command-palette",
        labelKey: "hotkeys.commandPalette",
        defaultKeys: "Ctrl+P",
    },
    {
        command: "command-palette-alt",
        labelKey: "hotkeys.commandPaletteAlt",
        defaultKeys: "Ctrl+O",
    },
    {
        command: "ai-control",
        labelKey: "hotkeys.aiPanel",
        defaultKeys: "Alt+`",
    },
    {
        command: "close-tab",
        labelKey: "hotkeys.closeTab",
        defaultKeys: "Ctrl+W",
    },
    {
        command: "reopen-tab",
        labelKey: "hotkeys.reopenTab",
        defaultKeys: "Ctrl+Shift+T",
    },
    {
        command: "tab-prev",
        labelKey: "hotkeys.tabPrev",
        defaultKeys: "Ctrl+Shift+Left",
    },
    {
        command: "tab-next",
        labelKey: "hotkeys.tabNext",
        defaultKeys: "Ctrl+Shift+Right",
    },
    {
        command: "toggle-window-visible",
        labelKey: "hotkeys.toggleWindowVisible",
        defaultKeys: "Ctrl+J",
    },
    {
        command: "toggle-sidebar",
        labelKey: "hotkeys.toggleSidebar",
        defaultKeys: "Ctrl+`",
    },
    {
        command: "toggle-view-mode",
        labelKey: "hotkeys.toggleViewMode",
        defaultKeys: "Ctrl+E",
    },
    {
        command: "task-list",
        labelKey: "hotkeys.taskList",
        defaultKeys: "Ctrl+L",
    },
    {
        command: "code-block",
        labelKey: "hotkeys.codeBlock",
        defaultKeys: "Ctrl+Shift+C",
    },
    {
        command: "settings",
        labelKey: "hotkeys.openSettings",
        defaultKeys: "Ctrl+,",
    },
    { command: "zoom-in", labelKey: "hotkeys.zoomIn", defaultKeys: "Ctrl+=" },
    { command: "zoom-out", labelKey: "hotkeys.zoomOut", defaultKeys: "Ctrl+-" },
    {
        command: "zoom-reset",
        labelKey: "hotkeys.resetZoom",
        defaultKeys: "Ctrl+0",
    },
    { command: "bold", labelKey: "toolbar.bold", defaultKeys: "Ctrl+B" },
    { command: "italic", labelKey: "toolbar.italic", defaultKeys: "Ctrl+I" },
    {
        command: "strikethrough",
        labelKey: "toolbar.strikethrough",
        defaultKeys: "Ctrl+Shift+S",
    },
    {
        command: "underline",
        labelKey: "toolbar.underline",
        defaultKeys: "Ctrl+U",
    },
    {
        command: "highlight",
        labelKey: "toolbar.highlight",
        defaultKeys: "Ctrl+Shift+H",
    },
    { command: "link", labelKey: "hotkeys.insertLink", defaultKeys: "Ctrl+K" },
    {
        command: "code",
        labelKey: "hotkeys.inlineCode",
        defaultKeys: "Ctrl+Shift+E",
    },
    {
        command: "heading-1",
        labelKey: "hotkeys.heading1",
        defaultKeys: "Ctrl+1",
    },
    {
        command: "heading-2",
        labelKey: "hotkeys.heading2",
        defaultKeys: "Ctrl+2",
    },
    {
        command: "heading-3",
        labelKey: "hotkeys.heading3",
        defaultKeys: "Ctrl+3",
    },
    {
        command: "heading-4",
        labelKey: "hotkeys.heading4",
        defaultKeys: "Ctrl+4",
    },
    {
        command: "heading-5",
        labelKey: "hotkeys.heading5",
        defaultKeys: "Ctrl+5",
    },
    {
        command: "heading-6",
        labelKey: "hotkeys.heading6",
        defaultKeys: "Ctrl+6",
    },
    {
        command: "normal-text",
        labelKey: "hotkeys.normalText",
        defaultKeys: "Ctrl+0",
    },
    {
        command: "search",
        labelKey: "hotkeys.searchFileContent",
        defaultKeys: "Ctrl+Shift+F",
    },
    {
        command: "find-in-file",
        labelKey: "hotkeys.findInFile",
        defaultKeys: "Ctrl+F",
    },
    {
        command: "delete-line",
        labelKey: "hotkeys.deleteLine",
        defaultKeys: "Ctrl+D",
    },
    {
        command: "duplicate-line",
        labelKey: "hotkeys.duplicateLine",
        defaultKeys: "Ctrl+Shift+D",
    },
    {
        command: "move-line-up",
        labelKey: "hotkeys.moveLineUp",
        defaultKeys: "Alt+Up",
    },
    {
        command: "move-line-down",
        labelKey: "hotkeys.moveLineDown",
        defaultKeys: "Alt+Down",
    },
    {
        command: "indent",
        labelKey: "hotkeys.indentMore",
        defaultKeys: "Ctrl+]",
    },
    {
        command: "outdent",
        labelKey: "hotkeys.indentLess",
        defaultKeys: "Ctrl+[",
    },
    {
        command: "toggle-comment",
        labelKey: "hotkeys.toggleComment",
        defaultKeys: "Ctrl+/",
    },
    {
        command: "toggle-blockquote",
        labelKey: "hotkeys.toggleBlockquote",
        defaultKeys: "Ctrl+Shift+.",
    },
    { command: "undo", labelKey: "toolbar.undo", defaultKeys: "Ctrl+Z" },
    { command: "redo", labelKey: "toolbar.redo", defaultKeys: "Ctrl+Shift+Z" },
    {
        command: "screenshot",
        labelKey: "hotkeys.screenshot",
        defaultKeys: "Alt+G",
    },
    {
        command: "plugin:timestamp-header:insert-timestamp",
        labelKey: "hotkeys.insertTimestamp",
        defaultKeys: "Alt+F",
    },
    {
        command: "plugin:timestamp-header:insert-separator",
        labelKey: "hotkeys.insertSeparator",
        defaultKeys: "Alt+A",
    },
];

export const HotkeysPanel: Component = () => {
    const [searchQuery, setSearchQuery] = createSignal("");
    const [capturing, setCapturing] = createSignal<string | null>(null);

    // Get the display keys for a hotkey (custom override or default)
    const getDisplayKeys = (hotkey: HotkeyDef) => {
        const overrides = settingsStore.settings().hotkey_overrides || {};
        return overrides[hotkey.command] || hotkey.defaultKeys;
    };

    const filtered = () => {
        const q = searchQuery().toLowerCase();
        if (!q) return DEFAULT_HOTKEYS;
        return DEFAULT_HOTKEYS.filter(
            (h) =>
                t(h.labelKey).toLowerCase().includes(q) ||
                h.command.toLowerCase().includes(q) ||
                getDisplayKeys(h).toLowerCase().includes(q),
        );
    };

    // Sync global flag so App.tsx's handleGlobalKeydown skips shortcuts while capturing
    createEffect(() => {
        (window as any).__mindzj_hotkey_capturing = !!capturing();
    });

    function handleKeyCapture(e: KeyboardEvent) {
        if (!capturing()) return;
        e.preventDefault();
        e.stopPropagation();

        if (e.key === "Escape") {
            setCapturing(null);
            return;
        }

        // Build key string — support combo shortcuts like Ctrl+L, Ctrl+Shift+L
        const parts: string[] = [];
        if (e.ctrlKey) parts.push("Ctrl");
        if (e.shiftKey) parts.push("Shift");
        if (e.altKey) parts.push("Alt");
        if (e.metaKey) parts.push("Meta");

        // Don't record modifier-only presses
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

        // Normalize the key name
        let keyName = e.key;
        if (keyName.length === 1) {
            keyName = keyName.toUpperCase();
        } else if (keyName === "ArrowUp") {
            keyName = "Up";
        } else if (keyName === "ArrowDown") {
            keyName = "Down";
        } else if (keyName === "ArrowLeft") {
            keyName = "Left";
        } else if (keyName === "ArrowRight") {
            keyName = "Right";
        } else if (keyName === " ") {
            keyName = "Space";
        }

        parts.push(keyName);
        const combo = parts.join("+");

        const cmd = capturing()!;
        // Save the custom hotkey override to settings
        const currentOverrides = {
            ...(settingsStore.settings().hotkey_overrides || {}),
        };
        currentOverrides[cmd] = combo;
        settingsStore.updateSetting("hotkey_overrides", currentOverrides);

        setCapturing(null);
    }

    onMount(() => document.addEventListener("keydown", handleKeyCapture, true));
    onCleanup(() =>
        document.removeEventListener("keydown", handleKeyCapture, true),
    );

    // Reset a hotkey override back to its default
    function resetHotkey(command: string) {
        const currentOverrides = {
            ...(settingsStore.settings().hotkey_overrides || {}),
        };
        delete currentOverrides[command];
        settingsStore.updateSetting("hotkey_overrides", currentOverrides);
    }

    return (
        <>
            <input
                type="text"
                placeholder={t("settings.hotkeysSearchPlaceholder")}
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid var(--mz-border)",
                    "border-radius": "var(--mz-radius-md)",
                    background: "var(--mz-bg-primary)",
                    color: "var(--mz-text-primary)",
                    "font-size": "var(--mz-font-size-sm)",
                    "font-family": "var(--mz-font-sans)",
                    "margin-bottom": "16px",
                }}
            />

            <div
                style={{
                    display: "flex",
                    "flex-direction": "column",
                    gap: "2px",
                }}>
                <For each={filtered()}>
                    {(hotkey) => {
                        const overrides = () =>
                            settingsStore.settings().hotkey_overrides || {};
                        const isCustom = () => !!overrides()[hotkey.command];
                        const displayKeys = () =>
                            overrides()[hotkey.command] || hotkey.defaultKeys;

                        return (
                            <div
                                style={{
                                    display: "flex",
                                    "align-items": "center",
                                    "justify-content": "space-between",
                                    padding: "8px 12px",
                                    "border-radius": "var(--mz-radius-sm)",
                                    background:
                                        capturing() === hotkey.command
                                            ? "var(--mz-accent-subtle)"
                                            : "transparent",
                                }}
                                onMouseEnter={(e) => {
                                    if (capturing() !== hotkey.command)
                                        e.currentTarget.style.background =
                                            "var(--mz-bg-hover)";
                                }}
                                onMouseLeave={(e) => {
                                    if (capturing() !== hotkey.command)
                                        e.currentTarget.style.background =
                                            "transparent";
                                }}>
                                <span
                                    style={{
                                        "font-size": "var(--mz-font-size-sm)",
                                        color: "var(--mz-text-primary)",
                                    }}>
                                    {t(hotkey.labelKey)}
                                </span>
                                <div
                                    style={{
                                        display: "flex",
                                        "align-items": "center",
                                        gap: "6px",
                                    }}>
                                    {/* Reset button (only shown for custom overrides) */}
                                    <Show when={isCustom()}>
                                        <button
                                            onClick={() =>
                                                resetHotkey(hotkey.command)
                                            }
                                            title={t(
                                                "settings.resetToDefault",
                                                { keys: hotkey.defaultKeys },
                                            )}
                                            style={{
                                                display: "flex",
                                                "align-items": "center",
                                                "justify-content": "center",
                                                width: "22px",
                                                height: "22px",
                                                border: "none",
                                                background: "transparent",
                                                color: "var(--mz-text-muted)",
                                                cursor: "pointer",
                                                "border-radius":
                                                    "var(--mz-radius-sm)",
                                                "font-size": "12px",
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.color =
                                                    "var(--mz-text-primary)";
                                                e.currentTarget.style.background =
                                                    "var(--mz-bg-active)";
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.color =
                                                    "var(--mz-text-muted)";
                                                e.currentTarget.style.background =
                                                    "transparent";
                                            }}>
                                            <svg
                                                width="12"
                                                height="12"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round">
                                                <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
                                                <path d="M3 3v5h5" />
                                            </svg>
                                        </button>
                                    </Show>
                                    {/* Hotkey button */}
                                    <button
                                        onClick={() =>
                                            setCapturing(
                                                capturing() === hotkey.command
                                                    ? null
                                                    : hotkey.command,
                                            )
                                        }
                                        style={{
                                            padding: "3px 10px",
                                            border:
                                                capturing() === hotkey.command
                                                    ? "1px solid var(--mz-accent)"
                                                    : isCustom()
                                                      ? "1px solid var(--mz-accent)"
                                                      : "1px solid var(--mz-border)",
                                            "border-radius":
                                                "var(--mz-radius-sm)",
                                            background:
                                                capturing() === hotkey.command
                                                    ? "var(--mz-accent-subtle)"
                                                    : "var(--mz-bg-tertiary)",
                                            color:
                                                capturing() === hotkey.command
                                                    ? "var(--mz-accent)"
                                                    : isCustom()
                                                      ? "var(--mz-accent)"
                                                      : "var(--mz-text-secondary)",
                                            cursor: "pointer",
                                            "font-size":
                                                "var(--mz-font-size-xs)",
                                            "font-family":
                                                "var(--mz-font-mono)",
                                            "min-width": "80px",
                                            "text-align": "center",
                                        }}>
                                        {capturing() === hotkey.command
                                            ? t("settings.pressShortcut")
                                            : displayKeys()}
                                    </button>
                                </div>
                            </div>
                        );
                    }}
                </For>
            </div>
        </>
    );
};
