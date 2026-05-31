// ── Plugin bridge type definitions ────────────────────────────────

/** Cursor position used by the Obsidian-compatible editor API */
export interface EditorPosition {
  line: number;
  ch: number;
}

/** Selection range used by the Obsidian-compatible editor API */
export interface EditorSelectionRange {
  anchor: EditorPosition;
  head: EditorPosition;
}

/** Scroll info returned by getScrollInfo() */
export interface ScrollInfo {
  top: number;
  left: number;
  height: number;
  clientHeight: number;
}

/** Obsidian-compatible editor API exposed to plugins via window.__mindzj_plugin_editor_api */
export interface PluginEditorApi {
  cm: unknown; // CodeMirror EditorView — kept as unknown to avoid circular deps
  focus: () => void;
  getSelection: () => string;
  replaceSelection: (text: string) => void;
  somethingSelected: () => boolean;
  getCursor: (which?: "from" | "to") => EditorPosition;
  setCursor: (line: number, ch: number) => void;
  getLine: (line: number) => string;
  lineCount: () => number;
  lastLine: () => number;
  firstLine: () => number;
  replaceRange: (text: string, from: EditorPosition, to?: EditorPosition) => void;
  listSelections: () => EditorSelectionRange[];
  setSelections: (ranges: EditorSelectionRange[]) => void;
  setSelection: (from: EditorPosition, to?: EditorPosition) => void;
  getDoc: () => { getValue: () => string; lineCount: () => number };
  transaction: () => unknown;
  undo: () => boolean;
  redo: () => boolean;
  exec: (command: string) => boolean;
  getValue: () => string;
  setValue: (value: string) => string;
  getRange: (from: EditorPosition, to: EditorPosition) => string;
  getScrollInfo: () => ScrollInfo;
  scrollTo: (x: number | null, y: number | null) => void;
  scrollIntoView: (pos?: EditorPosition) => void;
}

/** TFile-like object returned by the plugin shim */
export interface PluginTFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: { mtime: number; ctime: number; size: number };
  vault: { getName: () => string };
  parent: { path: string; name: string };
}

/** Obsidian-compatible markdown view exposed to plugins via window.__mindzj_markdown_view */
export interface PluginMarkdownView {
  editor: PluginEditorApi;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  editMode: { editor: { cm: unknown } };
  currentMode: { editor: { cm: unknown } };
  sourceMode: { cmEditor: { cm: unknown } };
  leaf: { width: number; containerEl: HTMLElement; view: unknown };
  file: PluginTFile | null;
  getViewType: () => string;
  getMode: () => string;
}

declare global {
  interface Window {
    __mindzj_hotkey_capturing: boolean;
    __mindzj_flush_workspace: ((...args: unknown[]) => unknown) | undefined | null;
    __mindzj_switch_open_tab: ((...args: unknown[]) => unknown) | undefined | null;
    __mindzj_icons: Record<string, string> | undefined | null;
    __mindzj_plugin_cm_extensions: unknown[] | undefined | null;
    __mindzj_plugin_settings_active_tab:
      | { id: string; containerEl: HTMLElement }
      | undefined
      | null;
    __mindzj_loadedPlugins: Array<Record<string, unknown>> | undefined | null;
    __mindzj_plugin_editor_api: PluginEditorApi | null | undefined;
    __mindzj_markdown_view: PluginMarkdownView | null | undefined;
  }
}

export {};
