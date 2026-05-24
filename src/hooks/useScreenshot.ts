import { createSignal, createEffect, onCleanup, type Accessor, type Setter } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
    register,
    unregister,
} from "@tauri-apps/plugin-global-shortcut";
import { vaultStore } from "../stores/vault";
import { settingsStore } from "../stores/settings";
import { DEFAULT_ATTACHMENT_FOLDER } from "../constants/vaultPaths";

export interface UseScreenshotReturn {
    screenshotData: Accessor<string | null>;
    setScreenshotData: Setter<string | null>;
    screenshotLoading: Accessor<boolean>;
    startScreenshot: () => Promise<void>;
    handleScreenshotSave: (base64Png: string) => Promise<void>;
}

export function useScreenshot(_deps: {
    showToast: (msg: string) => void;
}): UseScreenshotReturn {
    const [screenshotData, setScreenshotData] = createSignal<string | null>(
        null,
    );
    const [screenshotLoading, setScreenshotLoading] = createSignal(false);

    // ── Capture ─────────────────────────────────────────────────

    /** Trigger screenshot capture (called by shortcut) */
    async function startScreenshot() {
        if (screenshotLoading() || screenshotData()) return;
        setScreenshotLoading(true);
        try {
            const base64 = await invoke<string>("capture_screen");
            setScreenshotData(base64);
        } catch (err) {
            console.error("[Screenshot] capture_screen failed:", err);
        } finally {
            setScreenshotLoading(false);
        }
    }

    // ── Save / clipboard ────────────────────────────────────────

    /** Save annotated screenshot: clipboard first, disk fallback */
    async function handleScreenshotSave(base64Png: string) {
        try {

            // Decode base64 -> Uint8Array -> Blob(image/png)
            const binary = atob(base64Png);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: "image/png" });

            // Write to the system clipboard.
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ "image/png": blob }),
                ]);
            } catch (clipErr) {
                // If Clipboard API is unavailable for any reason
                // (e.g. secure-context check failed, browser
                // policy blocked it), fall back to the old save-
                // to-vault behavior so the screenshot isn't lost.
                console.warn(
                    "[Screenshot] clipboard.write failed, falling back to disk:",
                    clipErr,
                );

                const timestamp = new Date()
                    .toISOString()
                    .replace(/[-:T]/g, "")
                    .slice(0, 14);
                const filename = `screenshot_${timestamp}.png`;
                const s = settingsStore.settings();
                const folder = s.attachment_folder || DEFAULT_ATTACHMENT_FOLDER;
                const relativePath = `${folder}/${filename}`;
                await invoke("write_binary_file", {
                    relativePath,
                    base64Data: base64Png,
                });
                const activeFile = vaultStore.activeFile();
                if (activeFile) {
                    const imgMarkdown = `![${filename}](${relativePath})`;
                    document.dispatchEvent(
                        new CustomEvent("mindzj:insert-text", {
                            detail: { text: imgMarkdown },
                        }),
                    );
                }
            }
        } catch (err) {
            console.error("[Screenshot] save failed:", err);
        } finally {
            setScreenshotData(null);
        }
    }

    // ── Global shortcut (Alt+G) ─────────────────────────────────

    {
        let lastCombo: string | null = null;
        let pending: Promise<void> = Promise.resolve();

        const syncShortcut = (nextCombo: string) => {
            if (nextCombo === lastCombo) return;
            const previousCombo = lastCombo;
            lastCombo = nextCombo;
            // Chain off the previous in-flight register/unregister so
            // we never have two flows touching the OS hotkey table
            // concurrently.
            pending = pending.then(async () => {
                if (previousCombo) {
                    try {
                        await unregister(previousCombo);
                    } catch {}
                }
                try {
                    await register(nextCombo, (event) => {
                        if (event.state === "Pressed") startScreenshot();
                    });
                } catch (err) {
                    console.warn(
                        "[GlobalShortcut] Failed to (re)register screenshot shortcut:",
                        err,
                    );
                    // Roll back so the next change attempt can retry.
                    lastCombo = previousCombo;
                }
            });
        };

        const getHotkey = (command: string, defaultKeys: string): string => {
            const overrides = settingsStore.settings().hotkey_overrides || {};
            return overrides[command] || defaultKeys;
        };

        createEffect(() => {
            const combo = getHotkey("screenshot", "Alt+G");
            syncShortcut(combo);
        });

        onCleanup(() => {
            const combo = lastCombo;
            if (combo) {
                pending = pending.then(() =>
                    unregister(combo).catch(() => {}),
                );
                lastCombo = null;
            }
        });
    }

    return {
        screenshotData,
        setScreenshotData,
        screenshotLoading,
        startScreenshot,
        handleScreenshotSave,
    };
}
