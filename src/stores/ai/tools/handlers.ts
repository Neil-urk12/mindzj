import { invoke } from "@tauri-apps/api/core";
import { vaultStore, type FileContent } from "../../vault";
import { editorStore, type ViewMode } from "../../editor";
import { settingsStore, type AppSettings } from "../../settings";
import { listPluginCommands, runPluginCommand } from "../../plugins";
import {
  addMindzjNode,
  deleteMindzjNode,
  findMindzjNode,
  mindzjDocumentFromMarkdown,
  updateMindzjNodeText,
} from "../../../utils/mindzjMindmap";
import type { ToolResult, ToolExecutionContext } from "../types";
import { parseJsonObject } from "../types";
import { TOOL_DEFINITIONS } from "./definitions";
import {
  flattenEntries,
  cleanPath,
  isMindmapPath,
  isMarkdownPath,
  ensureMindmapPath,
  defaultMindmapPathForSource,
  firstOutlineTitle,
  uniqueMindmapPath,
  resolveMindmapPath,
  nodeReferenceFromArgs,
  nodeTargetMissingResult,
  nodeNotFoundResult,
  countMindmapNodes,
  readMindmapFile,
  saveMindmapFile,
  readMindmapResult,
  mindmapChangeMessage,
  looksLikeActiveNoteContentRequest,
  isFileAlreadyExistsError,
  looksLikeToolFailureSummary,
  pathRequiredResult,
  enforceCurrentFileContentScope,
  textPathArg,
} from "./mindmap";

// ── Helpers ──────────────────────────────────────────────────────

export function summarizeToolCall(name: string, args: any): string {
  const path = cleanPath(String(args?.path ?? args?.from ?? args?.to ?? ""));
  if (path) return `${name}(${path})`;
  return name;
}

// ── Tool execution ───────────────────────────────────────────────

export async function executeTool(name: string, args: any, context?: ToolExecutionContext): Promise<ToolResult> {
  try {
    switch (name) {
      case "list_notes": {
        return { ok: true, data: flattenEntries(vaultStore.fileTree()).slice(0, 500) };
      }
      case "list_app_commands": {
        return {
          ok: true,
          data: {
            tools: TOOL_DEFINITIONS.map((tool) => tool.function.name),
            plugin_commands: listPluginCommands().map((command) => ({
              id: command.id,
              name: command.name,
            })),
          },
        };
      }
      case "get_active_note": {
        const active = vaultStore.activeFile();
        return {
          ok: true,
          data: {
            path: active?.path ?? null,
            view_mode: editorStore.getViewModeForFile(active?.path ?? null),
          },
        };
      }
      case "read_note": {
        const path = cleanPath(String(args.path ?? ""));
        if (!path) return pathRequiredResult(name);
        const file = await invoke<FileContent>("read_file", { relativePath: path });
        return { ok: true, data: { path: file.path, content: file.content } };
      }
      case "list_mindmaps": {
        return {
          ok: true,
          data: flattenEntries(vaultStore.fileTree())
            .filter((entry) => !entry.is_dir && isMindmapPath(entry.path))
            .slice(0, 500),
        };
      }
      case "read_mindmap": {
        const resolved = resolveMindmapPath(name, String(args.path ?? ""), context);
        if (!resolved.ok) return resolved.result;
        const document = await readMindmapFile(resolved.path);
        return readMindmapResult(resolved.path, document, typeof args.query === "string" ? args.query : undefined);
      }
      case "create_mindmap_from_markdown": {
        const activePath = context?.activePath ?? vaultStore.activeFile()?.path ?? null;
        const sourcePath = cleanPath(String(args.source_path ?? "")) || (isMarkdownPath(activePath) ? activePath! : "");
        if (!sourcePath) {
          return { ok: false, message: "create_mindmap_from_markdown requires source_path or an active Markdown file." };
        }
        if (context?.restrictToActiveFile && !context.hasExplicitPath && sourcePath !== activePath) {
          return {
            ok: false,
            message: `No explicit file path was provided. Refusing to read ${sourcePath}; only ${activePath ?? "(none)"} may be used.`,
          };
        }
        const targetPath = ensureMindmapPath(String(args.target_path ?? "")) || defaultMindmapPathForSource(sourcePath);
        const source = await invoke<FileContent>("read_file", { relativePath: sourcePath });
        const document = mindzjDocumentFromMarkdown(source.content, {
          rootTitle: typeof args.root_title === "string" ? args.root_title : sourcePath.split("/").pop()?.replace(/\.[^.]+$/, ""),
        });
        const file = await saveMindmapFile(targetPath, document, true);
        return {
          ok: true,
          message: `Created ${file.path} from ${sourcePath}`,
          data: { path: file.path, source_path: sourcePath, node_count: countMindmapNodes(document) },
        };
      }
      case "create_mindmap": {
        const outline = String(args.outline_markdown ?? "").trim();
        if (!outline) return { ok: false, message: "create_mindmap requires outline_markdown." };
        const requestedPath = ensureMindmapPath(String(args.path ?? ""));
        const activePath = context?.activePath ?? vaultStore.activeFile()?.path ?? null;
        const targetPath = requestedPath || uniqueMindmapPath(firstOutlineTitle(outline, typeof args.root_title === "string" ? args.root_title : undefined));
        if (context?.restrictToActiveFile && !context.hasExplicitPath && requestedPath && requestedPath !== activePath) {
          return {
            ok: false,
            message: `No explicit file path was provided. Refusing to replace ${requestedPath}; omit path to create a new mind map automatically.`,
          };
        }
        const document = mindzjDocumentFromMarkdown(outline, {
          rootTitle: typeof args.root_title === "string" ? args.root_title : undefined,
        });
        const file = await saveMindmapFile(targetPath, document, true);
        return {
          ok: true,
          message: `Created ${file.path}`,
          data: { path: file.path, node_count: countMindmapNodes(document) },
        };
      }
      case "add_mindmap_node": {
        const resolved = resolveMindmapPath(name, String(args.path ?? ""), context);
        if (!resolved.ok) return resolved.result;
        const text = String(args.text ?? "").trim();
        if (!text) return { ok: false, message: "add_mindmap_node requires text." };
        const document = await readMindmapFile(resolved.path);
        const match = addMindzjNode(document, {
          text,
          parentId: typeof args.parent_id === "string" ? args.parent_id : null,
          parentTextPath: textPathArg(args.parent_text_path),
          parentText: typeof args.parent_text === "string" ? args.parent_text : null,
          index: typeof args.index === "number" ? args.index : null,
          side: typeof args.side === "string" ? args.side : null,
        });
        await saveMindmapFile(resolved.path, document);
        return { ok: true, message: mindmapChangeMessage("Added", resolved.path, match), data: { id: match.node.id, path: match.path } };
      }
      case "update_mindmap_node": {
        const resolved = resolveMindmapPath(name, String(args.path ?? ""), context);
        if (!resolved.ok) return resolved.result;
        const text = String(args.text ?? "").trim();
        if (!text) return { ok: false, message: "update_mindmap_node requires text." };
        const reference = nodeReferenceFromArgs(args);
        if (!reference.nodeId && !reference.textPath && !reference.text) return nodeTargetMissingResult(name);
        const document = await readMindmapFile(resolved.path);
        const match = findMindzjNode(document, reference);
        if (!match) return nodeNotFoundResult(name);
        const updated = updateMindzjNodeText(match, text);
        await saveMindmapFile(resolved.path, document);
        return { ok: true, message: mindmapChangeMessage("Updated", resolved.path, updated), data: { id: updated.node.id, path: updated.path } };
      }
      case "delete_mindmap_node": {
        const resolved = resolveMindmapPath(name, String(args.path ?? ""), context);
        if (!resolved.ok) return resolved.result;
        const reference = nodeReferenceFromArgs(args);
        if (!reference.nodeId && !reference.textPath && !reference.text) return nodeTargetMissingResult(name);
        const document = await readMindmapFile(resolved.path);
        const match = findMindzjNode(document, reference);
        if (!match) return nodeNotFoundResult(name);
        const deleted = deleteMindzjNode(document, match, !!args.allow_delete_root);
        await saveMindmapFile(resolved.path, document);
        return { ok: true, message: mindmapChangeMessage("Deleted", resolved.path, deleted), data: { id: deleted.node.id, path: deleted.path } };
      }
      case "create_note": {
        const scoped = enforceCurrentFileContentScope(name, String(args.path ?? ""), context);
        if (!scoped.ok) return scoped.result;
        const path = scoped.path;
        const content = String(args.content ?? "");
        try {
          const file = await vaultStore.createFile(path, content);
          await vaultStore.openFile(file.path);
          return { ok: true, message: `Created ${file.path}`, data: file };
        } catch (error: any) {
          if (!isFileAlreadyExistsError(error)) throw error;
          const file = await vaultStore.saveFile(path, content);
          await vaultStore.openFile(file.path);
          return { ok: true, message: `Updated existing ${file.path}`, data: file };
        }
      }
      case "update_note": {
        const scoped = enforceCurrentFileContentScope(name, String(args.path ?? ""), context);
        if (!scoped.ok) return scoped.result;
        const path = scoped.path;
        const content = String(args.content ?? "");
        const file = await vaultStore.saveFile(path, content);
        return { ok: true, message: `Updated ${file.path}`, data: file };
      }
      case "append_note": {
        const scoped = enforceCurrentFileContentScope(name, String(args.path ?? ""), context);
        if (!scoped.ok) return scoped.result;
        const path = scoped.path;
        const content = String(args.content ?? "");
        const file = await invoke<FileContent>("read_file", { relativePath: path });
        const next = file.content.endsWith("\n") || content.startsWith("\n")
          ? `${file.content}${content}`
          : `${file.content}\n${content}`;
        const saved = await vaultStore.saveFile(path, next);
        return { ok: true, message: `Appended to ${saved.path}`, data: saved };
      }
      case "delete_note": {
        const scoped = enforceCurrentFileContentScope(name, String(args.path ?? ""), context);
        if (!scoped.ok) return scoped.result;
        const path = scoped.path;
        await vaultStore.deleteFile(path);
        return { ok: true, message: `Deleted ${path}` };
      }
      case "delete_folder": {
        const scoped = enforceCurrentFileContentScope(name, String(args.path ?? ""), context);
        if (!scoped.ok) return scoped.result;
        const path = scoped.path;
        await vaultStore.deleteDir(path);
        return { ok: true, message: `Deleted folder ${path}` };
      }
      case "rename_note": {
        if (context?.restrictToActiveFile && !context.hasExplicitPath) {
          return {
            ok: false,
            message: "No explicit file path was provided. This AI panel may only change the current note content.",
          };
        }
        const from = cleanPath(String(args.from ?? ""));
        const to = cleanPath(String(args.to ?? ""));
        const file = await invoke<FileContent>("rename_file", { from, to });
        vaultStore.renameFilePath(from, file.path);
        await vaultStore.refreshFileTree();
        return { ok: true, message: `Renamed ${from} to ${file.path}`, data: file };
      }
      case "search_notes": {
        const query = String(args.query ?? "");
        const results = await invoke("search_vault", {
          query,
          limit: 20,
          extensionFilter: null,
          pathFilter: null,
        });
        return { ok: true, data: results };
      }
      case "get_backlinks": {
        const path = cleanPath(String(args.path ?? ""));
        if (!path) return pathRequiredResult(name);
        const links = await invoke("get_backlinks", { relativePath: path });
        return { ok: true, data: links };
      }
      case "get_forward_links": {
        const path = cleanPath(String(args.path ?? ""));
        if (!path) return pathRequiredResult(name);
        const links = await invoke("get_forward_links", { relativePath: path });
        return { ok: true, data: links };
      }
      case "get_graph_data": {
        const graph = await invoke("get_graph_data");
        return { ok: true, data: graph };
      }
      case "open_note": {
        const path = cleanPath(String(args.path ?? ""));
        if (!path) return pathRequiredResult(name);
        const file = await vaultStore.openFile(path);
        return { ok: true, message: `Opened ${file.path}`, data: { path: file.path } };
      }
      case "create_folder": {
        const scoped = enforceCurrentFileContentScope(name, String(args.path ?? ""), context);
        if (!scoped.ok) return scoped.result;
        const path = scoped.path;
        await vaultStore.createDir(path);
        return { ok: true, message: `Created folder ${path}` };
      }
      case "refresh_file_tree": {
        await vaultStore.refreshFileTree();
        return { ok: true, message: "Refreshed file tree" };
      }
      case "set_view_mode": {
        const mode = String(args.mode ?? "live-preview") as ViewMode;
        editorStore.setViewMode(mode);
        return { ok: true, message: `View mode set to ${mode}` };
      }
      case "set_default_view_mode": {
        const mode = String(args.mode ?? "live-preview");
        if (!["source", "live-preview", "reading"].includes(mode)) {
          return { ok: false, message: `Invalid default view mode: ${mode}` };
        }
        await settingsStore.updateSetting("default_view_mode", mode as ViewMode);
        return { ok: true, message: `Default view mode set to ${mode}` };
      }
      case "get_settings": {
        return { ok: true, data: settingsStore.settings() };
      }
      case "update_setting": {
        const key = String(args.key ?? "") as keyof AppSettings;
        if (!(key in settingsStore.settings())) {
          return { ok: false, message: `Unknown setting: ${String(key)}` };
        }
        await settingsStore.updateSetting(key, args.value as AppSettings[typeof key]);
        return { ok: true, message: `Updated setting ${String(key)}` };
      }
      case "run_plugin_command": {
        const id = String(args.id ?? "");
        const exists = listPluginCommands().some((command) => command.id === id);
        if (!exists) return { ok: false, message: `Unknown plugin command: ${id}` };
        const ok = await runPluginCommand(id);
        return { ok, message: ok ? `Ran ${id}` : `Command failed: ${id}` };
      }
      default:
        return { ok: false, message: `Unknown tool: ${name}` };
    }
  } catch (error: any) {
    return { ok: false, message: error?.message || String(error) };
  }
}

// ── Chat loop helpers ────────────────────────────────────────────

export async function appendNaturalResponseToActiveNote(
  instruction: string,
  content: string,
  context?: ToolExecutionContext,
): Promise<string | null> {
  const trimmed = content.trim();
  if (!trimmed || !context?.restrictToActiveFile || context.hasExplicitPath || !context.activePath) {
    return null;
  }
  if (!looksLikeActiveNoteContentRequest(instruction)) return null;
  if (looksLikeToolFailureSummary(trimmed)) return null;

  // Some local models ignore function calling for simple generation tasks.
  // Treat their final text as the content to record in the active Markdown note.
  const result = await executeTool("append_note", {
    path: context.activePath,
    content: trimmed,
  }, context);
  return result.message || (result.ok ? `Appended to ${context.activePath}` : null);
}

export async function runJsonFallback(content: string, context?: ToolExecutionContext): Promise<string | null> {
  const parsed = parseJsonObject(content);
  if (!parsed) return null;
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [parsed];
  const results: ToolResult[] = [];
  for (const action of actions) {
    if (!action?.tool) continue;
    results.push(await executeTool(action.tool, action.arguments ?? {}, context));
  }
  if (!results.length) return null;
  return results.map((result) => result.message || JSON.stringify(result.data ?? result)).join("\n");
}
