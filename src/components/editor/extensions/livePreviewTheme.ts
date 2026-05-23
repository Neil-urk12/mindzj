/**
 * CSS-in-JS theme for live preview decorations.
 */

import { EditorView } from "@codemirror/view";

export const livePreviewTheme = EditorView.baseTheme({
    // Hide syntax markers (**, __, [, ](url), # , > , ---, etc.).
    //
    // Characters stay IN the DOM (so CM6's posAtCoords is exact).
    //
    // CRITICAL: `display: inline` (NOT `inline-block`). `inline-block`
    // creates a new formatting context whose zero width/height shifts
    // the baseline of the line and throws off CM6's per-character Y
    // coordinates — that was the root cause of the "click on line N
    // but cursor lands on line N+1" bug that persisted for 10+ rounds.
    //
    // With `display: inline`, the hidden span is a normal inline box
    // whose zero-size text content participates in the SAME line box
    // as the surrounding text. CM6's DOM measurement of character
    // positions stays consistent with the browser's own caret mapping.
    ".mz-lp-hidden": {
        fontSize: "0 !important",
        letterSpacing: "0",
        color: "transparent !important",
        overflow: "hidden",
    },

    // --- Global line-height guarantee ---
    // A generous line-height ensures the click-target per line is tall
    // enough that even small rounding differences between CM6's height
    // map and the browser's actual layout don't push the click into an
    // adjacent line. This single rule closes the remaining sub-pixel
    // click-accuracy gap that previous fixes couldn't fully eliminate.
    ".cm-content": {
        lineHeight: "1.75",
    },

    // Heading line styles.
    ".cm-line.mz-lp-h1-line": {
        fontSize: "1.8em",
        fontWeight: "700",
        color: "var(--mz-syntax-heading)",
        textDecoration: "none",
        borderBottom: "none",
    },
    ".cm-line.mz-lp-h2-line": {
        fontSize: "1.5em",
        fontWeight: "600",
        color: "var(--mz-syntax-heading)",
        textDecoration: "none",
        borderBottom: "none",
    },
    ".cm-line.mz-lp-h3-line": {
        fontSize: "1.25em",
        fontWeight: "600",
        color: "var(--mz-syntax-heading)",
        textDecoration: "none",
        borderBottom: "none",
    },
    ".cm-line.mz-lp-h4-line": {
        fontSize: "1.1em",
        fontWeight: "600",
        color: "var(--mz-syntax-heading)",
        textDecoration: "none",
        borderBottom: "none",
    },
    ".cm-line.mz-lp-h5-line": {
        fontSize: "1.05em",
        fontWeight: "600",
        color: "var(--mz-syntax-heading)",
        textDecoration: "none",
        borderBottom: "none",
    },
    ".cm-line.mz-lp-h6-line": {
        fontSize: "1em",
        fontWeight: "600",
        color: "var(--mz-syntax-heading)",
        textDecoration: "none",
        borderBottom: "none",
    },
    ".cm-line.mz-lp-blockquote-line": {
        color: "var(--mz-text-secondary)",
        borderLeft: "3px solid var(--mz-border-strong)",
        paddingLeft: "12px",
    },
    ".cm-line.mz-lp-hr-line": {
        position: "relative",
    },
    ".cm-line.mz-lp-hr-line::before": {
        content: '""',
        position: "absolute",
        left: "0",
        right: "0",
        top: "50%",
        borderTop: "1px solid var(--mz-border)",
        transform: "translateY(-50%)",
        pointerEvents: "none",
    },

    // --- Fenced code block styling ---
    // Styled as a complete bordered box with rounded corners. Each
    // line keeps its raw text cursor-addressable; the CSS makes the
    // lines look like a unified code block.
    // 0.88em * 1.99 ~= the normal 1.75 line height, keeping click hit
    // testing aligned with CM6's measured line boxes inside code blocks.
    ".cm-line.mz-lp-code-fence-open": {
        fontFamily: "var(--mz-font-mono)",
        fontSize: "0.88em",
        lineHeight: "1.99",
        color: "var(--mz-text-muted)",
        background: "var(--mz-syntax-code-bg)",
        borderTop: "1px solid var(--mz-border)",
        borderLeft: "1px solid var(--mz-border)",
        borderRight: "1px solid var(--mz-border)",
        borderTopLeftRadius: "6px",
        borderTopRightRadius: "6px",
        paddingLeft: "12px",
        paddingTop: "4px",
    },
    ".cm-line.mz-lp-code-fence-close": {
        fontFamily: "var(--mz-font-mono)",
        fontSize: "0.88em",
        lineHeight: "1.99",
        color: "var(--mz-text-muted)",
        background: "var(--mz-syntax-code-bg)",
        borderBottom: "1px solid var(--mz-border)",
        borderLeft: "1px solid var(--mz-border)",
        borderRight: "1px solid var(--mz-border)",
        borderBottomLeftRadius: "6px",
        borderBottomRightRadius: "6px",
        paddingLeft: "12px",
        paddingBottom: "4px",
    },
    ".cm-line.mz-lp-code-content-line": {
        fontFamily: "var(--mz-font-mono)",
        fontSize: "0.88em",
        lineHeight: "1.99",
        background: "var(--mz-syntax-code-bg)",
        color: "var(--mz-text-primary)",
        borderLeft: "1px solid var(--mz-border)",
        borderRight: "1px solid var(--mz-border)",
        paddingLeft: "12px",
    },
    ".cm-line.mz-lp-code-content-line[data-code-line-number]": {
        position: "relative",
        paddingLeft: "56px",
    },
    ".cm-line.mz-lp-code-content-line[data-code-line-number]::before": {
        content: "attr(data-code-line-number)",
        position: "absolute",
        left: "12px",
        top: "0",
        width: "28px",
        color: "color-mix(in srgb, var(--mz-text-muted) 35%, #cdcdcd)",
        textAlign: "right",
        userSelect: "none",
        pointerEvents: "none",
    },
    ".mz-lp-code-token-keyword": {
        color: "var(--mz-syntax-keyword)",
        fontWeight: "600",
    },
    ".mz-lp-code-token-string": {
        color: "var(--mz-syntax-string)",
    },
    ".mz-lp-code-token-number": {
        color: "var(--mz-syntax-number)",
    },
    ".mz-lp-code-token-comment": {
        color: "var(--mz-syntax-comment)",
        fontStyle: "italic",
    },
    ".mz-lp-code-token-function": {
        color: "var(--mz-syntax-function)",
    },
    ".mz-lp-code-token-type": {
        color: "var(--mz-syntax-type)",
    },
    ".mz-lp-code-token-variable": {
        color: "var(--mz-syntax-variable)",
    },

    // --- Table styling ---
    // NO accent top border — clean subtle borders only.
    ".cm-line.mz-lp-table-header-line": {
        fontFamily: "var(--mz-font-mono)",
        fontSize: "0.95em",
        fontWeight: "700",
        background: "var(--mz-bg-tertiary)",
        color: "var(--mz-text-primary)",
        borderTop: "1px solid var(--mz-border)",
        borderLeft: "1px solid var(--mz-border)",
        borderRight: "1px solid var(--mz-border)",
        borderBottom: "1px solid var(--mz-border)",
    },
    ".cm-line.mz-lp-table-separator-line": {
        fontFamily: "var(--mz-font-mono)",
        fontSize: "0.75em",
        color: "var(--mz-text-muted)",
        background: "var(--mz-bg-tertiary)",
        borderLeft: "1px solid var(--mz-border)",
        borderRight: "1px solid var(--mz-border)",
    },
    ".cm-line.mz-lp-table-row-line": {
        fontFamily: "var(--mz-font-mono)",
        fontSize: "0.95em",
        background: "var(--mz-bg-secondary)",
        borderLeft: "1px solid var(--mz-border)",
        borderRight: "1px solid var(--mz-border)",
        borderBottom: "1px solid var(--mz-border)",
    },

    ".mz-lp-bold": {
        fontWeight: "700",
    },
    ".mz-lp-italic": {
        fontStyle: "italic",
    },
    ".mz-lp-strikethrough": {
        textDecoration: "line-through",
        color: "var(--mz-syntax-strikethrough)",
    },
    ".mz-lp-highlight": {
        background: "var(--mz-syntax-highlight-bg)",
        borderRadius: "2px",
        padding: "1px 2px",
    },
    ".mz-lp-inline-code": {
        fontFamily: "var(--mz-font-mono)",
        fontSize: "0.9em",
        background: "var(--mz-syntax-code-bg)",
        borderRadius: "3px",
        padding: "1px 4px",
    },
    ".mz-lp-link": {
        color: "var(--mz-syntax-link)",
        cursor: "pointer",
        // NOTE: underline, hover background, and hover opacity are
        // ALL declared in editor.css (`.cm-editor .mz-lp-link` +
        // `:hover`). They used to also be here — combining a
        // `borderBottom` + `text-decoration: underline` produced a
        // double underline, and the `&:hover { opacity: ... }` had
        // higher CSS specificity than the CSS file's hover rule
        // (CM6 generates an extra `.ͱN` class prefix) so the CSS
        // hover never won. Both moved out to keep a single source
        // of truth in editor.css.
    },
    ".mz-lp-link-url": {
        color: "var(--mz-text-muted)",
        fontSize: "0.85em",
    },
    ".mz-lp-blockquote": {
        borderLeft: "3px solid var(--mz-border-strong)",
        paddingLeft: "12px",
        color: "var(--mz-text-secondary)",
        fontStyle: "italic",
    },
    ".mz-lp-hr": {
        display: "block",
        height: "1px",
        textAlign: "center",
        color: "transparent",
        borderBottom: "1px solid var(--mz-border)",
        lineHeight: "1px",
        margin: "8px 0",
    },
    ".mz-lp-image": {
        display: "block",
    },
    ".mz-lp-inline-math": {
        fontFamily: "KaTeX_Math, serif",
        padding: "0 2px",
    },
    ".mz-lp-inline-math .katex": {
        fontSize: "1em",
    },
    ".mz-lp-tag": {
        color: "var(--mz-accent)",
        background: "var(--mz-accent-subtle)",
        borderRadius: "3px",
        padding: "1px 4px",
        fontSize: "0.9em",
        cursor: "pointer",
    },
    ".mz-lp-footnote": {
        color: "var(--mz-accent)",
        fontSize: "0.85em",
        verticalAlign: "super",
        cursor: "pointer",
        "&:hover": {
            textDecoration: "underline",
        },
    },
});
