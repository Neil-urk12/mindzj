/**
 * Skin picker panel for the Appearance settings tab.
 *
 * Renders built-in (dark + light) presets, a "System" pseudo-skin that
 * defers to `prefers-color-scheme`, and the user's custom `.css` themes
 * imported from disk.
 *
 * The whole panel is per-vault because `settings.theme` lives in
 * `.mindzj/settings.json`. Switching vaults via `open_vault_window`
 * carries the active skin into the new window automatically.
 */

import {
    Component,
    Show,
    For,
    createSignal,
    createEffect,
    createMemo,
    onMount,
    onCleanup,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import {
    settingsStore,
} from "../../stores/settings";
import {
    BUILT_IN_SKINS,
    CUSTOM_SKIN_PREFIX,
    type BuiltInSkin,
} from "../../styles/themes";
import { confirmDialog, promptDialog } from "../common/ConfirmDialog";
import { t } from "../../i18n";

const SYSTEM_SKIN: BuiltInSkin = {
    id: "system",
    label: "System",
    mode: "dark",
    swatch: ["#1e1e1e", "#ffffff"],
};

export const SkinPickerPanel: Component = () => {
    const [customThemes, setCustomThemes] = createSignal<string[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    // Transient success banner (e.g. "Reloaded"). Cleared automatically
    // after a couple seconds so the user always sees a confirmation when
    // an async action completes without becoming noisy over time.
    const [notice, setNotice] = createSignal<string | null>(null);
    createEffect(() => {
        const msg = notice();
        if (!msg) return;
        const timer = window.setTimeout(() => setNotice(null), 2400);
        onCleanup(() => window.clearTimeout(timer));
    });

    // Normalize the raw filename list into bare names without the `.css`
    // extension so downstream UI doesn't have to trim repeatedly.
    const customNames = createMemo(() =>
        customThemes().map((fn) => fn.replace(/\.css$/i, "")),
    );

    async function refresh() {
        setLoading(true);
        try {
            const names = await invoke<string[]>("list_themes");
            setCustomThemes(names);
        } catch (e: any) {
            console.error("[skin] list_themes failed:", e);
            setError(String(e?.message ?? e));
        } finally {
            setLoading(false);
        }
    }

    onMount(() => {
        void refresh();
    });

    function applySkin(id: string) {
        settingsStore.updateSetting("theme", id);
    }

    async function importTheme() {
        setError(null);
        try {
            const selected = await dialogOpen({
                multiple: false,
                directory: false,
                filters: [{ name: "CSS", extensions: ["css"] }],
                title: t("settings.skinImportDialogTitle"),
            });
            if (!selected || typeof selected !== "string") return;
            setBusy(true);
            // overwrite=true so re-importing an existing filename just updates it.
            const fileName = await invoke<string>("import_theme", {
                sourceAbsolutePath: selected,
                overwrite: true,
            });
            const stem = fileName.replace(/\.css$/i, "");
            await refresh();
            applySkin(`${CUSTOM_SKIN_PREFIX}${stem}`);
        } catch (e: any) {
            console.error("[skin] import_theme failed:", e);
            setError(String(e?.message ?? e));
        } finally {
            setBusy(false);
        }
    }

    async function createEmptyTheme() {
        setError(null);
        const raw = await promptDialog(t("settings.skinNewPrompt"), "my-theme");
        if (!raw) return;
        const stem = raw
            .trim()
            .replace(/\.css$/i, "")
            .replace(/[^\w.-]+/g, "-");
        if (!stem) return;
        setBusy(true);
        try {
            const fileName = await invoke<string>("write_theme", {
                bareName: stem,
                content: SKIN_STARTER_CSS,
            });
            await refresh();
            const bare = fileName.replace(/\.css$/i, "");
            applySkin(`${CUSTOM_SKIN_PREFIX}${bare}`);
        } catch (e: any) {
            console.error("[skin] write_theme failed:", e);
            setError(String(e?.message ?? e));
        } finally {
            setBusy(false);
        }
    }

    async function openFolder() {
        setError(null);
        try {
            const dir = await invoke<string>("get_themes_dir");
            // Use the existing `open_path_in_file_manager` command rather
            // than `shell.open()` because on Windows the path returned by
            // `get_themes_dir` carries the `\\?\` extended-length prefix
            // (`Vault::open` canonicalizes the root), which `ShellExecuteW`
            // under `shell.open()` can't parse. The Rust command already
            // strips that prefix before spawning `explorer.exe`, so going
            // through it is the robust cross-platform path.
            await invoke("open_path_in_file_manager", { absolutePath: dir });
        } catch (e: any) {
            console.error("[skin] openFolder failed:", e);
            setError(String(e?.message ?? e));
        }
    }

    async function deleteCustom(stem: string) {
        const confirmed = await confirmDialog(
            t("settings.skinDeleteConfirm", { name: stem }),
        );
        if (!confirmed) return;
        setBusy(true);
        try {
            await invoke("delete_theme", { name: `${stem}.css` });
            // If the user deleted the active skin, fall back to the default.
            const active = settingsStore.settings().theme;
            if (active === `${CUSTOM_SKIN_PREFIX}${stem}`) {
                applySkin("dark");
            }
            await refresh();
        } catch (e: any) {
            console.error("[skin] delete_theme failed:", e);
            setError(String(e?.message ?? e));
        } finally {
            setBusy(false);
        }
    }

    async function reloadActive() {
        setError(null);
        setNotice(null);
        setBusy(true);
        try {
            // Re-scan the themes folder on disk (picks up files the user
            // dropped in manually) and re-read the currently-active custom
            // skin so any external edits to its .css file become visible
            // without restarting the app.
            await refresh();
            await settingsStore.reloadCustomSkin();
            setNotice(t("settings.skinReloadDone"));
        } catch (e: any) {
            console.error("[skin] reload failed:", e);
            setError(String(e?.message ?? e));
        } finally {
            setBusy(false);
        }
    }

    const active = () => settingsStore.settings().theme;

    // Split the preset catalogue into dark vs. light buckets so the
    // picker renders two clearly-labelled sections. We do this at memo
    // scope so the filter only runs when `BUILT_IN_SKINS` changes (i.e.
    // never, in practice) rather than on every render.
    const darkSkins = createMemo(() =>
        BUILT_IN_SKINS.filter((s) => s.mode === "dark"),
    );
    const lightSkins = createMemo(() =>
        BUILT_IN_SKINS.filter((s) => s.mode === "light"),
    );

    const gridStyle = {
        display: "grid",
        "grid-template-columns": "repeat(auto-fill, minmax(170px, 1fr))",
        gap: "8px",
    } as const;
    const groupHeaderStyle = {
        "font-size": "var(--mz-font-size-xs)",
        color: "var(--mz-text-muted)",
        "text-transform": "uppercase" as const,
        "letter-spacing": "0.06em",
        "font-weight": "600",
        "margin-top": "4px",
    };

    return (
        <div
            style={{
                display: "flex",
                "flex-direction": "column",
                gap: "12px",
                padding: "8px 0",
            }}>
            {/* System skin — listed on its own row so it's never mistaken for
          a specific preset. Clicking it hands control to the OS's
          `prefers-color-scheme` so the user can flip light/dark from
          the system menu. */}
            <div style={gridStyle}>
                <SkinCard
                    skin={SYSTEM_SKIN}
                    active={active() === "system"}
                    onSelect={() => applySkin("system")}
                />
            </div>

            {/* Dark presets */}
            <div style={groupHeaderStyle}>{t("settings.skinGroupDark")}</div>
            <div style={gridStyle}>
                <For each={darkSkins()}>
                    {(skin) => (
                        <SkinCard
                            skin={skin}
                            active={active() === skin.id}
                            onSelect={() => applySkin(skin.id)}
                        />
                    )}
                </For>
            </div>

            {/* Light presets */}
            <div style={groupHeaderStyle}>{t("settings.skinGroupLight")}</div>
            <div style={gridStyle}>
                <For each={lightSkins()}>
                    {(skin) => (
                        <SkinCard
                            skin={skin}
                            active={active() === skin.id}
                            onSelect={() => applySkin(skin.id)}
                        />
                    )}
                </For>
            </div>

            {/* Custom themes section.
          The heading, the description paragraph and the action-button
          row each live on their own line. Previously the heading/desc
          block was a flex sibling of the button row which meant that
          in long-locale translations (German / French) the description
          got squeezed into a narrow column next to the buttons and
          wrapped awkwardly — so much so that the heading and
          description sometimes overlapped visually. Stacking the three
          pieces vertically removes the competition for horizontal
          space entirely. */}
            <div
                style={{
                    display: "flex",
                    "flex-direction": "column",
                    gap: "8px",
                    "margin-top": "8px",
                }}>
                <div style={groupHeaderStyle}>
                    {t("settings.customSkinsSection")}
                </div>
                <p
                    style={{
                        "font-size": "var(--mz-font-size-xs)",
                        color: "var(--mz-text-muted)",
                        margin: "0",
                        "line-height": "1.5",
                    }}>
                    {t("settings.customSkinsDescription")}
                </p>
                <div
                    style={{
                        display: "flex",
                        gap: "8px",
                        "flex-wrap": "wrap",
                        "margin-top": "4px",
                    }}>
                    <button
                        onClick={() => {
                            void importTheme();
                        }}
                        disabled={busy()}
                        style={skinBtnPrimary(busy())}>
                        {t("settings.skinImport")}
                    </button>
                    <button
                        onClick={() => {
                            void createEmptyTheme();
                        }}
                        disabled={busy()}
                        style={skinBtnSecondary(busy())}>
                        {t("settings.skinNew")}
                    </button>
                    <button
                        onClick={() => {
                            void openFolder();
                        }}
                        disabled={busy()}
                        style={skinBtnSecondary(busy())}
                        onMouseEnter={(e) => {
                            if (!busy())
                                e.currentTarget.style.background =
                                    "var(--mz-bg-hover)";
                        }}
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                        }>
                        {t("common.openFolder")}
                    </button>
                    <button
                        onClick={() => {
                            void reloadActive();
                        }}
                        disabled={busy()}
                        style={skinBtnSecondary(busy())}
                        onMouseEnter={(e) => {
                            if (!busy())
                                e.currentTarget.style.background =
                                    "var(--mz-bg-hover)";
                        }}
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                        }>
                        {t("common.reload")}
                    </button>
                </div>
            </div>

            <Show
                when={!loading()}
                fallback={
                    <div style={snippetEmptyStyle}>
                        {t("settings.loadingThemes")}
                    </div>
                }>
                <Show
                    when={customNames().length > 0}
                    fallback={
                        <div style={snippetEmptyStyle}>
                            <div>{t("settings.noCustomSkins")}</div>
                            <div
                                style={{
                                    "margin-top": "8px",
                                    "font-size": "var(--mz-font-size-xs)",
                                }}>
                                {t("settings.noCustomSkinsHint")}
                            </div>
                        </div>
                    }>
                    <div
                        style={{
                            display: "grid",
                            "grid-template-columns":
                                "repeat(auto-fill, minmax(180px, 1fr))",
                            gap: "8px",
                        }}>
                        <For each={customNames()}>
                            {(stem) => {
                                const id = `${CUSTOM_SKIN_PREFIX}${stem}`;
                                const isActive = () => active() === id;
                                return (
                                    <div
                                        style={{
                                            ...skinCardStyleBase,
                                            ...(isActive()
                                                ? skinCardStyleActive
                                                : {}),
                                            position: "relative",
                                        }}>
                                        <button
                                            onClick={() => applySkin(id)}
                                            title={t("settings.skinApply")}
                                            style={{
                                                display: "flex",
                                                "align-items": "center",
                                                gap: "8px",
                                                padding: "0",
                                                margin: "0",
                                                background: "transparent",
                                                border: "none",
                                                cursor: "pointer",
                                                color: "var(--mz-text-primary)",
                                                "text-align": "left",
                                                flex: "1",
                                                "min-width": "0",
                                            }}>
                                            {/* Muted swatch — we don't know the colors without
                          parsing the CSS, so render a neutral tile. */}
                                            <span
                                                style={{
                                                    display: "inline-flex",
                                                    width: "32px",
                                                    height: "28px",
                                                    "border-radius":
                                                        "var(--mz-radius-sm)",
                                                    border: "1px solid var(--mz-border)",
                                                    background:
                                                        "repeating-linear-gradient(45deg, var(--mz-bg-hover) 0 4px, var(--mz-bg-active) 4px 8px)",
                                                    "flex-shrink": "0",
                                                }}
                                            />
                                            <div
                                                style={{
                                                    "min-width": "0",
                                                    flex: "1",
                                                }}>
                                                <div
                                                    style={{
                                                        "font-family":
                                                            "var(--mz-font-mono)",
                                                        "font-size":
                                                            "var(--mz-font-size-sm)",
                                                        overflow: "hidden",
                                                        "text-overflow":
                                                            "ellipsis",
                                                        "white-space": "nowrap",
                                                        color: isActive()
                                                            ? "var(--mz-accent)"
                                                            : "var(--mz-text-primary)",
                                                        "font-weight":
                                                            isActive()
                                                                ? "600"
                                                                : "400",
                                                    }}>
                                                    {stem}
                                                </div>
                                                <div
                                                    style={{
                                                        "font-size":
                                                            "var(--mz-font-size-xs)",
                                                        color: "var(--mz-text-muted)",
                                                    }}>
                                                    {t(
                                                        "settings.skinCustomBadge",
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => {
                                                void deleteCustom(stem);
                                            }}
                                            title={t("common.delete")}
                                            style={{
                                                display: "inline-flex",
                                                "align-items": "center",
                                                "justify-content": "center",
                                                width: "24px",
                                                height: "24px",
                                                border: "none",
                                                background: "transparent",
                                                color: "var(--mz-text-muted)",
                                                cursor: "pointer",
                                                "border-radius":
                                                    "var(--mz-radius-sm)",
                                                "flex-shrink": "0",
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
                                    </div>
                                );
                            }}
                        </For>
                    </div>
                </Show>
            </Show>

            <Show when={error()}>
                {(msg) => (
                    <div
                        style={{
                            padding: "10px 12px",
                            background:
                                "color-mix(in srgb, var(--mz-error) 10%, transparent)",
                            color: "var(--mz-error)",
                            "font-size": "var(--mz-font-size-xs)",
                            "border-radius": "var(--mz-radius-sm)",
                        }}>
                        {msg()}
                    </div>
                )}
            </Show>

            <Show when={notice()}>
                {(msg) => (
                    <div
                        style={{
                            padding: "10px 12px",
                            background: "var(--mz-accent-subtle)",
                            color: "var(--mz-accent)",
                            "font-size": "var(--mz-font-size-xs)",
                            "border-radius": "var(--mz-radius-sm)",
                        }}>
                        {msg()}
                    </div>
                )}
            </Show>
        </div>
    );
};

export const SkinCard: Component<{
    skin: BuiltInSkin;
    active: boolean;
    onSelect: () => void;
}> = (props) => {
    return (
        <button
            onClick={props.onSelect}
            style={{
                ...skinCardStyleBase,
                ...(props.active ? skinCardStyleActive : {}),
                cursor: "pointer",
            }}
            onMouseEnter={(e) => {
                if (!props.active) {
                    e.currentTarget.style.borderColor =
                        "var(--mz-border-strong)";
                }
            }}
            onMouseLeave={(e) => {
                if (!props.active) {
                    e.currentTarget.style.borderColor = "var(--mz-border)";
                }
            }}>
            <span
                style={{
                    display: "inline-flex",
                    width: "32px",
                    height: "28px",
                    "border-radius": "var(--mz-radius-sm)",
                    border: "1px solid var(--mz-border)",
                    overflow: "hidden",
                    "flex-shrink": "0",
                }}>
                <span
                    style={{
                        display: "block",
                        flex: "1",
                        background: props.skin.swatch[0],
                    }}
                />
                <span
                    style={{
                        display: "block",
                        flex: "1",
                        background: props.skin.swatch[1],
                    }}
                />
            </span>
            <div style={{ "min-width": "0", flex: "1", "text-align": "left" }}>
                <div
                    style={{
                        "font-size": "var(--mz-font-size-sm)",
                        color: props.active
                            ? "var(--mz-accent)"
                            : "var(--mz-text-primary)",
                        "font-weight": props.active ? "600" : "500",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                    }}>
                    {props.skin.label}
                </div>
                <div
                    style={{
                        "font-size": "var(--mz-font-size-xs)",
                        color: "var(--mz-text-muted)",
                        "text-transform": "capitalize",
                    }}>
                    {props.skin.mode}
                </div>
            </div>
        </button>
    );
};

// A minimal CSS starter template written into new custom themes so the
// user has a working skeleton to edit — sets the five most-visible
// tokens and a comment block explaining which variables are available.
const SKIN_STARTER_CSS = `/* MindZJ custom skin.
   Uncomment / edit the variables below. Any CSS variables not set here
   fall back to the built-in dark palette. See
   src/styles/variables.css in the MindZJ repo for the full list. */

:root {
  --mz-bg-primary: #1b1f2a;
  --mz-bg-secondary: #151823;
  --mz-text-primary: #e5e9f0;
  --mz-accent: #7aa2f7;
  --mz-accent-hover: #a3bcf8;
}
`;

const snippetEmptyStyle = {
    padding: "24px",
    "text-align": "center" as const,
    color: "var(--mz-text-muted)",
    "font-size": "var(--mz-font-size-sm)",
    border: "1px dashed var(--mz-border)",
    "border-radius": "var(--mz-radius-md)",
};

const skinCardStyleBase = {
    display: "flex",
    "align-items": "center",
    gap: "10px",
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--mz-border)",
    "border-radius": "var(--mz-radius-md)",
    background: "var(--mz-bg-primary)",
    cursor: "pointer",
    transition: "border-color 150ms, background 150ms",
} as const;

const skinCardStyleActive = {
    border: "2px solid var(--mz-accent)",
    background: "var(--mz-accent-subtle)",
    padding: "9px 11px", // compensate for the thicker border
} as const;

function skinBtnPrimary(disabled: boolean) {
    return {
        padding: "6px 12px",
        border: "1px solid var(--mz-accent)",
        background: disabled ? "var(--mz-bg-hover)" : "var(--mz-accent)",
        color: disabled ? "var(--mz-text-muted)" : "var(--mz-text-on-accent)",
        "border-radius": "var(--mz-radius-sm)",
        cursor: disabled ? "default" : "pointer",
        "font-size": "var(--mz-font-size-sm)",
        "font-family": "var(--mz-font-sans)",
        opacity: disabled ? "0.6" : "1",
    } as const;
}

function skinBtnSecondary(disabled: boolean) {
    return {
        padding: "6px 12px",
        border: "1px solid var(--mz-border)",
        background: "transparent",
        color: disabled ? "var(--mz-text-muted)" : "var(--mz-text-primary)",
        "border-radius": "var(--mz-radius-sm)",
        cursor: disabled ? "default" : "pointer",
        "font-size": "var(--mz-font-size-sm)",
        "font-family": "var(--mz-font-sans)",
        opacity: disabled ? "0.6" : "1",
    } as const;
}
