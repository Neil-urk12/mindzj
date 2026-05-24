import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { vaultStore } from "../stores/vault";
import { editorStore } from "../stores/editor";
import { displayName } from "../utils/displayName";
import {
    ensurePdfExtension,
    waitForNextFrame,
    waitForPdfExportAssets,
} from "../utils/pdfExport";
import {
    renderMarkdownPreviewHtml,
    enhanceMarkdownPreviewHtml,
} from "../utils/markdownRenderer";
import { t } from "../i18n";
import { getClientPlatform } from "../utils/platform";

const CLIENT_PLATFORM = getClientPlatform();

/** Module-level guard — not reactive, prevents concurrent exports. */
let pdfExportInProgress = false;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds and returns a `<style>` element containing all the CSS needed to
 * render the hidden #mz-pdf-export-root as a print-ready A4 page.
 */
function createPdfExportStyle(): HTMLStyleElement {
    const style = document.createElement("style");
    style.id = "mz-pdf-export-style";
    style.textContent = `
#mz-pdf-export-root {
    --mz-bg-primary: #ffffff;
    --mz-bg-secondary: #f8fafc;
    --mz-bg-tertiary: #f3f6f9;
    --mz-bg-hover: #eef2f6;
    --mz-bg-codeblock: #f6f8fa;
    --mz-text-primary: #1f2328;
    --mz-text-secondary: #424a53;
    --mz-text-muted: #6e7781;
    --mz-border: #d8dee6;
    --mz-border-strong: #b6c0cc;
    --mz-accent: #0969da;
    --mz-accent-subtle: #ddf4ff;
    --mz-syntax-code-bg: #f6f8fa;
    --mz-syntax-keyword: #cf222e;
    --mz-syntax-string: #0a3069;
    --mz-syntax-number: #953800;
    --mz-syntax-comment: #6e7781;
    --mz-syntax-function: #8250df;
    --mz-syntax-type: #116329;
    --mz-syntax-variable: #953800;
    background: #ffffff !important;
    color: #1f2328 !important;
    border: 0 !important;
    outline: 0 !important;
    box-shadow: none !important;
}

@media screen {
    #mz-pdf-export-root {
        position: fixed;
        top: 0;
        left: -100000px;
        width: 794px;
        min-height: 1123px;
        visibility: hidden;
        pointer-events: none;
        background: #ffffff;
        color: #1f2328;
    }
}

@media print {
    @page {
        size: A4 portrait;
        margin: 0;
    }

    html,
    body {
        width: auto !important;
        height: auto !important;
        overflow: visible !important;
        background: #ffffff !important;
        color: #1f2328 !important;
        border: 0 !important;
        outline: 0 !important;
        box-shadow: none !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    * {
        box-shadow: none !important;
    }

    body > *:not(#mz-pdf-export-root) {
        display: none !important;
    }

    body > #mz-pdf-export-root {
        display: block !important;
        position: static !important;
        visibility: visible !important;
        pointer-events: auto !important;
        width: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #ffffff !important;
        color: #1f2328 !important;
        border: 0 !important;
        outline: 0 !important;
        box-shadow: none !important;
    }

    #mz-pdf-export-root .mz-reading-view {
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 0 0 24px !important;
        box-sizing: border-box !important;
        background: #ffffff !important;
        color: #1f2328 !important;
        border: 0 !important;
        outline: 0 !important;
        box-shadow: none !important;
    }

    #mz-pdf-export-root a {
        color: #0969da !important;
        text-decoration: underline !important;
    }

    #mz-pdf-export-root img {
        max-width: 100% !important;
        break-inside: avoid;
    }

    #mz-pdf-export-root table,
    #mz-pdf-export-root pre,
    #mz-pdf-export-root blockquote,
    #mz-pdf-export-root .mz-rv-code,
    #mz-pdf-export-root .mz-rv-callout {
        break-inside: avoid;
    }

    #mz-pdf-export-root .mz-rv-code {
        background: #f6f8fa !important;
        color: #1f2328 !important;
        border: 1px solid #d8dee6 !important;
        border-radius: 6px !important;
    }

    #mz-pdf-export-root .mz-rv-code pre,
    #mz-pdf-export-root .mz-rv-code pre.shiki {
        background: transparent !important;
        color: #1f2328 !important;
    }

    #mz-pdf-export-root .mz-rv-table th {
        background: #f3f6f9 !important;
    }

    #mz-pdf-export-root .mz-rv-code-copy,
    #mz-pdf-export-root .mz-rv-code-lang {
        display: none !important;
    }
}
`;
    return style;
}

/**
 * Opens the browser/native print dialog and resolves once the user
 * dismisses it (or after a 30-second fallback timeout).
 */
async function openNativePrintDialogForPdfExport(): Promise<void> {
    await waitForNextFrame();
    await new Promise<void>((resolve) => {
        let finished = false;
        let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
        const done = () => {
            if (finished) return;
            finished = true;
            if (fallbackTimer) clearTimeout(fallbackTimer);
            window.removeEventListener("afterprint", done);
            resolve();
        };

        window.addEventListener("afterprint", done, { once: true });
        window.print();
        fallbackTimer = setTimeout(done, 30000);
    });
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export interface UsePdfExportDeps {
    showToast: (message: string) => void;
}

export type UsePdfExportReturn = {
    exportMarkdownPathToPdf: (path: string) => Promise<void>;
};

/**
 * Composable that encapsulates PDF-export logic extracted from App.tsx.
 *
 * Usage inside a SolidJS component:
 *
 *   const { exportMarkdownPathToPdf } = usePdfExport({ showToast });
 *   // call exportMarkdownPathToPdf("/notes/foo.md")
 */
export function usePdfExport(deps: UsePdfExportDeps): UsePdfExportReturn {
    const { showToast } = deps;

    async function exportMarkdownPathToPdf(path: string): Promise<void> {
        if (pdfExportInProgress) return;
        const vaultRoot = vaultStore.vaultInfo()?.path ?? "";
        if (!vaultRoot) return;

        const stem = displayName(path).replace(/\.(md|markdown|mdx)$/i, "");
        const selectedPath =
            CLIENT_PLATFORM === "windows"
                ? await saveDialog({
                      title: t("pdfExport.dialogTitle"),
                      defaultPath: `${stem || "note"}.pdf`,
                      filters: [{ name: "PDF", extensions: ["pdf"] }],
                  })
                : null;
        if (CLIENT_PLATFORM === "windows" && !selectedPath) return;

        pdfExportInProgress = true;
        showToast(t("pdfExport.exporting"));

        const outputPath = selectedPath ? ensurePdfExtension(selectedPath) : "";
        let root: HTMLDivElement | null = null;
        let style: HTMLStyleElement | null = null;
        try {
            document.getElementById("mz-pdf-export-root")?.remove();
            document.getElementById("mz-pdf-export-style")?.remove();

            await editorStore.flushAllPendingSaves();
            const file = await invoke<{ content: string; path: string }>(
                "read_file",
                { relativePath: path },
            );

            root = document.createElement("div");
            root.id = "mz-pdf-export-root";
            root.setAttribute("data-source-path", path);

            const content = document.createElement("div");
            content.className = "mz-reading-view mz-pdf-export-content";
            content.innerHTML = renderMarkdownPreviewHtml(
                file.content,
                vaultRoot,
                path,
            );
            root.appendChild(content);

            style = createPdfExportStyle();
            document.head.appendChild(style);
            document.body.appendChild(root);

            await enhanceMarkdownPreviewHtml(content);
            await waitForPdfExportAssets(root);

            if (CLIENT_PLATFORM === "windows") {
                await invoke("export_current_webview_to_pdf", { outputPath });
                console.info("[PDF] exported:", outputPath);
                showToast(t("pdfExport.exported"));
            } else {
                await openNativePrintDialogForPdfExport();
                showToast(t("pdfExport.printDialogOpened"));
            }
        } catch (error) {
            console.warn("[PDF] export failed:", error);
            showToast(t("pdfExport.failed"));
        } finally {
            root?.remove();
            style?.remove();
            pdfExportInProgress = false;
        }
    }

    return { exportMarkdownPathToPdf };
}
