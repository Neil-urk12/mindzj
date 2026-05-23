/**
 * Pure Markdown → HTML renderer extracted from ReadingView.
 *
 * Zero SolidJS / component coupling — every function here is a plain
 * string-in → string-out (or Promise<void> for post-render enhancers)
 * utility that can be tested independently.
 */

import katex from "katex";
import { resolveImageAssetUrl } from "./vaultPaths";
import { linkifyHtmlText, ensureScheme } from "./autoLink";
import { parseImageSize } from "./imageSize";
import { settingsStore } from "../stores/settings";
import { t } from "../i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RenderContext {
    vaultRoot: string;
    currentFilePath: string;
    footnotes: Map<string, string>;
}

type ReadingListKind = "task" | "ul" | "ol";

interface ReadingListToken {
    kind: ReadingListKind;
    level: number;
    line: number;
    content: string;
    checked?: boolean;
    start?: number;
}

// ---------------------------------------------------------------------------
// List helpers (local copy — do NOT import from listUtils)
// ---------------------------------------------------------------------------

function measureListIndent(whitespace: string): number {
    let columns = 0;
    for (const char of whitespace) {
        columns += char === "\t" ? 4 : 1;
    }
    return Math.floor(columns / 4);
}

function parseReadingListToken(
    line: string,
    lineNumber: number,
): ReadingListToken | null {
    // The third capture group is `(\s(.*))?` (optional) so that an
    // empty list item like `2. ` (or `- [ ]` or `- ` with no content)
    // STILL matches and renders as a list item with empty content.
    // The previous regexes used `\s(.+)$` which required at least
    // one character after the marker — that broke the very common
    // case of a half-typed ordered list where the last line is just
    // `3. ` and the user expects it to render aligned with `1.`/`2.`
    // instead of as a stray paragraph below the <ol>.

    const taskMatch = line.match(/^(\s*)- \[([ xX])\](?:\s(.*))?$/);
    if (taskMatch) {
        return {
            kind: "task",
            level: measureListIndent(taskMatch[1] ?? ""),
            line: lineNumber,
            content: taskMatch[3] ?? "",
            checked: taskMatch[2] !== " ",
        };
    }

    const unorderedMatch = line.match(/^(\s*)([-*+])(?:\s(.*))?$/);
    if (unorderedMatch) {
        return {
            kind: "ul",
            level: measureListIndent(unorderedMatch[1] ?? ""),
            line: lineNumber,
            content: unorderedMatch[3] ?? "",
        };
    }

    const orderedMatch = line.match(/^(\s*)(\d+)\.(?:\s(.*))?$/);
    if (orderedMatch) {
        return {
            kind: "ol",
            level: measureListIndent(orderedMatch[1] ?? ""),
            line: lineNumber,
            content: orderedMatch[3] ?? "",
            start: Number.parseInt(orderedMatch[2], 10),
        };
    }

    return null;
}

function openReadingList(token: ReadingListToken): string {
    const classes = ["mz-rv-list"];
    if (token.kind === "ol") {
        classes.push("mz-rv-list-ol");
        return `<ol class="${classes.join(" ")}" start="${token.start ?? 1}">`;
    }
    if (token.kind === "task") {
        classes.push("mz-rv-task-list", "mz-rv-list-ul");
        return `<ul class="${classes.join(" ")}">`;
    }
    classes.push("mz-rv-list-ul");
    return `<ul class="${classes.join(" ")}">`;
}

function renderReadingListItem(
    token: ReadingListToken,
    ctx: RenderContext,
): string {
    const content = renderInline(token.content, ctx);
    if (token.kind === "task") {
        return (
            `<li class="mz-rv-task-item${token.checked ? " checked" : ""}" data-line="${token.line}">` +
            `<input type="checkbox" ${token.checked ? "checked" : ""} disabled />` +
            `<div class="mz-rv-task-item-content"><span>${content}</span>`
        );
    }
    const body =
        token.content.trim() === ""
            ? '<span class="mz-rv-empty-list-slot" aria-hidden="true"></span>'
            : content;
    return `<li data-line="${token.line}">${body}`;
}

function renderReadingListTokens(
    tokens: ReadingListToken[],
    startIndex: number,
    level: number,
    ctx: RenderContext,
): { html: string; nextIndex: number } {
    let html = "";
    let index = startIndex;

    while (index < tokens.length) {
        const first = tokens[index];
        if (first.level < level) break;
        if (first.level > level) {
            const nested = renderReadingListTokens(
                tokens,
                index,
                first.level,
                ctx,
            );
            html += nested.html;
            index = nested.nextIndex;
            continue;
        }

        html += openReadingList(first);
        while (index < tokens.length) {
            const token = tokens[index];
            if (token.level !== level || token.kind !== first.kind) break;

            html += renderReadingListItem(token, ctx);
            index++;

            while (index < tokens.length && tokens[index].level > level) {
                const nested = renderReadingListTokens(
                    tokens,
                    index,
                    tokens[index].level,
                    ctx,
                );
                html += nested.html;
                index = nested.nextIndex;
            }

            html += token.kind === "task" ? "</div></li>" : "</li>";
        }
        html += first.kind === "ol" ? "</ol>" : "</ul>";
    }

    return { html, nextIndex: index };
}

function renderReadingListBlock(
    lines: string[],
    startIndex: number,
    ctx: RenderContext,
): { html: string; nextIndex: number } | null {
    const tokens: ReadingListToken[] = [];
    let index = startIndex;

    while (index < lines.length) {
        const token = parseReadingListToken(lines[index], index);
        if (!token) break;
        tokens.push(token);
        index++;
    }

    if (tokens.length === 0) return null;

    return {
        html: renderReadingListTokens(tokens, 0, tokens[0].level, ctx).html,
        nextIndex: index,
    };
}

// ---------------------------------------------------------------------------
// Block-level markdown → HTML parser
// ---------------------------------------------------------------------------

export function markdownToHtml(md: string, ctx: RenderContext): string {
    const lines = md.split("\n");
    const html: string[] = [];
    let i = 0;
    const closeList = () => {};

    // First pass: collect footnote definitions
    for (const line of lines) {
        const fnDefMatch = line.match(/^\[\^([^\]]+)\]:\s*(.+)$/);
        if (fnDefMatch) {
            ctx.footnotes.set(fnDefMatch[1], fnDefMatch[2]);
        }
    }

    while (i < lines.length) {
        const line = lines[i];

        // --- Fenced code block ---
        const codeMatch = line.match(/^(`{3,}|~{3,})(\w*)\s*$/);
        if (codeMatch) {
            closeList();
            const fence = codeMatch[1];
            const lang = codeMatch[2] || "";
            const codeLines: string[] = [];
            i++;
            while (i < lines.length) {
                if (
                    lines[i].startsWith(fence.charAt(0).repeat(fence.length)) &&
                    lines[i].trim().length <= fence.length + 1
                ) {
                    i++;
                    break;
                }
                codeLines.push(lines[i]);
                i++;
            }
            const code = renderCodeLinesHtml(codeLines);
            const langAttr = lang ? ` data-lang="${lang}"` : "";
            const langBadge = lang
                ? `<span class="mz-rv-code-lang">${lang}</span>`
                : "";
            const lineNumberClass = settingsStore.settings()
                .markdown_code_block_line_numbers
                ? " mz-rv-code-line-numbers"
                : "";

            if (lang === "mermaid") {
                html.push(
                    `<div class="mz-rv-mermaid" data-mermaid="${escapeAttr(codeLines.join("\n"))}">${langBadge}<pre><code>${code}</code></pre></div>`,
                );
            } else {
                html.push(
                    `<div class="mz-rv-code${lineNumberClass}"${langAttr}>${langBadge}<button class="mz-rv-code-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent).then(()=>{this.textContent='${escapeAttr(t("common.copyDone"))}';setTimeout(()=>this.textContent='${escapeAttr(t("common.copy"))}',1500)})">${t("common.copy")}</button><pre><code>${code}</code></pre></div>`,
                );
            }
            continue;
        }

        // --- Math block ---
        if (line.trim() === "$$") {
            closeList();
            const mathLines: string[] = [];
            i++;
            while (i < lines.length && lines[i].trim() !== "$$") {
                mathLines.push(lines[i]);
                i++;
            }
            if (i < lines.length) i++; // skip closing $$
            const tex = mathLines.join("\n");
            try {
                const rendered = katex.renderToString(tex.trim(), {
                    displayMode: true,
                    throwOnError: false,
                    output: "html",
                    trust: true,
                });
                html.push(`<div class="mz-rv-math-block">${rendered}</div>`);
            } catch {
                html.push(
                    `<div class="mz-rv-math-block mz-rv-error">${escapeHtml(tex)}</div>`,
                );
            }
            continue;
        }

        // --- Callout block ---
        const calloutMatch = line.match(/^>\s*\[!(\w+)\]([+-])?\s*(.*)?$/);
        if (calloutMatch) {
            closeList();
            const type = calloutMatch[1];
            const foldChar = calloutMatch[2] || "";
            const title =
                calloutMatch[3] || type.charAt(0).toUpperCase() + type.slice(1);
            const bodyLines: string[] = [];
            i++;
            while (
                i < lines.length &&
                (lines[i].startsWith("> ") || lines[i] === ">")
            ) {
                bodyLines.push(lines[i].replace(/^>\s?/, ""));
                i++;
            }
            const bodyHtml = renderInline(bodyLines.join("\n"), ctx);
            const def = getCalloutDef(type);
            const foldable = foldChar === "+" || foldChar === "-";
            const defaultOpen = foldChar !== "-";

            html.push(
                `<div class="mz-rv-callout" style="border-left-color:${def.color}">` +
                    `<div class="mz-rv-callout-header"${foldable ? " onclick=\"this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.fold').textContent=this.nextElementSibling.style.display==='none'?'▶':'▼'\" style=\"cursor:pointer\"" : ""}>` +
                    `<span class="mz-rv-callout-icon">${def.icon}</span>` +
                    `<span class="mz-rv-callout-title" style="color:${def.color}">${escapeHtml(title)}</span>` +
                    (foldable
                        ? `<span class="fold">${defaultOpen ? "▼" : "▶"}</span>`
                        : "") +
                    `</div>` +
                    `<div class="mz-rv-callout-body"${foldable && !defaultOpen ? ' style="display:none"' : ""}>${bodyHtml}</div>` +
                    `</div>`,
            );
            continue;
        }

        // --- Table ---
        if (
            line.includes("|") &&
            i + 1 < lines.length &&
            /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])
        ) {
            closeList();
            const tableLines: string[] = [];
            while (i < lines.length && lines[i].includes("|")) {
                tableLines.push(lines[i]);
                i++;
            }
            html.push(renderTable(tableLines, ctx));
            continue;
        }

        // --- Horizontal rule ---
        if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            closeList();
            html.push('<hr class="mz-rv-hr" />');
            i++;
            continue;
        }

        // --- Heading ---
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            closeList();
            const level = headingMatch[1].length;
            const content = renderInline(headingMatch[2], ctx);
            const id = headingMatch[2]
                .toLowerCase()
                .replace(/[^\w\u4e00-\u9fff]+/g, "-")
                .replace(/(^-|-$)/g, "");
            html.push(
                `<h${level} id="${id}" class="mz-rv-h${level}" data-line="${i}">${content}</h${level}>`,
            );
            i++;
            continue;
        }

        // --- Blockquote (non-callout) ---
        if (line.startsWith("> ") || line === ">") {
            closeList();
            const bqStart = i;
            const quoteLines: string[] = [];
            while (
                i < lines.length &&
                (lines[i].startsWith("> ") || lines[i] === ">")
            ) {
                quoteLines.push(lines[i].replace(/^>\s?/, ""));
                i++;
            }
            const inner = renderInline(quoteLines.join("\n"), ctx);
            html.push(
                `<blockquote class="mz-rv-blockquote" data-line="${bqStart}">${inner}</blockquote>`,
            );
            continue;
        }

        // --- Lists (ordered / unordered / task, with nesting) ---
        const listBlock = renderReadingListBlock(lines, i, ctx);
        if (listBlock) {
            closeList();
            html.push(listBlock.html);
            i = listBlock.nextIndex;
            continue;
        }

        // --- Footnote definition ---
        const fnDefMatch = line.match(/^\[\^([^\]]+)\]:\s*(.+)$/);
        if (fnDefMatch) {
            closeList();
            const id = fnDefMatch[1];
            const content = renderInline(fnDefMatch[2], ctx);
            html.push(
                `<div class="mz-rv-footnote-def" id="fn-${id}">` +
                    `<sup>${id}</sup> ${content}` +
                    `</div>`,
            );
            i++;
            continue;
        }

        // --- Empty line ---
        // Reading mode should collapse blank source lines instead of
        // emitting placeholder paragraphs, so we just skip them.
        if (line.trim() === "") {
            closeList();
            i++;
            continue;
        }

        // --- Paragraph ---
        closeList();
        const paraStart = i;
        const paraLines: string[] = [line];
        i++;
        while (
            i < lines.length &&
            lines[i].trim() !== "" &&
            !lines[i].match(/^#{1,6}\s/) &&
            !lines[i].match(/^(`{3,}|~{3,})/) &&
            !lines[i].startsWith("> ") &&
            !lines[i].match(/^\s*[-*+]\s/) &&
            !lines[i].match(/^\s*\d+\.\s/) &&
            lines[i].trim() !== "$$" &&
            !lines[i].match(/^(-{3,}|\*{3,}|_{3,})\s*$/)
        ) {
            paraLines.push(lines[i]);
            i++;
        }
        const paraContent = renderInline(paraLines.join("\n"), ctx);
        html.push(`<p data-line="${paraStart}">${paraContent}</p>`);
    }

    // Add footnote section if any
    if (ctx.footnotes.size > 0) {
        html.push('<hr class="mz-rv-hr" />');
        html.push('<section class="mz-rv-footnotes">');
        for (const [id, text] of ctx.footnotes) {
            if (!html.some((h) => h.includes(`id="fn-${id}"`))) {
                html.push(
                    `<div class="mz-rv-footnote-def" id="fn-${id}"><sup>${id}</sup> ${renderInline(text, ctx)}</div>`,
                );
            }
        }
        html.push("</section>");
    }

    return html.join("\n");
}

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

function renderInline(text: string, ctx: RenderContext): string {
    let result = escapeHtml(text);

    // Inline math: $...$
    result = result.replace(
        /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g,
        (_, tex) => {
            try {
                return katex.renderToString(unescapeHtml(tex).trim(), {
                    displayMode: false,
                    throwOnError: false,
                    output: "html",
                    trust: true,
                });
            } catch {
                return `<code class="mz-rv-error">${tex}</code>`;
            }
        },
    );

    // Images: ![alt](src) — with optional `|width` / `|widthxheight`
    // suffix in the alt text for persisted display size (see
    // `utils/imageSize.ts`).
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
        const rawSrc = unescapeHtml(src);
        const resolvedSrc = resolveImageSrc(
            rawSrc,
            ctx.vaultRoot,
            ctx.currentFilePath,
        );
        // Split `alt|width[xheight]` so the rendered alt text
        // doesn't include the size suffix, and the inline
        // style gets the persisted dimensions.
        const { altText, width, height } = parseImageSize(alt);
        const escapedAlt = escapeAttr(altText);
        const styleBits: string[] = [];
        if (width != null) {
            styleBits.push(`width:${width}px`);
            styleBits.push(
                height != null ? `height:${height}px` : "height:auto",
            );
        }
        const styleAttr =
            styleBits.length > 0 ? ` style="${styleBits.join(";")}"` : "";
        const dataWidthAttr =
            width != null ? ` data-ppi-wheel-inline-width="${width}"` : "";
        return `<span class="image-embed internal-embed is-loaded"><img src="${resolvedSrc}" data-src="${escapeAttr(rawSrc)}" alt="${escapedAlt}" class="mz-rv-image"${styleAttr}${dataWidthAttr} loading="lazy" /></span>`;
    });

    // Wiki links: [[target|display]] or [[target]]
    result = result.replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_, target, display) => {
            const label = display || target;
            return `<a class="mz-rv-wikilink" data-target="${escapeAttr(target)}">${label}</a>`;
        },
    );

    // Markdown links: [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
        const isExternal =
            url.startsWith("http://") || url.startsWith("https://");
        return `<a href="${escapeAttr(url)}" class="mz-rv-link"${isExternal ? ' target="_blank" rel="noopener"' : ""}>${text}</a>`;
    });

    // Auto-link bare URLs (github.com/foo, https://example.com, ...).
    // Gated by the `auto_link_urls` setting; when off, URLs render as
    // plain text. Skips URLs already inside an <a> tag so the
    // markdown-link replace above isn't clobbered.
    if (settingsStore.settings().auto_link_urls) {
        result = linkifyHtmlText(result, (url) => {
            const href = ensureScheme(url);
            return `<a href="${escapeAttr(href)}" class="mz-rv-link mz-rv-autolink" target="_blank" rel="noopener">${url}</a>`;
        });
    }

    // Bold: exactly two asterisks only. Triple asterisks remain plain text.
    result = result.replace(
        /(?<!\*)\*\*(?!\*)(.+?)(?<!\*)\*\*(?!\*)/g,
        "<strong>$1</strong>",
    );

    // Italic: exactly one asterisk only. Avoid list markers and bold.
    result = result.replace(
        /(?<!\*)\*(?![\s*])(.+?)(?<![\s*])\*(?!\*)/g,
        "<em>$1</em>",
    );

    // Strikethrough: ~~text~~
    result = result.replace(/~~(.+?)~~/g, "<del>$1</del>");

    // Highlight: ==text==
    result = result.replace(
        /==(.+?)==/g,
        '<mark class="mz-rv-highlight">$1</mark>',
    );

    // Inline code: `text`
    result = result.replace(
        /(?<!`)`(?!`)(.+?)(?<!`)`(?!`)/g,
        '<code class="mz-rv-inline-code">$1</code>',
    );

    // Tags: #tag
    result = result.replace(
        /(?<=\s|^)#([a-zA-Z\u4e00-\u9fff][\w\u4e00-\u9fff/\-]*)/g,
        '<span class="mz-rv-tag">#$1</span>',
    );

    // Footnote references: [^id]
    result = result.replace(
        /\[\^([^\]]+)\]/g,
        '<sup class="mz-rv-footnote-ref"><a href="#fn-$1">$1</a></sup>',
    );

    // Line breaks
    result = result.replace(/\n/g, "<br />");

    return result;
}

// ---------------------------------------------------------------------------
// Table renderer
// ---------------------------------------------------------------------------

function renderTable(lines: string[], ctx: RenderContext): string {
    const parseRow = (line: string): string[] =>
        line
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => cell.trim());

    if (lines.length < 2) return "";

    const headerCells = parseRow(lines[0]);
    const alignRow = parseRow(lines[1]);
    const aligns = alignRow.map((cell) => {
        if (cell.startsWith(":") && cell.endsWith(":")) return "center";
        if (cell.endsWith(":")) return "right";
        return "left";
    });

    let html = '<table class="mz-rv-table"><thead><tr>';
    for (let j = 0; j < headerCells.length; j++) {
        html += `<th style="text-align:${aligns[j] || "left"}">${renderInline(headerCells[j], ctx)}</th>`;
    }
    html += "</tr></thead><tbody>";

    for (let i = 2; i < lines.length; i++) {
        const cells = parseRow(lines[i]);
        html += "<tr>";
        for (let j = 0; j < headerCells.length; j++) {
            html += `<td style="text-align:${aligns[j] || "left"}">${renderInline(cells[j] || "", ctx)}</td>`;
        }
        html += "</tr>";
    }
    html += "</tbody></table>";
    return html;
}

// ---------------------------------------------------------------------------
// Callout definitions
// ---------------------------------------------------------------------------

interface CalloutDef {
    icon: string;
    color: string;
}

const CALLOUT_TYPES: Record<string, CalloutDef> = {
    note: { icon: "📝", color: "var(--mz-callout-note)" },
    abstract: { icon: "📋", color: "var(--mz-callout-info)" },
    summary: { icon: "📋", color: "var(--mz-callout-info)" },
    info: { icon: "ℹ️", color: "var(--mz-callout-info)" },
    tip: { icon: "💡", color: "var(--mz-callout-tip)" },
    hint: { icon: "💡", color: "var(--mz-callout-tip)" },
    important: { icon: "🔥", color: "var(--mz-callout-warning)" },
    success: { icon: "✅", color: "var(--mz-callout-tip)" },
    check: { icon: "✅", color: "var(--mz-callout-tip)" },
    done: { icon: "✅", color: "var(--mz-callout-tip)" },
    question: { icon: "❓", color: "var(--mz-callout-warning)" },
    help: { icon: "❓", color: "var(--mz-callout-warning)" },
    faq: { icon: "❓", color: "var(--mz-callout-warning)" },
    warning: { icon: "⚠️", color: "var(--mz-callout-warning)" },
    caution: { icon: "⚠️", color: "var(--mz-callout-warning)" },
    attention: { icon: "⚠️", color: "var(--mz-callout-warning)" },
    failure: { icon: "❌", color: "var(--mz-callout-danger)" },
    fail: { icon: "❌", color: "var(--mz-callout-danger)" },
    missing: { icon: "❌", color: "var(--mz-callout-danger)" },
    danger: { icon: "🔴", color: "var(--mz-callout-danger)" },
    error: { icon: "⛔", color: "var(--mz-callout-danger)" },
    bug: { icon: "🐛", color: "var(--mz-callout-danger)" },
    example: { icon: "📖", color: "var(--mz-callout-note)" },
    quote: { icon: "❝", color: "var(--mz-text-muted)" },
    cite: { icon: "❝", color: "var(--mz-text-muted)" },
};

function getCalloutDef(type: string): CalloutDef {
    return CALLOUT_TYPES[type.toLowerCase()] ?? CALLOUT_TYPES.note;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function unescapeHtml(str: string): string {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');
}

function escapeAttr(str: string): string {
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderCodeLinesHtml(lines: string[]): string {
    const sourceLines = lines.length > 0 ? lines : [""];
    return sourceLines
        .map(
            (line, index) =>
                `<span class="mz-rv-code-line" data-line-number="${index + 1}">${escapeHtml(line)}</span>`,
        )
        .join("\n");
}

function resolveImageSrc(
    src: string,
    vaultRoot: string,
    currentFilePath: string,
): string {
    return resolveImageAssetUrl(src, vaultRoot, currentFilePath);
}

// ---------------------------------------------------------------------------
// Shiki code highlighting (post-render)
// ---------------------------------------------------------------------------

function annotateReadingCodeBlockLines(block: HTMLElement): void {
    if (!settingsStore.settings().markdown_code_block_line_numbers) return;
    const lines = block.querySelectorAll<HTMLElement>("pre code > .line");
    lines.forEach((line, index) => {
        line.setAttribute("data-line-number", String(index + 1));
    });
}

export async function highlightCodeBlocks(container: HTMLElement): Promise<void> {
    const { createHighlighter } = await import("shiki");
    const codeBlocks = container.querySelectorAll<HTMLElement>(
        ".mz-rv-code[data-lang]",
    );
    if (codeBlocks.length === 0) return;

    const langs = new Set<string>();
    codeBlocks.forEach((block) => {
        const lang = block.dataset.lang;
        if (lang && lang !== "text" && lang !== "plain") langs.add(lang);
    });
    if (langs.size === 0) return;

    try {
        const highlighter = await createHighlighter({
            themes: ["github-dark", "github-light"],
            langs: [...langs] as any[],
        });
        const shikiTheme = container.closest("#mz-pdf-export-root")
            ? "github-light"
            : "github-dark";

        codeBlocks.forEach((block) => {
            const lang = block.dataset.lang!;
            const codeEl = block.querySelector("code");
            if (!codeEl) return;

            const loadedLangs = highlighter.getLoadedLanguages();
            if (!loadedLangs.includes(lang as any)) return;

            const code = codeEl.textContent || "";
            try {
                const html = highlighter.codeToHtml(code, {
                    lang,
                    theme: shikiTheme,
                });
                const wrapper = block.querySelector("pre")!;
                wrapper.outerHTML = html;
                // Fix Shiki pre styles
                const shikiPre = block.querySelector("pre");
                if (shikiPre) {
                    shikiPre.style.cssText =
                        "margin:0; padding:12px 16px; overflow-x:auto; background:transparent !important; font-size:0.88em; line-height:1.5;";
                }
                annotateReadingCodeBlockLines(block);
            } catch {
                // Keep plain text
            }
        });
    } catch {
        // Shiki loading failed, keep plain code
    }
}

// ---------------------------------------------------------------------------
// Mermaid rendering (post-render)
// ---------------------------------------------------------------------------

export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
    const mermaidBlocks =
        container.querySelectorAll<HTMLElement>(".mz-rv-mermaid");
    if (mermaidBlocks.length === 0) return;

    try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
            startOnLoad: false,
            theme: "dark",
            securityLevel: "strict",
        });

        for (let i = 0; i < mermaidBlocks.length; i++) {
            const block = mermaidBlocks[i];
            const code = block.dataset.mermaid;
            if (!code) continue;

            try {
                const id = `mz-rv-mermaid-${Date.now()}-${i}`;
                const { svg } = await mermaid.render(id, code);
                block.innerHTML = svg;
                block.style.textAlign = "center";
            } catch {
                // Keep original code block on error
            }
        }
    } catch {
        // Mermaid loading failed
    }
}

// ---------------------------------------------------------------------------
// Public convenience wrappers (used by App.tsx)
// ---------------------------------------------------------------------------

export function renderMarkdownPreviewHtml(
    markdown: string,
    vaultRoot: string,
    currentFilePath: string,
): string {
    return markdownToHtml(markdown, {
        vaultRoot,
        currentFilePath,
        footnotes: new Map(),
    });
}

export async function enhanceMarkdownPreviewHtml(
    container: HTMLElement,
): Promise<void> {
    await Promise.all([highlightCodeBlocks(container), renderMermaidBlocks(container)]);
}
