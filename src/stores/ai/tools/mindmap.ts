import { invoke } from "@tauri-apps/api/core";
import { vaultStore, type FileContent, type VaultEntry } from "../../vault";
import { updatePluginViewsForFile } from "../../plugins";
import {
  flattenMindzjNodes,
  parseMindzjDocument,
  serializeMindzjDocument,
  summarizeMindzjDocument,
  type MindzjDocument,
  type MindzjNodeMatch,
  type MindzjTextPathInput,
} from "../../../utils/mindzjMindmap";
import type { ToolResult, ToolExecutionContext } from "../types";

// ── Path helpers ────────────────────────────────────────────────

export function flattenEntries(entries: VaultEntry[], result: Array<{ path: string; name: string; is_dir: boolean }> = []) {
  for (const entry of entries) {
    result.push({
      path: entry.relative_path,
      name: entry.name,
      is_dir: entry.is_dir,
    });
    if (entry.children) flattenEntries(entry.children, result);
  }
  return result;
}

export function cleanPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

export function isMindmapPath(path: string | null | undefined): boolean {
  return !!path && /\.mindzj$/i.test(path.trim());
}

export function isMarkdownPath(path: string | null | undefined): boolean {
  return !!path && /\.md$/i.test(path.trim());
}

export function ensureMindmapPath(path: string): string {
  const clean = cleanPath(path);
  if (!clean) return "";
  return /\.mindzj$/i.test(clean) ? clean : `${clean.replace(/\.[^/.]+$/, "")}.mindzj`;
}

export function defaultMindmapPathForSource(sourcePath: string): string {
  return ensureMindmapPath(sourcePath.replace(/\.[^/.]+$/, ""));
}

export function sanitizeMindmapFileName(value: string): string {
  const cleaned = value
    .replace(/[#*_`~[\]()]/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48)
    .trim();
  return cleaned || "MindZJMap";
}

export function firstOutlineTitle(outline: string, fallback?: string): string {
  for (const rawLine of outline.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    return sanitizeMindmapFileName(line.replace(/^#{1,6}\s+/, "").replace(/^(?:[-*+]|\d+[.)])\s+/, ""));
  }
  return sanitizeMindmapFileName(fallback || "MindZJMap");
}

export function uniqueMindmapPath(baseName: string): string {
  const existing = new Set(
    flattenEntries(vaultStore.fileTree())
      .filter((entry) => !entry.is_dir)
      .map((entry) => entry.path.toLowerCase()),
  );
  const base = sanitizeMindmapFileName(baseName);
  let candidate = `${base}.mindzj`;
  let suffix = 1;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${base} ${suffix}.mindzj`;
    suffix += 1;
  }
  return candidate;
}
// ── Tool result helpers ─────────────────────────────────────────

export function mindmapPathRequiredResult(toolName: string): ToolResult {
  return {
    ok: false,
    message: `${toolName} requires a .mindzj path or an active .mindzj file.`,
  };
}

export function resolveMindmapPath(
  toolName: string,
  rawPath: string | null | undefined,
  context?: ToolExecutionContext,
): { ok: true; path: string } | { ok: false; result: ToolResult } {
  const requested = ensureMindmapPath(String(rawPath ?? ""));
  const activePath = context?.activePath ?? vaultStore.activeFile()?.path ?? null;
  const fallback = isMindmapPath(activePath) ? activePath! : "";
  const path = requested || fallback;
  if (!path) return { ok: false, result: mindmapPathRequiredResult(toolName) };
  if (!isMindmapPath(path)) {
    return { ok: false, result: { ok: false, message: `${path} is not a .mindzj file.` } };
  }
  if (context?.restrictToActiveFile && !context.hasExplicitPath && requested && requested !== activePath) {
    return {
      ok: false,
      result: {
        ok: false,
        message: `No explicit file path was provided. Refusing to modify ${requested}; only ${activePath ?? "(none)"} may be changed.`,
      },
    };
  }
  return { ok: true, path };
}

export function textPathArg(value: unknown): MindzjTextPathInput {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") return value;
  return null;
}

export function nodeReferenceFromArgs(args: any): { nodeId?: string | null; textPath?: MindzjTextPathInput; text?: string | null } {
  return {
    nodeId: typeof args.node_id === "string" ? args.node_id : null,
    textPath: textPathArg(args.text_path),
    text: typeof args.current_text === "string" ? args.current_text : null,
  };
}

export function nodeTargetMissingResult(toolName: string): ToolResult {
  return {
    ok: false,
    message: `${toolName} requires node_id, text_path, or unique current_text.`,
  };
}

export function nodeNotFoundResult(toolName: string): ToolResult {
  return {
    ok: false,
    message: `${toolName} could not find a unique matching node. Use read_mindmap first and retry with node_id.`,
  };
}

export function countMindmapNodes(document: MindzjDocument): number {
  return flattenMindzjNodes(document).length;
}

export async function readMindmapFile(path: string): Promise<MindzjDocument> {
  const file = await invoke<FileContent>("read_file", { relativePath: path });
  return parseMindzjDocument(file.content);
}

export async function saveMindmapFile(path: string, document: MindzjDocument, openAfterSave = false): Promise<FileContent> {
  const content = serializeMindzjDocument(document);
  let file: FileContent;
  try {
    file = await vaultStore.createFile(path, content);
  } catch (error: any) {
    if (!isFileAlreadyExistsError(error)) throw error;
    file = await vaultStore.saveFile(path, content);
  }
  await updatePluginViewsForFile(file.path, content, true);
  if (openAfterSave) await vaultStore.openFile(file.path);
  return file;
}

export function readMindmapResult(path: string, document: MindzjDocument, query?: string): ToolResult {
  const trimmedQuery = query?.trim().toLowerCase() ?? "";
  const allNodes = flattenMindzjNodes(document);
  const matches = trimmedQuery
    ? allNodes
        .filter((match) => match.node.text.toLowerCase().includes(trimmedQuery))
        .slice(0, 80)
        .map((match) => ({
          id: match.node.id,
          text: match.node.text,
          path: match.path,
          side: match.node.side ?? null,
        }))
    : [];
  return {
    ok: true,
    data: {
      path,
      node_count: allNodes.length,
      root_count: document.rootNodes.length,
      outline: summarizeMindzjDocument(document),
      ...(trimmedQuery ? { matches } : {}),
    },
  };
}

export function mindmapChangeMessage(action: string, path: string, match: MindzjNodeMatch): string {
  return `${action} ${match.path.join(" > ")} in ${path}`;
}

// ── Tool execution context helpers ──────────────────────────────

export function instructionMentionsExplicitPath(instruction: string): boolean {
  const text = instruction.trim();
  if (!text) return false;
  return /\.(?:md|mindzj)\b/i.test(text)
    || /\[\[[^\]]+\]\]/.test(text)
    || /(?:^|[\s"'`])[\w\u4e00-\u9fff ._-]+\/[\w\u4e00-\u9fff ./_-]+(?:$|[\s"'`])/u.test(text);
}

export function buildToolContext(instruction: string, options?: { restrictToActiveFile?: boolean }): ToolExecutionContext {
  return {
    restrictToActiveFile: !!options?.restrictToActiveFile,
    activePath: vaultStore.activeFile()?.path ?? null,
    hasExplicitPath: instructionMentionsExplicitPath(instruction),
  };
}

export function looksLikeActiveNoteContentRequest(instruction: string): boolean {
  const text = instruction.trim().toLowerCase();
  if (!text) return false;

  const explicitWrite = /(写入|录入|记入|记录|保存|加入|添加|追加|插入|放到|放入|粘贴|输出到|写进|写到|append|insert|add|write|save|paste)/iu;
  const generatedContent = /(翻译|译成|总结|摘要|概括|改写|润色|扩写|缩写|整理|生成|起草|撰写|写一|写个|写成|列出|提取|转换为|转成|translate|summari[sz]e|rewrite|polish|draft|compose|generate|extract|convert)/iu;
  const plainQuestion = /^(什么|为什么|怎么|如何|请问|能否|可以|是否|哪|who|what|why|how|can|could|should|is|are)\b/iu;

  if (explicitWrite.test(text)) return true;
  if (generatedContent.test(text) && !plainQuestion.test(text)) return true;
  return false;
}

export function isFileAlreadyExistsError(error: any): boolean {
  const text = [
    error?.code,
    error?.message,
    String(error ?? ""),
  ].filter(Boolean).join(" ");
  return /FILE_ALREADY_EXISTS|File already exists/i.test(text);
}

export function looksLikeToolFailureSummary(content: string): boolean {
  const firstChunk = content.trim().slice(0, 1200).toLowerCase();
  if (!firstChunk) return false;
  const hasFailureLanguage = /(access denied|permission denied|file not found|failed|error|issue|cannot|can't|refusing|not something i can|权限|拒绝|失败|错误|无法|不能)/i.test(firstChunk);
  const hasReportShape = /(summary|what i attempted|recommended solution|option a|option b|issue|problem|attempted)/i.test(firstChunk);
  return hasFailureLanguage && hasReportShape;
}

export function pathRequiredResult(toolName: string): ToolResult {
  return {
    ok: false,
    message: `${toolName} requires a vault-relative path.`,
  };
}

export function enforceCurrentFileContentScope(
  toolName: string,
  rawPath: string,
  context?: ToolExecutionContext,
): { ok: true; path: string } | { ok: false; result: ToolResult } {
  const path = cleanPath(rawPath);
  if (!context?.restrictToActiveFile) {
    return path ? { ok: true, path } : { ok: false, result: pathRequiredResult(toolName) };
  }
  if (context.hasExplicitPath) {
    return path ? { ok: true, path } : { ok: false, result: pathRequiredResult(toolName) };
  }

  if (toolName !== "create_note" && toolName !== "update_note" && toolName !== "append_note") {
    return {
      ok: false,
      result: {
        ok: false,
        message: "No explicit file path was provided. This AI panel may only change the current note content.",
      },
    };
  }

  if (!context.activePath) {
    return {
      ok: false,
      result: {
        ok: false,
        message: "No active note is available to modify.",
      },
    };
  }

  if (!path) return { ok: true, path: context.activePath };
  if (path !== context.activePath) {
    return {
      ok: false,
      result: {
        ok: false,
        message: `No explicit file path was provided. Refusing to modify ${path}; only ${context.activePath} may be changed.`,
      },
    };
  }
  return { ok: true, path };
}
