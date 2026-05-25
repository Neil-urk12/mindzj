import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

// ── Tests ────────────────────────────────────────────────────────

describe("settings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();

        // Settings store's createEffect calls access document for
        // DOM manipulation (data-theme, CSS custom properties, etc.).
        // Stub it before importing the module.
        vi.stubGlobal("document", {
            documentElement: {
                setAttribute: vi.fn(),
                style: {
                    setProperty: vi.fn(),
                    removeProperty: vi.fn(),
                },
            },
            getElementById: vi.fn(() => null),
            createElement: vi.fn(() => ({
                id: "",
                textContent: "",
                appendChild: vi.fn(),
            })),
            head: { appendChild: vi.fn() },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // ── defaults ─────────────────────────────────────────────────

    describe("defaults", () => {
        it("starts with correct default settings", async () => {
            const { settingsStore } = await import("./settings");
            const s = settingsStore.settings();

            expect(s.theme).toBe("dark");
            expect(s.font_size).toBe(16);
            expect(s.auto_save_interval_ms).toBe(2000);
            expect(s.default_view_mode).toBe("live-preview");
            expect(s.editor_word_wrap).toBe(true);
            expect(s.show_markdown_toolbar).toBe(true);
        });
    });

    // ── loadSettings ─────────────────────────────────────────────

    describe("loadSettings", () => {
        it("loads and normalizes settings from backend", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke)
                .mockResolvedValueOnce({ theme: "Dark", font_size: 18 })
                .mockResolvedValueOnce([]);

            const { settingsStore } = await import("./settings");
            const result = await settingsStore.loadSettings();

            expect(invoke).toHaveBeenCalledWith("get_settings");
            expect(result.theme).toBe("dark");
            expect(result.font_size).toBe(18);
            expect(settingsStore.settings().theme).toBe("dark");
        });

        it("returns defaults on settings invoke error", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(new Error("db error"));

            const { settingsStore } = await import("./settings");
            const result = await settingsStore.loadSettings();

            expect(result.theme).toBe("dark");
            expect(result.font_size).toBe(16);
        });

        it("loads hotkeys and maps to overrides", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke)
                .mockResolvedValueOnce({ theme: "light" })
                .mockResolvedValueOnce([
                    { command: "save", keys: "Ctrl+S" },
                    { command: "open", keys: "Ctrl+O" },
                ]);

            const { settingsStore } = await import("./settings");
            await settingsStore.loadSettings();

            expect(settingsStore.settings().hotkey_overrides).toEqual({
                save: "Ctrl+S",
                open: "Ctrl+O",
            });
        });

        it("warns on hotkey load failure but still sets settings", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            vi.mocked(invoke)
                .mockResolvedValueOnce({ theme: "light" })
                .mockRejectedValueOnce(new Error("hotkey error"));

            const { settingsStore } = await import("./settings");
            await settingsStore.loadSettings();

            expect(settingsStore.settings().theme).toBe("light");
            expect(warnSpy).toHaveBeenCalledWith(
                "Failed to load hotkeys, using defaults:",
                expect.any(Error),
            );
            warnSpy.mockRestore();
        });

        it("normalizes legacy Light/Dark/System theme spellings", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke)
                .mockResolvedValueOnce({ theme: "Light" })
                .mockResolvedValueOnce([]);

            const { settingsStore } = await import("./settings");
            const result = await settingsStore.loadSettings();

            expect(result.theme).toBe("light");
        });
    });

    // ── updateSetting ────────────────────────────────────────────

    describe("updateSetting", () => {
        it("updates signal and persists to backend", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { settingsStore } = await import("./settings");
            await settingsStore.updateSetting("font_size", 20);

            expect(settingsStore.settings().font_size).toBe(20);
            expect(invoke).toHaveBeenCalledWith("update_settings", {
                settings: expect.objectContaining({ font_size: 20 }),
            });
        });

        it("saves hotkeys when updating hotkey_overrides", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { settingsStore } = await import("./settings");
            await settingsStore.updateSetting("hotkey_overrides", {
                save: "Ctrl+Shift+S",
            });

            expect(invoke).toHaveBeenCalledWith("save_hotkeys", {
                bindings: [{ command: "save", keys: "Ctrl+Shift+S" }],
            });
        });

        it("logs error but does not throw on failure", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            vi.mocked(invoke).mockRejectedValueOnce(new Error("save error"));

            const { settingsStore } = await import("./settings");
            await settingsStore.updateSetting("font_size", 20);

            // Setting should still be updated locally
            expect(settingsStore.settings().font_size).toBe(20);
            expect(errorSpy).toHaveBeenCalledWith(
                "Failed to save settings:",
                expect.any(Error),
            );
            errorSpy.mockRestore();
        });
    });

    // ── resetSettings ────────────────────────────────────────────

    describe("resetSettings", () => {
        it("resets to defaults", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { settingsStore } = await import("./settings");
            await settingsStore.updateSetting("font_size", 30);
            expect(settingsStore.settings().font_size).toBe(30);

            settingsStore.resetSettings();
            expect(settingsStore.settings().font_size).toBe(16);
            expect(settingsStore.settings().theme).toBe("dark");
            expect(settingsStore.settings().auto_save_interval_ms).toBe(2000);
        });
    });

    // ── toggleTheme ──────────────────────────────────────────────

    describe("toggleTheme", () => {
        it("toggles dark ↔ light", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { settingsStore } = await import("./settings");
            // Default is dark
            settingsStore.toggleTheme();
            expect(settingsStore.settings().theme).toBe("light");

            settingsStore.toggleTheme();
            expect(settingsStore.settings().theme).toBe("dark");
        });

        it("toggles built-in theme pairs", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { settingsStore } = await import("./settings");
            await settingsStore.updateSetting("theme", "github-dark");
            vi.mocked(invoke).mockClear();

            settingsStore.toggleTheme();
            expect(settingsStore.settings().theme).toBe("github-light");

            settingsStore.toggleTheme();
            expect(settingsStore.settings().theme).toBe("github-dark");
        });

        it("falls back to light/dark for unknown themes", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { settingsStore } = await import("./settings");
            await settingsStore.updateSetting("theme", "custom:my-theme");
            vi.mocked(invoke).mockClear();

            settingsStore.toggleTheme();
            // custom:my-theme has no pair, skinMode returns "dark" → toggle to "light"
            expect(settingsStore.settings().theme).toBe("light");
        });
    });
});
