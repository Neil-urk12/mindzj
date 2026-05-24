// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — vi.mock is hoisted above all imports
// ---------------------------------------------------------------------------

// Mutable platform ref — change before vi.resetModules() + dynamic import
// to control CLIENT_PLATFORM in a fresh module load.
const { platformRef } = vi.hoisted(() => ({
    platformRef: { current: "linux" as string },
}));

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
    invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockSaveDialog = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
    save: (...args: unknown[]) => mockSaveDialog(...args),
}));

const mockVaultInfo = vi.fn(() => ({ path: "/vault" }));

vi.mock("../stores/vault", () => ({
    vaultStore: {
        vaultInfo: (...args: unknown[]) => mockVaultInfo(...args),
    },
}));

const mockFlush = vi.fn(async () => {});

vi.mock("../stores/editor", () => ({
    editorStore: {
        flushAllPendingSaves: (...args: unknown[]) => mockFlush(...args),
    },
}));

vi.mock("../utils/markdownRenderer", () => ({
    renderMarkdownPreviewHtml: vi.fn(() => "<p>rendered</p>"),
    enhanceMarkdownPreviewHtml: vi.fn(async () => {}),
}));

vi.mock("../utils/pdfExport", () => ({
    ensurePdfExtension: vi.fn((p: string) =>
        /\.pdf$/i.test(p) ? p : `${p}.pdf`,
    ),
    waitForNextFrame: vi.fn(async () => {}),
    waitForPdfExportAssets: vi.fn(async () => {}),
}));

vi.mock("../i18n", () => ({
    t: vi.fn((key: string) => key),
}));

vi.mock("../utils/platform", () => ({
    getClientPlatform: vi.fn(() => platformRef.current),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks — these bind to the "linux" platform module load)
// ---------------------------------------------------------------------------

import { usePdfExport, type UsePdfExportDeps } from "./usePdfExport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(): UsePdfExportDeps {
    return { showToast: vi.fn() };
}

/**
 * Import a fresh copy of usePdfExport with the current platformRef value.
 * Caller MUST set platformRef.current BEFORE calling this.
 * The fresh module gets a new pdfExportInProgress (starts false).
 */
async function importFresh() {
    vi.resetModules();
    return import("./usePdfExport");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePdfExport", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // clearAllMocks doesn't clear mockResolvedValueOnce/mockRejectedValueOnce
        // queues. Explicitly reset mockInvoke to prevent leftover Once entries
        // from leaking between tests.
        mockInvoke.mockReset();
        mockFlush.mockReset();
        // Restore default implementations
        mockVaultInfo.mockReturnValue({ path: "/vault" });
        // jsdom's window.print() is a no-op and never fires "afterprint".
        // Patch it to fire afterprint synchronously.
        window.print = vi.fn(() => {
            window.dispatchEvent(new Event("afterprint"));
        });
        // Reset platform to linux for tests using the original import
        platformRef.current = "linux";
    });

    afterEach(() => {
        document.getElementById("mz-pdf-export-root")?.remove();
        document.getElementById("mz-pdf-export-style")?.remove();
    });

    // ------------------------------------------------------------------
    // flushAllPendingSaves is called before any Tauri interaction
    // ------------------------------------------------------------------

    it("calls flushAllPendingSaves before invoking read_file", async () => {
        const callOrder: string[] = [];
        mockFlush.mockImplementation(async () => {
            callOrder.push("flush");
        });
        mockInvoke.mockImplementation(async (cmd: string) => {
            callOrder.push(cmd);
            return { content: "# Hello", path: "test.md" };
        });

        const { exportMarkdownPathToPdf } = usePdfExport(makeDeps());
        await exportMarkdownPathToPdf("test.md");

        expect(callOrder[0]).toBe("flush");
        expect(callOrder[1]).toBe("read_file");
    });

    // ------------------------------------------------------------------
    // Tauri pdf export (Windows path)
    // ------------------------------------------------------------------

    it("invokes export_current_webview_to_pdf on Windows", async () => {
        platformRef.current = "windows";
        const { usePdfExport: winHook } = await importFresh();

        mockSaveDialog.mockResolvedValue("C:\\output.pdf");
        mockInvoke.mockResolvedValue({ content: "# Hi", path: "note.md" });

        const { exportMarkdownPathToPdf } = winHook(makeDeps());
        await exportMarkdownPathToPdf("note.md");

        expect(mockSaveDialog).toHaveBeenCalled();
        expect(mockInvoke).toHaveBeenCalledWith(
            "export_current_webview_to_pdf",
            expect.objectContaining({
                outputPath: expect.stringContaining(".pdf"),
            }),
        );
    });

    // ------------------------------------------------------------------
    // createPdfExportStyle output (tested via document.head.appendChild spy)
    // ------------------------------------------------------------------

    it("creates a <style> element with @media print CSS and CSS custom properties", async () => {
        // Intercept document.head.appendChild to capture the style element
        // after its textContent has been set by createPdfExportStyle.
        let capturedCss: string | null = null;
        const origAppendChild = document.head.appendChild.bind(document.head);
        vi.spyOn(document.head, "appendChild").mockImplementation(
            (node: Node) => {
                if (
                    node instanceof HTMLStyleElement &&
                    node.id === "mz-pdf-export-style"
                ) {
                    capturedCss = node.textContent;
                }
                return origAppendChild(node) as HTMLElement;
            },
        );

        mockInvoke.mockResolvedValue({ content: "# Y", path: "y.md" });

        const { exportMarkdownPathToPdf } = usePdfExport(makeDeps());
        await exportMarkdownPathToPdf("y.md");

        vi.restoreAllMocks();

        expect(capturedCss).not.toBeNull();
        expect(capturedCss).toContain("#mz-pdf-export-root");
        expect(capturedCss).toContain("@media print");
        expect(capturedCss).toContain("@page");
        expect(capturedCss).toContain("A4 portrait");
        expect(capturedCss).toContain("--mz-bg-primary");
        expect(capturedCss).toContain("--mz-accent");
    });

    // ------------------------------------------------------------------
    // Concurrent export guard
    // ------------------------------------------------------------------

    it("skips a second export call while one is already in-flight", async () => {
        let resolveFirst!: (v: { content: string; path: string }) => void;

        // First call will hang on read_file (after flush succeeds)
        mockInvoke.mockImplementationOnce(
            () =>
                new Promise<{ content: string; path: string }>((resolve) => {
                    resolveFirst = resolve;
                }),
        );
        // Second call's read_file (should never be reached)
        mockInvoke.mockResolvedValueOnce({
            content: "# Second",
            path: "second.md",
        });

        const deps = makeDeps();
        const { exportMarkdownPathToPdf } = usePdfExport(deps);

        // Fire first export — will set the guard and hang on invoke
        const firstPromise = exportMarkdownPathToPdf("first.md");

        // Yield to let the async function reach the invoke call
        await new Promise((r) => setTimeout(r, 10));
        expect(mockFlush).toHaveBeenCalled();

        // Fire second export — should be a no-op (guard is set)
        await exportMarkdownPathToPdf("second.md");

        // Only one read_file was dispatched
        const readFileCalls = mockInvoke.mock.calls.filter(
            (c: unknown[]) => c[0] === "read_file",
        );
        expect(readFileCalls).toHaveLength(1);

        // Unblock the first export
        resolveFirst({ content: "# First", path: "first.md" });
        await firstPromise;

        // Still only one read_file total
        const readFileCallsAfter = mockInvoke.mock.calls.filter(
            (c: unknown[]) => c[0] === "read_file",
        );
        expect(readFileCallsAfter).toHaveLength(1);
    });

    // ------------------------------------------------------------------
    // Guard resets after an error
    // ------------------------------------------------------------------

    it("resets the guard after an error so the next call can proceed", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("boom"));
        mockInvoke.mockResolvedValueOnce({ content: "# OK", path: "ok.md" });

        const { exportMarkdownPathToPdf } = usePdfExport(makeDeps());

        // First call fails
        await exportMarkdownPathToPdf("fail.md");
        // Second call should NOT be blocked
        await exportMarkdownPathToPdf("ok.md");

        const readFileCalls = mockInvoke.mock.calls.filter(
            (c: unknown[]) => c[0] === "read_file",
        );
        expect(readFileCalls).toHaveLength(2);
    });

    // ------------------------------------------------------------------
    // Empty vault root → early return
    // ------------------------------------------------------------------

    it("returns early when vaultStore.vaultInfo() is null", async () => {
        mockVaultInfo.mockReturnValue(null as unknown as { path: string });

        const { exportMarkdownPathToPdf } = usePdfExport(makeDeps());
        await exportMarkdownPathToPdf("any.md");

        expect(mockFlush).not.toHaveBeenCalled();
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // showToast is called with correct keys
    // ------------------------------------------------------------------

    it("calls showToast with pdfExport.failed when invoke rejects", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("read failed"));

        const deps = makeDeps();
        const { exportMarkdownPathToPdf } = usePdfExport(deps);
        await exportMarkdownPathToPdf("bad.md");

        expect(deps.showToast).toHaveBeenCalledWith("pdfExport.failed");
    });

    it("calls showToast with pdfExport.exported on Windows after successful export", async () => {
        platformRef.current = "windows";
        const { usePdfExport: winHook } = await importFresh();

        mockSaveDialog.mockResolvedValue("C:\\out.pdf");
        mockInvoke.mockResolvedValue({ content: "# OK", path: "ok.md" });

        const deps = makeDeps();
        const { exportMarkdownPathToPdf } = winHook(deps);
        await exportMarkdownPathToPdf("ok.md");

        expect(deps.showToast).toHaveBeenCalledWith("pdfExport.exported");
    });

    it("calls showToast with pdfExport.printDialogOpened on non-Windows", async () => {
        mockInvoke.mockResolvedValue({ content: "# OK", path: "ok.md" });

        const deps = makeDeps();
        const { exportMarkdownPathToPdf } = usePdfExport(deps);
        await exportMarkdownPathToPdf("ok.md");

        expect(deps.showToast).toHaveBeenCalledWith(
            "pdfExport.printDialogOpened",
        );
    });

    // ------------------------------------------------------------------
    // Windows cancellation
    // ------------------------------------------------------------------

    it("returns early when Windows save dialog is cancelled", async () => {
        platformRef.current = "windows";
        const { usePdfExport: winHook } = await importFresh();

        mockSaveDialog.mockResolvedValue(null);

        const deps = makeDeps();
        const { exportMarkdownPathToPdf } = winHook(deps);
        await exportMarkdownPathToPdf("cancel.md");

        expect(mockFlush).not.toHaveBeenCalled();
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // DOM cleanup
    // ------------------------------------------------------------------

    it("removes the style and root elements from the DOM after export", async () => {
        mockInvoke.mockResolvedValue({ content: "# X", path: "x.md" });

        const { exportMarkdownPathToPdf } = usePdfExport(makeDeps());
        await exportMarkdownPathToPdf("x.md");

        expect(document.getElementById("mz-pdf-export-root")).toBeNull();
        expect(document.getElementById("mz-pdf-export-style")).toBeNull();
    });

    it("cleans up DOM even when export errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("fail"));

        const { exportMarkdownPathToPdf } = usePdfExport(makeDeps());
        await exportMarkdownPathToPdf("bad.md");

        expect(document.getElementById("mz-pdf-export-root")).toBeNull();
        expect(document.getElementById("mz-pdf-export-style")).toBeNull();
    });

    // ------------------------------------------------------------------
    // Return type
    // ------------------------------------------------------------------

    it("returns an object with exportMarkdownPathToPdf function", () => {
        const result = usePdfExport(makeDeps());
        expect(result).toHaveProperty("exportMarkdownPathToPdf");
        expect(typeof result.exportMarkdownPathToPdf).toBe("function");
    });
});
