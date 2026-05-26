import {
    Component,
    Show,
    For,
    createSignal,
    onMount,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
    settingsStore,
    reloadCssSnippets,
} from "../../stores/settings";
import { confirmDialog, promptDialog } from "../common/ConfirmDialog";
import { t } from "../../i18n";
import { VAULT_CONFIG_DIR, SNIPPETS_DIR } from "../../constants/vaultPaths";

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

const snippetBtnPrimary = {
    padding: "6px 12px",
    border: "1px solid var(--mz-accent)",
    background: "var(--mz-accent)",
    color: "var(--mz-text-on-accent)",
    "border-radius": "var(--mz-radius-sm)",
    cursor: "pointer",
    "font-size": "var(--mz-font-size-sm)",
    "font-family": "var(--mz-font-sans)",
} as const;

const snippetBtnSecondary = {
    padding: "6px 12px",
    border: "1px solid var(--mz-border)",
    background: "transparent",
    color: "var(--mz-text-primary)",
    "border-radius": "var(--mz-radius-sm)",
    cursor: "pointer",
    "font-size": "var(--mz-font-size-sm)",
    "font-family": "var(--mz-font-sans)",
} as const;

const snippetBtnDanger = {
    padding: "6px 12px",
    border: "1px solid var(--mz-error)",
    background: "transparent",
    color: "var(--mz-error)",
    "border-radius": "var(--mz-radius-sm)",
    cursor: "pointer",
    "font-size": "var(--mz-font-size-sm)",
    "font-family": "var(--mz-font-sans)",
} as const;

const snippetCardStyle = {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    gap: "12px",
    width: "100%",
    padding: "10px 14px",
    border: "1px solid var(--mz-border)",
    "border-radius": "var(--mz-radius-md)",
    "margin-bottom": "8px",
    background: "var(--mz-bg-primary)",
    cursor: "pointer",
} as const;

const snippetCardSelectedStyle = {
    border: "1px solid var(--mz-accent)",
    background: "var(--mz-accent-subtle)",
};

const snippetEmptyStyle = {
    padding: "24px",
    "text-align": "center" as const,
    color: "var(--mz-text-muted)",
    "font-size": "var(--mz-font-size-sm)",
    border: "1px dashed var(--mz-border)",
    "border-radius": "var(--mz-radius-md)",
};

const snippetTextareaStyle = {
    width: "100%",
    "min-height": "320px",
    resize: "vertical" as const,
    border: "none",
    outline: "none",
    padding: "14px",
    background: "var(--mz-bg-primary)",
    color: "var(--mz-text-primary)",
    "font-size": "var(--mz-font-size-sm)",
    "font-family": "var(--mz-font-mono)",
    "line-height": "1.6",
};

export const CssSnippetsPanel: Component = () => {
    const [snippetFiles, setSnippetFiles] = createSignal<string[]>([]);
    const [selectedSnippet, setSelectedSnippet] = createSignal<string | null>(
        null,
    );
    const [draft, setDraft] = createSignal("");
    const [loading, setLoading] = createSignal(true);
    const [loadingSnippet, setLoadingSnippet] = createSignal(false);
    const [saving, setSaving] = createSignal(false);
    const [dirty, setDirty] = createSignal(false);
    const [saveError, setSaveError] = createSignal<string | null>(null);

    const s = () => settingsStore.settings();
    const enabled = () => new Set(s().enabled_css_snippets ?? []);
    const snippetsDir = `${VAULT_CONFIG_DIR}/${SNIPPETS_DIR}`;
    const snippetPath = (name: string) => `${snippetsDir}/${name}`;

    function normalizeSnippetName(value: string) {
        const leaf = value.trim().replace(/\\/g, "/").split("/").pop() ?? "";
        const safe = leaf.replace(/[<>:"/\\|?*]+/g, "-").trim();
        if (!safe) return "";
        return safe.toLowerCase().endsWith(".css") ? safe : `${safe}.css`;
    }

    async function loadSnippet(name: string) {
        setSelectedSnippet(name);
        setLoadingSnippet(true);
        setSaveError(null);
        try {
            const content = await invoke<string>("read_css_snippet", { name });
            setDraft(content);
            setDirty(false);
        } catch (e) {
            console.error("[css-snippets] read failed:", e);
            setDraft("");
        } finally {
            setLoadingSnippet(false);
        }
    }

    async function refresh(preferredName: string | null = selectedSnippet()) {
        setLoading(true);
        try {
            const names = await invoke<string[]>("list_css_snippets");
            setSnippetFiles(names);
            // Prune enabled list to names that actually exist on disk.
            const existing = new Set(names);
            const cur = s().enabled_css_snippets ?? [];
            const pruned = cur.filter((n) => existing.has(n));
            if (pruned.length !== cur.length) {
                await settingsStore.updateSetting(
                    "enabled_css_snippets",
                    pruned,
                );
                reloadCssSnippets();
            }
            const nextSelected =
                preferredName && existing.has(preferredName)
                    ? preferredName
                    : (names[0] ?? null);
            if (!nextSelected) {
                setSelectedSnippet(null);
                setDraft("");
                setDirty(false);
                setSaveError(null);
            } else if (nextSelected !== selectedSnippet()) {
                await loadSnippet(nextSelected);
            } else if (!draft() && !dirty()) {
                await loadSnippet(nextSelected);
            }
        } catch (e) {
            console.error("[css-snippets] list failed:", e);
        } finally {
            setLoading(false);
        }
    }

    onMount(() => {
        void refresh();
    });

    async function toggleSnippet(name: string, on: boolean) {
        const cur = s().enabled_css_snippets ?? [];
        const next = on
            ? Array.from(new Set([...cur, name]))
            : cur.filter((n) => n !== name);
        await settingsStore.updateSetting("enabled_css_snippets", next);
        reloadCssSnippets();
    }

    async function saveSnippet() {
        const name = selectedSnippet();
        if (!name || !dirty()) return true;

        setSaving(true);
        setSaveError(null);
        try {
            await invoke("write_file", {
                relativePath: snippetPath(name),
                content: draft(),
            });
            setDirty(false);
            reloadCssSnippets();
            await refresh(name);
            return true;
        } catch (e: any) {
            console.error("[css-snippets] save failed:", e);
            setSaveError(e?.message || t("common.unknown"));
            return false;
        } finally {
            setSaving(false);
        }
    }

    async function selectSnippet(name: string) {
        if (selectedSnippet() === name) return;
        if (dirty() && !(await saveSnippet())) {
            return;
        }
        await loadSnippet(name);
    }

    async function createSnippet() {
        if (dirty() && !(await saveSnippet())) {
            return;
        }
        const rawName = await promptDialog(
            t("settings.newSnippetPrompt"),
            "snippet.css",
        );
        const name = normalizeSnippetName(rawName || "");
        if (!name) return;

        try {
            await invoke("create_dir", { relativePath: snippetsDir }).catch(
                () => {},
            );
            try {
                await invoke("create_file", {
                    relativePath: snippetPath(name),
                    content: "/* CSS snippet */\n",
                });
            } catch {
                // If the file already exists we just select it below.
            }
            await refresh(name);
            await loadSnippet(name);
        } catch (e) {
            console.error("[css-snippets] create failed:", e);
        }
    }

    async function deleteSnippet() {
        const name = selectedSnippet();
        if (!name) return;
        const confirmed = await confirmDialog(
            t("settings.deleteSnippetConfirm", { name }),
        );
        if (!confirmed) return;

        try {
            await invoke("delete_file", { relativePath: snippetPath(name) });
            const nextEnabled = (s().enabled_css_snippets ?? []).filter(
                (entry) => entry !== name,
            );
            await settingsStore.updateSetting(
                "enabled_css_snippets",
                nextEnabled,
            );
            reloadCssSnippets();
            setSelectedSnippet(null);
            setDraft("");
            setDirty(false);
            setSaveError(null);
            await refresh();
        } catch (e) {
            console.error("[css-snippets] delete failed:", e);
        }
    }

    async function openFolder() {
        try {
            const dir = await invoke<string>("get_snippets_dir");
            // Use the Tauri shell plugin to reveal the folder in the OS file
            // manager. Opening a directory path works on Windows, macOS, Linux.
            const shell = await import("@tauri-apps/plugin-shell");
            await shell.open(dir);
        } catch (e) {
            console.error("[css-snippets] openFolder failed:", e);
        }
    }

    return (
        <div style={{ "margin-top": "24px" }}>
            {/* Heading + description + action-button row all stacked on
          their own lines. Previously the heading/description was a
          flex sibling of the button row, which meant long-locale
          translations (German / French) got squeezed into a narrow
          column next to the buttons and wrapped awkwardly. Stacking
          them vertically removes the horizontal-space competition
          entirely — same fix as applied to the custom-skins panel. */}
            <div
                style={{
                    display: "flex",
                    "flex-direction": "column",
                    gap: "8px",
                    "margin-bottom": "12px",
                }}>
                <h3 style={sectionTitleStyle}>{t("settings.cssSnippets")}</h3>
                <p
                    style={{
                        "font-size": "var(--mz-font-size-xs)",
                        color: "var(--mz-text-muted)",
                        margin: "0",
                        "line-height": "1.5",
                    }}>
                    {t("settings.cssSnippetsDescription.start")}{" "}
                    <code>.mindzj/snippets/</code>
                    {t("settings.cssSnippetsDescription.middle")} "
                    {t("common.reload")}"
                    {t("settings.cssSnippetsDescription.end")}
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
                            void createSnippet();
                        }}
                        title={t("settings.newSnippet")}
                        style={snippetBtnPrimary}>
                        {t("settings.newSnippet")}
                    </button>
                    <button
                        onClick={openFolder}
                        title={t("settings.openSnippetsFolder")}
                        style={snippetBtnSecondary}
                        onMouseEnter={(e) =>
                            (e.currentTarget.style.background =
                                "var(--mz-bg-hover)")
                        }
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                        }>
                        {t("common.openFolder")}
                    </button>
                    <button
                        onClick={() => {
                            void refresh();
                            reloadCssSnippets();
                        }}
                        title={t("settings.reloadSnippets")}
                        style={snippetBtnPrimary}>
                        {t("common.reload")}
                    </button>
                </div>
            </div>

            <Show
                when={!loading()}
                fallback={
                    <div style={snippetEmptyStyle}>
                        {t("settings.loadingSnippets")}
                    </div>
                }>
                <div
                    style={{
                        display: "flex",
                        gap: "16px",
                        "flex-wrap": "wrap",
                    }}>
                    <div
                        style={{
                            flex: "0 0 280px",
                            width: "280px",
                            "max-width": "100%",
                        }}>
                        <Show
                            when={snippetFiles().length > 0}
                            fallback={
                                <div style={snippetEmptyStyle}>
                                    <div>{t("settings.noSnippetFiles")}</div>
                                    <div
                                        style={{
                                            "margin-top": "8px",
                                            "font-size":
                                                "var(--mz-font-size-xs)",
                                        }}>
                                        {t("settings.noSnippetFilesHint")}
                                    </div>
                                </div>
                            }>
                            <For each={snippetFiles()}>
                                {(name) => {
                                    const isOn = () => enabled().has(name);
                                    const isSelected = () =>
                                        selectedSnippet() === name;
                                    return (
                                        <button
                                            onClick={() => {
                                                void selectSnippet(name);
                                            }}
                                            style={{
                                                ...snippetCardStyle,
                                                ...(isSelected()
                                                    ? snippetCardSelectedStyle
                                                    : {}),
                                            }}>
                                            <div
                                                style={{
                                                    "min-width": "0",
                                                    flex: "1",
                                                    "text-align": "left",
                                                }}>
                                                <div
                                                    title={name}
                                                    style={{
                                                        "font-family":
                                                            "var(--mz-font-mono)",
                                                        "font-size":
                                                            "var(--mz-font-size-sm)",
                                                        color: "var(--mz-text-primary)",
                                                        overflow: "hidden",
                                                        "text-overflow":
                                                            "ellipsis",
                                                        "white-space": "nowrap",
                                                    }}>
                                                    {name}
                                                </div>
                                            </div>
                                            <label
                                                style={{
                                                    display: "flex",
                                                    "align-items": "center",
                                                    gap: "6px",
                                                    cursor: "pointer",
                                                    "font-size":
                                                        "var(--mz-font-size-sm)",
                                                    color: "var(--mz-text-secondary)",
                                                    "user-select": "none",
                                                }}
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }>
                                                <input
                                                    type="checkbox"
                                                    checked={isOn()}
                                                    onChange={(e) =>
                                                        void toggleSnippet(
                                                            name,
                                                            e.currentTarget
                                                                .checked,
                                                        )
                                                    }
                                                    style={{
                                                        "accent-color":
                                                            "var(--mz-accent)",
                                                        cursor: "pointer",
                                                    }}
                                                />
                                                {t("common.enable")}
                                            </label>
                                        </button>
                                    );
                                }}
                            </For>
                        </Show>
                    </div>

                    <div style={{ flex: "1 1 360px", "min-width": "280px" }}>
                        <Show
                            when={selectedSnippet()}
                            fallback={
                                <div style={snippetEmptyStyle}>
                                    {t("settings.selectSnippetToEdit")}
                                </div>
                            }>
                            {(name) => (
                                <div
                                    style={{
                                        border: "1px solid var(--mz-border)",
                                        "border-radius": "var(--mz-radius-md)",
                                        background: "var(--mz-bg-primary)",
                                        overflow: "hidden",
                                    }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            "align-items": "center",
                                            "justify-content": "space-between",
                                            gap: "12px",
                                            padding: "12px 14px",
                                            "border-bottom":
                                                "1px solid var(--mz-border)",
                                            background:
                                                "var(--mz-bg-secondary)",
                                        }}>
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
                                                    color: "var(--mz-text-primary)",
                                                    overflow: "hidden",
                                                    "text-overflow": "ellipsis",
                                                    "white-space": "nowrap",
                                                }}>
                                                {name()}
                                            </div>
                                            <div
                                                style={{
                                                    "font-size":
                                                        "var(--mz-font-size-xs)",
                                                    color: "var(--mz-text-muted)",
                                                    "margin-top": "4px",
                                                }}>
                                                {t(
                                                    "settings.cssSnippetEditorHint",
                                                )}
                                            </div>
                                        </div>
                                        <div
                                            style={{
                                                display: "flex",
                                                gap: "8px",
                                                "flex-shrink": "0",
                                            }}>
                                            <button
                                                onClick={() => {
                                                    void saveSnippet();
                                                }}
                                                disabled={!dirty() || saving()}
                                                style={{
                                                    ...snippetBtnPrimary,
                                                    opacity:
                                                        !dirty() || saving()
                                                            ? "0.6"
                                                            : "1",
                                                    cursor:
                                                        !dirty() || saving()
                                                            ? "default"
                                                            : "pointer",
                                                }}>
                                                {saving()
                                                    ? t("common.loading")
                                                    : t("common.save")}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    void deleteSnippet();
                                                }}
                                                style={snippetBtnDanger}>
                                                {t("common.delete")}
                                            </button>
                                        </div>
                                    </div>

                                    <Show
                                        when={!loadingSnippet()}
                                        fallback={
                                            <div style={snippetEmptyStyle}>
                                                {t("common.loading")}
                                            </div>
                                        }>
                                        <textarea
                                            value={draft()}
                                            spellcheck={false}
                                            onInput={(event) => {
                                                setDraft(
                                                    event.currentTarget.value,
                                                );
                                                setDirty(true);
                                                setSaveError(null);
                                            }}
                                            style={snippetTextareaStyle}
                                        />
                                    </Show>

                                    <Show when={saveError()}>
                                        {(message) => (
                                            <div
                                                style={{
                                                    padding: "10px 14px",
                                                    color: "var(--mz-error)",
                                                    "font-size":
                                                        "var(--mz-font-size-xs)",
                                                    "border-top":
                                                        "1px solid var(--mz-border)",
                                                    background:
                                                        "var(--mz-bg-secondary)",
                                                }}>
                                                {message()}
                                            </div>
                                        )}
                                    </Show>
                                </div>
                            )}
                        </Show>
                    </div>
                </div>
            </Show>
        </div>
    );
};
