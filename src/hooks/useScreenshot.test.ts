// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";

// ── Mocks ────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
    invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockRegister = vi.fn(() => Promise.resolve());
const mockUnregister = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
    register: (...args: unknown[]) => mockRegister(...args),
    unregister: (...args: unknown[]) => mockUnregister(...args),
}));

const mockActiveFile = vi.fn(() => null);
vi.mock("../stores/vault", () => ({
    vaultStore: {
        activeFile: (...args: unknown[]) => mockActiveFile(...args) as { path: string } | null,
    },
}));

const mockSettings = vi.fn(() => ({}));
vi.mock("../stores/settings", () => ({
    settingsStore: {
        settings: (...args: unknown[]) => mockSettings(...args),
    },
}));

vi.mock("../constants/vaultPaths", () => ({
    DEFAULT_ATTACHMENT_FOLDER: ".mindzj/images",
}));

// Import AFTER mocks are hoisted
import { useScreenshot } from "./useScreenshot";

// ── Helpers ──────────────────────────────────────────────────────

/** Minimal valid 1x1 red PNG as base64 */
const FAKE_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

/** Wait for chained microtask promises to settle */
const flush = () => new Promise((r) => setTimeout(r, 10));

// ── Tests ────────────────────────────────────────────────────────

describe("useScreenshot", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        mockSettings.mockReturnValue({});
        mockActiveFile.mockReturnValue(null);
        // Restore mock implementations cleared by clearAllMocks
        mockRegister.mockImplementation(() => Promise.resolve());
        mockUnregister.mockImplementation(() => Promise.resolve());

        // Default: clipboard.write succeeds
        Object.defineProperty(navigator, "clipboard", {
            value: {
                write: vi.fn().mockResolvedValue(undefined),
            },
            writable: true,
            configurable: true,
        });

        // Provide a ClipboardItem constructor
        (globalThis as Record<string, unknown>).ClipboardItem = class {
            constructor(init: Record<string, Blob>) {
                Object.assign(this, init);
            }
        };
    });

    // ── startScreenshot ──────────────────────────────────────────

    describe("startScreenshot", () => {
        it("calls invoke('capture_screen') and stores result", async () => {
            await new Promise<void>((resolve) => {
                createRoot((dispose) => {
                    const { screenshotData, startScreenshot } =
                        useScreenshot({ showToast: vi.fn() });

                    mockInvoke.mockResolvedValue(FAKE_BASE64);

                    expect(screenshotData()).toBeNull();

                    startScreenshot().then(() => {
                        expect(mockInvoke).toHaveBeenCalledWith(
                            "capture_screen",
                        );
                        expect(screenshotData()).toBe(FAKE_BASE64);
                        dispose();
                        resolve();
                    });
                });
            });
        });

        it("is a no-op when already loading", async () => {
            await new Promise<void>((resolve) => {
                createRoot((dispose) => {
                    const { startScreenshot } = useScreenshot({
                        showToast: vi.fn(),
                    });

                    // Make invoke hang so loading stays true
                    mockInvoke.mockReturnValue(new Promise(() => {}));

                    startScreenshot();
                    // Second call immediately — should be no-op
                    startScreenshot().then(() => {
                        expect(mockInvoke).toHaveBeenCalledTimes(1);
                        dispose();
                        resolve();
                    });
                });
            });
        });

        it("is a no-op when screenshotData is already set", async () => {
            await new Promise<void>((resolve) => {
                createRoot((dispose) => {
                    const { startScreenshot } = useScreenshot({
                        showToast: vi.fn(),
                    });

                    mockInvoke.mockResolvedValue(FAKE_BASE64);

                    startScreenshot().then(async () => {
                        expect(mockInvoke).toHaveBeenCalledTimes(1);

                        // Data is set, so next call should be no-op
                        await startScreenshot();
                        expect(mockInvoke).toHaveBeenCalledTimes(1);
                        dispose();
                        resolve();
                    });
                });
            });
        });

        it("resets loading on error", async () => {
            await new Promise<void>((resolve) => {
                createRoot((dispose) => {
                    const { screenshotLoading, startScreenshot } =
                        useScreenshot({ showToast: vi.fn() });

                    mockInvoke.mockRejectedValue(new Error("capture failed"));

                    startScreenshot().then(() => {
                        expect(screenshotLoading()).toBe(false);
                        dispose();
                        resolve();
                    });
                });
            });
        });
    });

    // ── handleScreenshotSave ─────────────────────────────────────

    describe("handleScreenshotSave", () => {
        it("copies to clipboard via Clipboard API", async () => {
            await new Promise<void>((resolve) => {
                createRoot((dispose) => {
                    const { screenshotData, handleScreenshotSave } =
                        useScreenshot({ showToast: vi.fn() });

                    const writeSpy = vi.fn().mockResolvedValue(undefined);
                    Object.defineProperty(navigator, "clipboard", {
                        value: { write: writeSpy },
                        writable: true,
                        configurable: true,
                    });

                    handleScreenshotSave(FAKE_BASE64).then(() => {
                        expect(writeSpy).toHaveBeenCalledTimes(1);
                        // Should NOT have called write_binary_file (no fallback)
                        expect(mockInvoke).not.toHaveBeenCalledWith(
                            "write_binary_file",
                            expect.anything(),
                        );
                        // screenshotData should be cleared
                        expect(screenshotData()).toBeNull();
                        dispose();
                        resolve();
                    });
                });
            });
        });

        it("falls back to disk save on clipboard failure", async () => {
            await new Promise<void>((resolve) => {
                createRoot((dispose) => {
                    const { handleScreenshotSave } = useScreenshot({
                        showToast: vi.fn(),
                    });

                    // Clipboard fails
                    Object.defineProperty(navigator, "clipboard", {
                        value: {
                            write: vi
                                .fn()
                                .mockRejectedValue(
                                    new Error("clipboard blocked"),
                                ),
                        },
                        writable: true,
                        configurable: true,
                    });

                    mockSettings.mockReturnValue({
                        attachment_folder: "my-attachments",
                    });
                    mockActiveFile.mockReturnValue({ path: "note.md" });
                    mockInvoke.mockResolvedValue(undefined);

                    handleScreenshotSave(FAKE_BASE64).then(() => {
                        expect(mockInvoke).toHaveBeenCalledWith(
                            "write_binary_file",
                            expect.objectContaining({
                                relativePath: expect.stringMatching(
                                    /^my-attachments\/screenshot_\d{14}\.png$/,
                                ),
                                base64Data: FAKE_BASE64,
                            }),
                        );
                        dispose();
                        resolve();
                    });
                });
            });
        });

        it("falls back to default attachment folder when setting is empty", async () => {
            await new Promise<void>((resolve) => {
                createRoot((dispose) => {
                    const { handleScreenshotSave } = useScreenshot({
                        showToast: vi.fn(),
                    });

                    Object.defineProperty(navigator, "clipboard", {
                        value: {
                            write: vi
                                .fn()
                                .mockRejectedValue(new Error("no clipboard")),
                        },
                        writable: true,
                        configurable: true,
                    });

                    mockSettings.mockReturnValue({}); // no attachment_folder
                    mockActiveFile.mockReturnValue(null);
                    mockInvoke.mockResolvedValue(undefined);

                    handleScreenshotSave(FAKE_BASE64).then(() => {
                        expect(mockInvoke).toHaveBeenCalledWith(
                            "write_binary_file",
                            expect.objectContaining({
                                relativePath: expect.stringContaining(
                                    ".mindzj/images/",
                                ),
                            }),
                        );
                        dispose();
                        resolve();
                    });
                });
            });
        });

        it("inserts markdown when active file exists and clipboard fails", async () => {
            await new Promise<void>((resolve) => {
                createRoot((dispose) => {
                    const { handleScreenshotSave } = useScreenshot({
                        showToast: vi.fn(),
                    });

                    Object.defineProperty(navigator, "clipboard", {
                        value: {
                            write: vi
                                .fn()
                                .mockRejectedValue(new Error("no clipboard")),
                        },
                        writable: true,
                        configurable: true,
                    });

                    mockSettings.mockReturnValue({});
                    mockActiveFile.mockReturnValue({ path: "note.md" });
                    mockInvoke.mockResolvedValue(undefined);

                    const dispatchSpy = vi.spyOn(document, "dispatchEvent");

                    handleScreenshotSave(FAKE_BASE64).then(() => {
                        expect(dispatchSpy).toHaveBeenCalledWith(
                            expect.objectContaining({
                                type: "mindzj:insert-text",
                            }),
                        );
                        const event = dispatchSpy.mock
                            .calls[0][0] as CustomEvent;
                        expect(event.detail.text).toMatch(
                            /!\[screenshot_\d{14}\.png\]/,
                        );
                        dispose();
                        resolve();
                    });
                });
            });
        });
    });

    // ── Global shortcut ──────────────────────────────────────────
    //
    // The createEffect that drives shortcut registration does NOT
    // fire in solid-js's server build (resolved via `node` condition).
    // This is the same limitation that affects useAiPanel.test.ts
    // (2 of its effect-dependent tests also fail).
    //
    // To enable these tests, configure vitest to resolve solid-js
    // to its client build (dist/solid.js) instead of dist/server.js.
    // This can be done via vite-plugin-solid's test config or by
    // adding `resolve.conditions: ['browser']` to the vitest config.

    describe("global shortcut", () => {
        it.skip("registers Alt+G via createEffect on mount", async () => {
            createRoot((dispose) => {
                useScreenshot({ showToast: vi.fn() });
                dispose();
            });
            await flush();
            expect(mockRegister).toHaveBeenCalledWith(
                "Alt+G",
                expect.any(Function),
            );
        });

        it.skip("uses hotkey override via createEffect", async () => {
            mockSettings.mockReturnValue({
                hotkey_overrides: { screenshot: "Ctrl+Shift+S" },
            });
            createRoot((dispose) => {
                useScreenshot({ showToast: vi.fn() });
                dispose();
            });
            await flush();
            expect(mockRegister).toHaveBeenCalledWith(
                "Ctrl+Shift+S",
                expect.any(Function),
            );
        });

        it.skip("unregisters shortcut on cleanup via onCleanup", async () => {
            let disposeRoot: () => void;
            createRoot((dispose) => {
                disposeRoot = dispose;
                useScreenshot({ showToast: vi.fn() });
            });
            await flush();
            expect(mockRegister).toHaveBeenCalledWith(
                "Alt+G",
                expect.any(Function),
            );

            disposeRoot!();
            await flush();
            expect(mockUnregister).toHaveBeenCalledWith("Alt+G");
        });
    });
});
