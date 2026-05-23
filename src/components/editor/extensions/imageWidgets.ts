/**
 * CM6 widget classes for inline image rendering and task list checkboxes.
 */

import { EditorView, WidgetType } from "@codemirror/view";
import { resolveImageAssetUrl } from "../../../utils/vaultPaths";
import {
    attachWheelZoom,
    attachCtrlClick,
} from "../../../utils/imageInteraction";
import { showImageContextMenu } from "../../../utils/imageInteraction";
import { parseImageSize, formatImageAlt } from "../../../utils/imageSize";
import { t } from "../../../i18n";

// ---------------------------------------------------------------------------
// Image widget
// ---------------------------------------------------------------------------

/** Inline image preview widget */
export class ImageWidget extends WidgetType {
    constructor(
        private src: string,
        private alt: string,
        private vaultRoot: string,
        private currentFilePath: string,
    ) {
        super();
    }

    toDOM(view: EditorView): HTMLElement {
        // Parse the `|width` or `|widthxheight` suffix out of the
        // alt text so (a) the displayed alt text is clean and (b)
        // we can apply the persisted display size. The raw alt
        // (including suffix) is still kept in `this.alt` so the
        // wheel-zoom onResize below can find the original string
        // to rewrite.
        const { altText, width, height } = parseImageSize(this.alt);

        const wrapper = document.createElement("div");
        wrapper.className = "mz-lp-image image-embed internal-embed is-loaded";
        wrapper.setAttribute("src", this.src);
        wrapper.setAttribute("alt", altText);
        wrapper.style.cssText =
            "padding: 8px 0; max-width: 100%; cursor: pointer;";

        const img = document.createElement("img");
        // data-src = raw vault-relative path from markdown (used by plugins like pixel-perfect-image)
        img.setAttribute("data-src", this.src);
        img.src = resolveImageAssetUrl(
            this.src,
            this.vaultRoot,
            this.currentFilePath,
        );
        img.alt = altText;
        img.className = "mz-embed-image";
        // Do NOT set max-width/max-height inline — use CSS class instead.
        // This allows plugins (pixel-perfect-image) to freely resize via inline style.width.
        img.style.cssText = "border-radius: 6px; display: block;";
        // Apply persisted display size from the markdown alt. We
        // set the width BEFORE the image finishes loading so there's
        // no reflow jitter when the natural size comes in.
        if (width != null) {
            img.style.width = `${width}px`;
            img.style.height = height != null ? `${height}px` : "auto";
            img.setAttribute("data-ppi-wheel-inline-width", String(width));
        }
        img.onerror = () => {
            img.style.display = "none";
            const fallback = document.createElement("span");
            fallback.textContent = `[${t("livePreview.imageFallback")}: ${altText || this.src}]`;
            fallback.style.cssText =
                "color: var(--mz-text-muted); font-size: 12px; font-style: italic;";
            wrapper.appendChild(fallback);
        };

        wrapper.appendChild(img);

        // Build a source-rewriter closure used by both wheel zoom
        // and right-click resize presets. On a size change it:
        //  1. Finds the image's current source position via
        //     `view.posAtDOM(img)` (robust to stale widgets — we
        //     always ask CM6 where this DOM node now lives in the
        //     document, so inserts/deletes elsewhere don't shift
        //     the target out from under us).
        //  2. Scans the line for the `![...](...)` whose src
        //     matches this widget's src (disambiguates when
        //     multiple images are on the same line).
        //  3. Dispatches a CM6 change replacing the match with
        //     the new `![alt|newWidth](src)`.
        // The widget will be rebuilt automatically on the next
        // build-decorations pass because `eq()` now includes alt,
        // so CM6 re-creates the DOM with the new parsed size.
        const persistSize = (newWidth: number) => {
            try {
                const pos = view.posAtDOM(img);
                if (pos < 0) return;
                const line = view.state.doc.lineAt(pos);
                const lineText = line.text;
                const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                let m: RegExpExecArray | null;
                while ((m = imgRegex.exec(lineText)) !== null) {
                    if (m[2] !== this.src) continue;
                    const mStart = line.from + m.index;
                    const mEnd = mStart + m[0].length;
                    // Only rewrite the FIRST match with this src on
                    // the line that actually overlaps this widget's
                    // current position. If the same image appears
                    // multiple times on the line, the position lookup
                    // picks out the specific occurrence.
                    if (pos < mStart || pos > mEnd) continue;
                    const currentAltText = parseImageSize(m[1]).altText;
                    const newAlt = formatImageAlt(
                        currentAltText,
                        newWidth,
                        null,
                    );
                    const newMd = `![${newAlt}](${this.src})`;
                    if (newMd === m[0]) return;
                    view.dispatch({
                        changes: { from: mStart, to: mEnd, insert: newMd },
                    });
                    return;
                }
            } catch (err) {
                // eslint-disable-next-line no-console
                console.warn("[image-resize] persist failed:", err);
            }
        };

        // Alt+wheel zoom & Ctrl+click
        attachWheelZoom(img, { onResize: persistSize });
        attachCtrlClick(img, this.src, this.currentFilePath);

        // Right-click context menu for image operations. Pass the
        // same `persistSize` callback so that picking a size preset
        // from the menu also writes back to the markdown source
        // (not just the live wheel-zoom path).
        wrapper.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            showImageContextMenu(
                e,
                this.src,
                this.currentFilePath,
                img,
                persistSize,
            );
        });

        return wrapper;
    }

    eq(other: ImageWidget): boolean {
        // IMPORTANT: include `alt` in the equality check so CM6
        // rebuilds the widget when the alt (and therefore the
        // parsed size) changes. Without this, a wheel-zoom that
        // rewrites the markdown source would leave the old widget
        // in place with its pre-zoom size, and CM6 would only
        // refresh on the next unrelated edit.
        return this.src === other.src && this.alt === other.alt;
    }
}

// ---------------------------------------------------------------------------
// Checkbox widget
// ---------------------------------------------------------------------------

/** Interactive checkbox widget for task lists */
export class CheckboxWidget extends WidgetType {
    constructor(private checked: boolean) {
        super();
    }

    toDOM(view: EditorView): HTMLElement {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = this.checked;
        cb.className = "mz-lp-checkbox";

        cb.addEventListener("click", (e) => {
            e.preventDefault();
            // Find position and toggle the checkbox in the document
            const pos = view.posAtDOM(cb);
            const line = view.state.doc.lineAt(pos);
            const lineText = line.text;
            const newText = this.checked
                ? lineText.replace("- [x]", "- [ ]").replace("- [X]", "- [ ]")
                : lineText.replace("- [ ]", "- [x]");
            view.dispatch({
                changes: { from: line.from, to: line.to, insert: newText },
            });
        });

        return cb;
    }

    eq(other: CheckboxWidget): boolean {
        return this.checked === other.checked;
    }
}
