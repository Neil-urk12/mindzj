import { createSignal, createRoot, createEffect } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
    BUILT_IN_SKIN_IDS,
    CUSTOM_SKIN_PREFIX,
    customSkinName,
    isCustomSkin,
    resolveDataTheme,
    skinMode,
} from "../styles/themes";
import {
    DEFAULT_FONT_FAMILY,
    DEFAULT_SETTINGS,
    createDefaultSettings,
    normalizeLoadedSettings,
    serializeSettingsForBackend,
    hotkeyOverridesToBindings,
} from "./settingsNormalize";
import type { AppSettings, HotkeyBinding } from "../types";
import type { PersistedSettings } from "./settingsNormalize";

// Re-export for consumers
export type { AppSettings, AiProviderConfig, AiSkill, AiProviderType } from "../types";
export {
    DEFAULT_FONT_FAMILY,
    aiModelSettingsKey,
    normalizeTheme,
    serializeTheme,
} from "./settingsNormalize";
export type { Theme } from "./settingsNormalize";

// Manual-refresh tick for CSS snippets. Incremented by the UI whenever
// the user clicks "Refresh" on the snippets panel — forces the reactive
// effect in the settings store to re-fetch file contents from disk
// (e.g. after the user edited a snippet file externally).
const [snippetsReloadTick, bumpSnippetsReload] = createSignal(0);
export function reloadCssSnippets() {
    bumpSnippetsReload(snippetsReloadTick() + 1);
}

/**
 * Fetch the contents of the given snippet filenames from the Rust side
 * and inject the concatenated result into the single `<style
 * id="mz-user-css-snippets">` element. Silently drops snippets that
 * fail to read (e.g. user renamed the file while it was enabled).
 */
export async function applyCssSnippets(enabled: string[]) {
    let styleEl = document.getElementById(
        "mz-user-css-snippets",
    ) as HTMLStyleElement | null;
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "mz-user-css-snippets";
        document.head.appendChild(styleEl);
    }
    if (enabled.length === 0) {
        styleEl.textContent = "";
        return;
    }
    const parts: string[] = [];
    for (const name of enabled) {
        try {
            const code = await invoke<string>("read_css_snippet", { name });
            parts.push(`/* ${name} */\n${code}`);
        } catch (e) {
            console.warn(`[css-snippets] failed to read "${name}":`, e);
        }
    }
    styleEl.textContent = parts.join("\n\n");
}

/** Theme IDs that the settings store must not forget about across reloads. */
export const KNOWN_SKIN_IDS: readonly string[] = [
    ...BUILT_IN_SKIN_IDS,
    "system",
];

/** Readable label for `custom:` prefix — re-exported so UIs can use it. */
export const CUSTOM_THEME_PREFIX = CUSTOM_SKIN_PREFIX;

/**
 * Inject (or clear) the CSS of a `custom:<name>` skin into the DOM.
 *
 * Custom skins live on disk as `.mindzj/themes/<name>.css`. When the
 * user switches TO a custom skin we fetch the CSS via the Rust
 * `read_theme` command and put it in a single `<style
 * id="mz-custom-skin">` element at the END of `<head>` so its rules
 * cascade OVER the built-in `:root`/`[data-theme=...]` variable
 * definitions in `variables.css` and `themes/*.css`. Switching
 * AWAY (or the skin failing to load) clears the style element so
 * the built-in palette comes back on its own.
 */
async function applyCustomSkin(id: string | null) {
    let styleEl = document.getElementById(
        "mz-custom-skin",
    ) as HTMLStyleElement | null;
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "mz-custom-skin";
        document.head.appendChild(styleEl);
    }
    if (!id || !isCustomSkin(id)) {
        styleEl.textContent = "";
        return;
    }
    const name = customSkinName(id);
    if (!name) {
        styleEl.textContent = "";
        return;
    }
    try {
        // Backend returns the bare filename list, so we pass `<name>.css`.
        const css = await invoke<string>("read_theme", { name: `${name}.css` });
        styleEl.textContent = `/* custom skin: ${name} */\n${css}`;
    } catch (e) {
        console.warn(`[skin] failed to load custom theme "${name}":`, e);
        styleEl.textContent = "";
    }
}

function createSettingsStore() {
    const [settings, setSettings] = createSignal<AppSettings>(
        createDefaultSettings(),
    );

    // Apply skin (data-theme attribute + custom CSS injection) to the DOM.
    //
    // Built-in skins: we set `data-theme` to the skin ID and clear the
    // custom-skin <style> element. The matching CSS file in
    // `src/styles/themes/` is already loaded at build time, so the
    // browser's selector matching picks up the new variables
    // immediately.
    //
    // `system`: resolve to light/dark once via `prefers-color-scheme`;
    // we don't subscribe to changes here because the rest of the app
    // (and most users) treat "system" as a one-shot preference rather
    // than a live-updating binding.
    //
    // `custom:<name>`: still set `data-theme` to a stable sentinel
    // ("custom") so any `[data-theme="custom"]` rules in the injected
    // CSS match, then load the CSS contents from disk into a
    // single <style> tag at the end of <head>.
    createEffect(() => {
        const theme = settings().theme;
        document.documentElement.setAttribute(
            "data-theme-mode",
            skinMode(theme),
        );
        if (isCustomSkin(theme)) {
            document.documentElement.setAttribute("data-theme", "custom");
            void applyCustomSkin(theme);
        } else {
            const resolved = resolveDataTheme(theme);
            document.documentElement.setAttribute("data-theme", resolved);
            void applyCustomSkin(null);
        }
    });

    // Apply accent color to DOM
    createEffect(() => {
        const color = settings().accent_color;
        if (color) {
            document.documentElement.style.setProperty("--mz-accent", color);
        } else {
            document.documentElement.style.removeProperty("--mz-accent");
        }
    });

    // Apply per-element color overrides (heading / link / highlight)
    // to the DOM via CSS custom properties. When a setting is null,
    // the variable is removed so the theme's default shines through.
    //
    // Highlight is trickier: the base theme uses an rgba() for the
    // highlight background (so the colored block is translucent over
    // the page background). We can't trivially convert a #RRGGBB hex
    // override into rgba, so we just set the value verbatim — the user
    // picks the color they want and gets that color at full opacity.
    // That's the behaviour most users expect from a "highlight color"
    // picker anyway.
    createEffect(() => {
        const color = settings().heading_color;
        if (color) {
            document.documentElement.style.setProperty(
                "--mz-syntax-heading",
                color,
            );
        } else {
            document.documentElement.style.removeProperty(
                "--mz-syntax-heading",
            );
        }
    });
    createEffect(() => {
        const color = settings().link_color;
        if (color) {
            document.documentElement.style.setProperty(
                "--mz-syntax-link",
                color,
            );
        } else {
            document.documentElement.style.removeProperty("--mz-syntax-link");
        }
    });
    createEffect(() => {
        const color = settings().highlight_color;
        if (color) {
            document.documentElement.style.setProperty(
                "--mz-syntax-highlight-bg",
                color,
            );
        } else {
            document.documentElement.style.removeProperty(
                "--mz-syntax-highlight-bg",
            );
        }
    });
    createEffect(() => {
        // Bold color override. Source (`.cm-strong`), live-preview
        // (`.mz-lp-bold`), and reading (`.mz-reading-view strong`) all
        // read from `--mz-syntax-bold`, so setting it once here paints
        // every mode consistently.
        const color = settings().bold_color;
        if (color) {
            document.documentElement.style.setProperty(
                "--mz-syntax-bold",
                color,
            );
        } else {
            document.documentElement.style.removeProperty("--mz-syntax-bold");
        }
    });
    createEffect(() => {
        // Text selection background. `--mz-bg-selection` is consumed
        // by `::selection` in variables.css AND by the CM6 inline
        // theme in Editor.tsx (`.cm-selectionBackground`), so setting
        // it once here lives everywhere at once.
        const color = settings().selection_color;
        if (color) {
            document.documentElement.style.setProperty(
                "--mz-bg-selection",
                color,
            );
        } else {
            document.documentElement.style.removeProperty("--mz-bg-selection");
        }
    });

    createEffect(() => {
        const color = settings().drag_indicator_color;
        if (color) {
            document.documentElement.style.setProperty(
                "--mz-drag-indicator",
                color,
            );
        } else {
            document.documentElement.style.removeProperty(
                "--mz-drag-indicator",
            );
        }
    });

    createEffect(() => {
        const fontFamily =
            settings().font_family?.trim() || DEFAULT_FONT_FAMILY;
        document.documentElement.style.setProperty(
            "--mz-font-sans",
            fontFamily,
        );
    });

    createEffect(() => {
        const fontSize = Math.max(
            8,
            Math.round(settings().font_size || DEFAULT_SETTINGS.font_size),
        );
        document.documentElement.style.setProperty(
            "--mz-font-size-base",
            `${fontSize}px`,
        );
        document.documentElement.style.setProperty(
            "--mz-font-size-md",
            `${fontSize}px`,
        );
        document.documentElement.style.setProperty(
            "--mz-font-size-sm",
            `${Math.max(8, fontSize - 2)}px`,
        );
        document.documentElement.style.setProperty(
            "--mz-font-size-xs",
            `${Math.max(8, fontSize - 4)}px`,
        );
        document.documentElement.style.setProperty(
            "--mz-font-size-lg",
            `${fontSize + 2}px`,
        );
    });

    // Apply user CSS snippets —  file-based model. Each
    // snippet is a `.css` file in `.mindzj/snippets/`; the enabled list
    // lives in settings. We maintain a single <style> element at the end
    // of <head> with the concatenated contents of all enabled snippets so
    // the user's rules cascade over the base theme.
    //
    // The effect re-runs whenever the enabled-snippet array changes (user
    // toggles a snippet) and also when `snippetsReloadTick()` increments
    // (user clicks "Refresh" or the watcher sees a file change).
    createEffect(async () => {
        const enabled = settings().enabled_css_snippets ?? [];
        snippetsReloadTick(); // subscribe for manual refresh
        await applyCssSnippets(enabled);
    });

    // Load settings from backend
    async function loadSettings() {
        let next = createDefaultSettings();
        try {
            const loaded = await invoke<PersistedSettings>("get_settings");
            next = normalizeLoadedSettings(loaded);
        } catch (e) {
            setSettings(next);
            return next;
        }

        try {
            const hotkeys = await invoke<HotkeyBinding[]>("get_hotkeys");
            next.hotkey_overrides = Object.fromEntries(
                hotkeys
                    .filter((binding) => binding.command && binding.keys)
                    .map((binding) => [binding.command, binding.keys]),
            );
        } catch (e) {
            console.warn("Failed to load hotkeys, using defaults:", e);
        }

        setSettings(next);
        return next;
    }

    // Update a single setting
    async function updateSetting<K extends keyof AppSettings>(
        key: K,
        value: AppSettings[K],
    ) {
        const next = { ...settings(), [key]: value };
        setSettings(next);
        try {
            await invoke("update_settings", {
                settings: serializeSettingsForBackend(next),
            });
            if (key === "hotkey_overrides") {
                await invoke("save_hotkeys", {
                    bindings: hotkeyOverridesToBindings(
                        (value as AppSettings["hotkey_overrides"]) ?? {},
                    ),
                });
            }
        } catch (e) {
            console.error("Failed to save settings:", e);
        }
    }

    function resetSettings() {
        setSettings(createDefaultSettings());
    }

    // Toggle between light and dark. Preserves the "family" of the user's
    // current skin when possible — e.g. toggling from `github-dark` takes
    // you to `github-light`, toggling from `nord` (dark only) defaults to
    // the app's built-in light. For custom / unknown skins we fall back
    // to the app defaults so the toolbar button always produces a
    // visible change.
    function toggleTheme() {
        const current = settings().theme;
        const pairs: Record<string, string> = {
            dark: "light",
            light: "dark",
            "mindzj-dark-warm": "mindzj-light-warm",
            "mindzj-light-warm": "mindzj-dark-warm",
            dracula: "dracula-light",
            "dracula-light": "dracula",
            "github-dark": "github-light",
            "github-light": "github-dark",
            "atom-dark": "atom-light",
            "atom-light": "atom-dark",
            "one-dark": "one-light",
            "one-light": "one-dark",
            "sublime-dark": "sublime-light",
            "sublime-light": "sublime-dark",
            "tokyo-night": "tokyo-night-light",
            "tokyo-night-light": "tokyo-night",
            gruvbox: "gruvbox-light",
            "gruvbox-light": "gruvbox",
            catppuccin: "catppuccin-latte",
            "catppuccin-latte": "catppuccin",
            "rose-pine": "rose-pine-dawn",
            "rose-pine-dawn": "rose-pine",
            "everforest-dark": "everforest-light",
            "everforest-light": "everforest-dark",
            "solarized-dark": "solarized-light",
            "solarized-light": "solarized-dark",
        };
        const next =
            pairs[current] ?? (skinMode(current) === "dark" ? "light" : "dark");
        updateSetting("theme", next);
    }

    /**
     * Force a re-read of the currently-active custom skin from disk.
     * Called by the Settings → Appearance "Reload theme" button after
     * the user edits the `.css` file externally. No-op (but still
     * returns a resolved promise) when the active skin isn't a custom
     * one, so callers can safely `await` it unconditionally.
     */
    async function reloadCustomSkin(): Promise<void> {
        const current = settings().theme;
        if (isCustomSkin(current)) {
            await applyCustomSkin(current);
        }
    }

    return {
        settings,
        loadSettings,
        updateSetting,
        toggleTheme,
        resetSettings,
        reloadCustomSkin,
    };
}

export const settingsStore = createRoot(createSettingsStore);
