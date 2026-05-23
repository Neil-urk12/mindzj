/**
 * Code syntax highlighting utilities for fenced code blocks in the live preview.
 *
 * Pure functions that operate on CM6 decoration arrays. Zero shared state
 * with the rest of livePreview.ts.
 */

import { Decoration, type EditorView } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { settingsStore } from "../../../stores/settings";

// ---------------------------------------------------------------------------
// Code fence + content line decorations
// ---------------------------------------------------------------------------

export const codeFenceOpenDeco = Decoration.line({ class: "mz-lp-code-fence-open" });
export const codeFenceCloseDeco = Decoration.line({ class: "mz-lp-code-fence-close" });
export const codeContentDeco = Decoration.line({ class: "mz-lp-code-content-line" });
export function codeContentLineDeco(lineNumber: number): Decoration {
    if (!settingsStore.settings().markdown_code_block_line_numbers) {
        return codeContentDeco;
    }
    return Decoration.line({
        class: "mz-lp-code-content-line",
        attributes: { "data-code-line-number": String(lineNumber) },
    });
}

// ---------------------------------------------------------------------------
// Code token decorations
// ---------------------------------------------------------------------------

export const codeKeywordDeco = Decoration.mark({ class: "mz-lp-code-token-keyword" });
export const codeStringDeco = Decoration.mark({ class: "mz-lp-code-token-string" });
export const codeNumberDeco = Decoration.mark({ class: "mz-lp-code-token-number" });
export const codeCommentDeco = Decoration.mark({ class: "mz-lp-code-token-comment" });
export const codeFunctionDeco = Decoration.mark({ class: "mz-lp-code-token-function" });
export const codeTypeDeco = Decoration.mark({ class: "mz-lp-code-token-type" });
export const codeVariableDeco = Decoration.mark({ class: "mz-lp-code-token-variable" });

// ---------------------------------------------------------------------------
// Token span tracking
// ---------------------------------------------------------------------------

export type TokenSpan = { from: number; to: number };

function occupiedByToken(occupied: TokenSpan[], from: number, to: number): boolean {
    return occupied.some((span) => from < span.to && to > span.from);
}

function addCodeToken(
    decorations: Range<Decoration>[],
    occupied: TokenSpan[],
    lineFrom: number,
    start: number,
    end: number,
    deco: Decoration,
) {
    if (start >= end) return;
    const from = lineFrom + start;
    const to = lineFrom + end;
    if (occupiedByToken(occupied, from, to)) return;
    occupied.push({ from, to });
    decorations.push(deco.range(from, to));
}

function addRegexTokens(
    text: string,
    lineFrom: number,
    regex: RegExp,
    deco: Decoration,
    decorations: Range<Decoration>[],
    occupied: TokenSpan[],
    groupIndex = 0,
) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        const token = match[groupIndex] ?? match[0];
        if (!token) continue;
        const offset = groupIndex === 0 ? 0 : match[0].indexOf(token);
        if (offset < 0) continue;
        addCodeToken(
            decorations,
            occupied,
            lineFrom,
            match.index + offset,
            match.index + offset + token.length,
            deco,
        );
    }
}

function addKeywordTokens(
    text: string,
    lineFrom: number,
    words: string[],
    deco: Decoration,
    decorations: Range<Decoration>[],
    occupied: TokenSpan[],
) {
    if (words.length === 0) return;
    const escaped = words
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
    addRegexTokens(
        text,
        lineFrom,
        new RegExp(`\\b(?:${escaped})\\b`, "g"),
        deco,
        decorations,
        occupied,
    );
}

// ---------------------------------------------------------------------------
// Language data tables
// ---------------------------------------------------------------------------

const LANG_ALIASES: Record<string, string> = {
    py: "python",
    python3: "python",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    rs: "rust",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    ps1: "powershell",
    pwsh: "powershell",
    yml: "yaml",
    htm: "html",
    cxx: "cpp",
    cc: "cpp",
    hpp: "cpp",
    cs: "csharp",
};

const CODE_KEYWORDS: Record<string, string[]> = {
    python: [
        "and",
        "as",
        "assert",
        "async",
        "await",
        "break",
        "class",
        "continue",
        "def",
        "del",
        "elif",
        "else",
        "except",
        "False",
        "finally",
        "for",
        "from",
        "global",
        "if",
        "import",
        "in",
        "is",
        "lambda",
        "None",
        "nonlocal",
        "not",
        "or",
        "pass",
        "raise",
        "return",
        "True",
        "try",
        "while",
        "with",
        "yield",
    ],
    javascript: [
        "async",
        "await",
        "break",
        "case",
        "catch",
        "class",
        "const",
        "continue",
        "debugger",
        "default",
        "delete",
        "do",
        "else",
        "export",
        "extends",
        "false",
        "finally",
        "for",
        "from",
        "function",
        "if",
        "import",
        "in",
        "instanceof",
        "let",
        "new",
        "null",
        "of",
        "return",
        "super",
        "switch",
        "this",
        "throw",
        "true",
        "try",
        "typeof",
        "undefined",
        "var",
        "void",
        "while",
        "yield",
    ],
    typescript: [
        "abstract",
        "as",
        "async",
        "await",
        "break",
        "case",
        "catch",
        "class",
        "const",
        "continue",
        "declare",
        "default",
        "else",
        "enum",
        "export",
        "extends",
        "false",
        "finally",
        "for",
        "from",
        "function",
        "if",
        "implements",
        "import",
        "interface",
        "let",
        "namespace",
        "new",
        "null",
        "of",
        "private",
        "protected",
        "public",
        "readonly",
        "return",
        "static",
        "super",
        "switch",
        "this",
        "throw",
        "true",
        "try",
        "type",
        "typeof",
        "undefined",
        "var",
        "while",
    ],
    rust: [
        "as",
        "async",
        "await",
        "break",
        "const",
        "continue",
        "crate",
        "dyn",
        "else",
        "enum",
        "extern",
        "false",
        "fn",
        "for",
        "if",
        "impl",
        "in",
        "let",
        "loop",
        "match",
        "mod",
        "move",
        "mut",
        "pub",
        "ref",
        "return",
        "self",
        "Self",
        "static",
        "struct",
        "super",
        "trait",
        "true",
        "type",
        "unsafe",
        "use",
        "where",
        "while",
    ],
    go: [
        "break",
        "case",
        "chan",
        "const",
        "continue",
        "default",
        "defer",
        "else",
        "fallthrough",
        "for",
        "func",
        "go",
        "goto",
        "if",
        "import",
        "interface",
        "map",
        "package",
        "range",
        "return",
        "select",
        "struct",
        "switch",
        "type",
        "var",
    ],
    java: [
        "abstract",
        "boolean",
        "break",
        "case",
        "catch",
        "class",
        "const",
        "continue",
        "default",
        "do",
        "else",
        "enum",
        "extends",
        "false",
        "final",
        "finally",
        "for",
        "if",
        "implements",
        "import",
        "instanceof",
        "interface",
        "new",
        "null",
        "package",
        "private",
        "protected",
        "public",
        "return",
        "static",
        "super",
        "switch",
        "this",
        "throw",
        "throws",
        "true",
        "try",
        "void",
        "while",
    ],
    c: [
        "auto",
        "break",
        "case",
        "char",
        "const",
        "continue",
        "default",
        "do",
        "double",
        "else",
        "enum",
        "extern",
        "float",
        "for",
        "goto",
        "if",
        "inline",
        "int",
        "long",
        "register",
        "return",
        "short",
        "signed",
        "sizeof",
        "static",
        "struct",
        "switch",
        "typedef",
        "union",
        "unsigned",
        "void",
        "volatile",
        "while",
    ],
    cpp: [
        "alignas",
        "auto",
        "break",
        "case",
        "catch",
        "class",
        "const",
        "constexpr",
        "continue",
        "default",
        "delete",
        "do",
        "else",
        "enum",
        "explicit",
        "export",
        "false",
        "for",
        "friend",
        "if",
        "inline",
        "namespace",
        "new",
        "nullptr",
        "operator",
        "private",
        "protected",
        "public",
        "return",
        "static",
        "struct",
        "switch",
        "template",
        "this",
        "throw",
        "true",
        "try",
        "typedef",
        "typename",
        "using",
        "virtual",
        "void",
        "while",
    ],
    json: ["false", "null", "true"],
    bash: [
        "case",
        "do",
        "done",
        "elif",
        "else",
        "esac",
        "fi",
        "for",
        "function",
        "if",
        "in",
        "then",
        "until",
        "while",
    ],
    powershell: [
        "begin",
        "break",
        "catch",
        "class",
        "continue",
        "data",
        "do",
        "dynamicparam",
        "else",
        "elseif",
        "end",
        "exit",
        "filter",
        "finally",
        "for",
        "foreach",
        "from",
        "function",
        "if",
        "in",
        "param",
        "process",
        "return",
        "switch",
        "throw",
        "trap",
        "try",
        "until",
        "using",
        "while",
    ],
    sql: [
        "and",
        "as",
        "by",
        "case",
        "create",
        "delete",
        "distinct",
        "drop",
        "else",
        "end",
        "from",
        "group",
        "having",
        "in",
        "insert",
        "into",
        "is",
        "join",
        "left",
        "like",
        "limit",
        "not",
        "null",
        "on",
        "or",
        "order",
        "right",
        "select",
        "set",
        "then",
        "update",
        "values",
        "when",
        "where",
    ],
};

const CODE_TYPES: Record<string, string[]> = {
    typescript: ["any", "bigint", "boolean", "never", "number", "string", "unknown", "void"],
    javascript: ["Array", "Boolean", "Date", "Map", "Number", "Object", "Promise", "Set", "String"],
    python: ["bool", "bytes", "dict", "float", "int", "list", "set", "str", "tuple"],
    rust: ["bool", "char", "f32", "f64", "i32", "i64", "isize", "Result", "String", "u32", "u64", "usize", "Vec"],
    go: ["bool", "byte", "error", "float32", "float64", "int", "int64", "rune", "string", "uint", "uint64"],
    java: ["boolean", "byte", "char", "double", "float", "int", "long", "String", "void"],
    c: ["bool", "char", "double", "float", "int", "long", "short", "size_t", "void"],
    cpp: ["bool", "char", "double", "float", "int", "long", "short", "size_t", "std", "string", "void"],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function normalizeFenceLanguage(info: string): string {
    const raw = info.trim().split(/\s+/)[0] ?? "";
    const cleaned = raw.replace(/^\{?\.?/, "").replace(/\}?$/, "").toLowerCase();
    return LANG_ALIASES[cleaned] ?? cleaned;
}

export function applyFencedCodeSyntax(
    text: string,
    lineFrom: number,
    lang: string,
    decorations: Range<Decoration>[],
) {
    if (!lang || lang === "text" || lang === "plain" || lang === "plaintext") {
        return;
    }

    const occupied: TokenSpan[] = [];
    if (lang === "html" || lang === "xml") {
        addRegexTokens(text, lineFrom, /<!--.*?-->/g, codeCommentDeco, decorations, occupied);
        addRegexTokens(text, lineFrom, /<\/?([A-Za-z][\w:-]*)/g, codeTypeDeco, decorations, occupied, 1);
        addRegexTokens(text, lineFrom, /\s([A-Za-z_:][\w:.-]*)=/g, codeVariableDeco, decorations, occupied, 1);
        addRegexTokens(text, lineFrom, /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, codeStringDeco, decorations, occupied);
        return;
    }

    if (lang === "css" || lang === "scss" || lang === "sass" || lang === "less") {
        addRegexTokens(text, lineFrom, /\/\*.*?\*\//g, codeCommentDeco, decorations, occupied);
        addRegexTokens(text, lineFrom, /(--?[\w-]+)(?=\s*:)/g, codeVariableDeco, decorations, occupied, 1);
        addRegexTokens(text, lineFrom, /([.#]?[A-Za-z_-][\w-]*)(?=\s*\{)/g, codeTypeDeco, decorations, occupied, 1);
        addRegexTokens(text, lineFrom, /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, codeStringDeco, decorations, occupied);
        addRegexTokens(text, lineFrom, /\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\b/gi, codeNumberDeco, decorations, occupied);
        return;
    }

    if (lang === "python" || lang === "bash" || lang === "powershell" || lang === "yaml") {
        addRegexTokens(text, lineFrom, /#.*/g, codeCommentDeco, decorations, occupied);
    } else if (lang === "sql") {
        addRegexTokens(text, lineFrom, /--.*/g, codeCommentDeco, decorations, occupied);
    } else {
        addRegexTokens(text, lineFrom, /\/\/.*|\/\*.*?\*\//g, codeCommentDeco, decorations, occupied);
    }

    addRegexTokens(
        text,
        lineFrom,
        /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g,
        codeStringDeco,
        decorations,
        occupied,
    );

    if (lang === "json") {
        addRegexTokens(text, lineFrom, /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/g, codeVariableDeco, decorations, occupied, 1);
    }

    addKeywordTokens(text, lineFrom, CODE_KEYWORDS[lang] ?? [], codeKeywordDeco, decorations, occupied);
    addKeywordTokens(text, lineFrom, CODE_TYPES[lang] ?? [], codeTypeDeco, decorations, occupied);
    addRegexTokens(text, lineFrom, /\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, codeNumberDeco, decorations, occupied);

    addRegexTokens(text, lineFrom, /\b(?:def|function|fn|func)\s+([A-Za-z_$][\w$]*)/g, codeFunctionDeco, decorations, occupied, 1);
    addRegexTokens(text, lineFrom, /\b(?:class|struct|interface|enum|type)\s+([A-Za-z_$][\w$]*)/g, codeTypeDeco, decorations, occupied, 1);
    addRegexTokens(text, lineFrom, /\b([A-Za-z_$][\w$]*)\s*(?=\()/g, codeFunctionDeco, decorations, occupied, 1);
}
