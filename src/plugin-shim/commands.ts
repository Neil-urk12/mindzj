// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { PluginEditorApi, PluginMarkdownView } from "../types/global";
interface PluginCommand {
    id: string;
    name: string;
    callback?: () => void | Promise<void>;
    editorCallback?: (editor: any, view: any) => void | Promise<void>;
    hotkeys?: Array<{ modifiers?: string[]; key?: string }>;
    icon?: string;
    pluginId: string;
}
export type { PluginCommand };

type CommandEntry = {
    id: string;
    name: string;
    icon?: string;
    hotkeys?: Array<{ modifiers?: string[]; key?: string }>;
    callback?: () => void | Promise<void>;
    editorCallback?: (editor: any, view: any) => void | Promise<void>;
};
export type { CommandEntry };

// ---------------------------------------------------------------------------
// Plugin Command Registry
// ---------------------------------------------------------------------------

const pluginCommandRegistry = new Map<string, PluginCommand>();
export { pluginCommandRegistry };

// ---------------------------------------------------------------------------
// Editor compat helpers
// ---------------------------------------------------------------------------

function getCurrentEditorCompat(): PluginEditorApi | null {
    return window.__mindzj_plugin_editor_api ?? null;
}
export { getCurrentEditorCompat };

function getCurrentMarkdownViewCompat(): PluginMarkdownView | null {
    return window.__mindzj_markdown_view ?? null;
}
export { getCurrentMarkdownViewCompat };

// ---------------------------------------------------------------------------
// Command Tables
// ---------------------------------------------------------------------------

// [id, name, command] — dispatched via mindzj:editor-command
const EDITOR_COMMANDS: [string, string, string][] = [
    ["editor:toggle-bold", "Bold", "bold"],
    ["editor:toggle-italics", "Italic", "italic"],
    ["editor:toggle-strikethrough", "Strikethrough", "strikethrough"],
    ["editor:toggle-underline", "Underline", "underline"],
    ["editor:toggle-highlight", "Highlight", "highlight"],
    ["editor:toggle-code", "Inline code", "code"],
    ["editor:toggle-blockquote", "Blockquote", "quote"],
    ["editor:toggle-checklist-status", "Checklist status", "toggle-checklist-status"],
    ["editor:toggle-bullet-list", "Bullet list", "bullet-list"],
    ["editor:toggle-numbered-list", "Numbered list", "numbered-list"],
    ["editor:toggle-comments", "Comment", "toggle-comment"],
    ["editor:insert-link", "Insert link", "link"],
    ["editor:insert-tag", "Insert tag", "tag"],
    ["editor:insert-wikilink", "Insert wikilink", "wikilink"],
    ["editor:insert-embed", "Insert embed", "embed"],
    ["editor:insert-callout", "Insert callout", "callout"],
    ["editor:insert-mathblock", "Insert math block", "mathblock"],
    ["editor:insert-table", "Insert table", "table"],
    ["editor:swap-line-up", "Swap line up", "move-line-up"],
    ["editor:swap-line-down", "Swap line down", "move-line-down"],
    ["editor:clear-formatting", "Clear formatting", "clear-formatting"],
];
export { EDITOR_COMMANDS };

// [id, name, level] — dispatched via mindzj:editor-command with heading level
const HEADING_COMMANDS: [string, string, number][] = [
    ["editor:set-heading-1", "Heading 1", 1],
    ["editor:set-heading-2", "Heading 2", 2],
    ["editor:set-heading-3", "Heading 3", 3],
    ["editor:set-heading-4", "Heading 4", 4],
    ["editor:set-heading-5", "Heading 5", 5],
    ["editor:set-heading-6", "Heading 6", 6],
];
export { HEADING_COMMANDS };

// ---------------------------------------------------------------------------
// getBuiltinCommands
// ---------------------------------------------------------------------------

function getBuiltinCommands(): CommandEntry[] {
    const commands: CommandEntry[] = [];

    for (const [id, name, command] of EDITOR_COMMANDS) {
        commands.push({
            id,
            name,
            callback: () =>
                void document.dispatchEvent(
                    new CustomEvent("mindzj:editor-command", {
                        detail: { command },
                    }),
                ),
        });
    }

    for (const [id, name, level] of HEADING_COMMANDS) {
        commands.push({
            id,
            name,
            callback: () =>
                void document.dispatchEvent(
                    new CustomEvent("mindzj:editor-command", {
                        detail: { command: "heading", level },
                    }),
                ),
        });
    }

    commands.push(
        {
            id: "editor:focus",
            name: "Focus editor",
            callback: () => getCurrentEditorCompat()?.focus?.(),
        },
        {
            id: "app:toggle-left-sidebar",
            name: "Toggle left sidebar",
            callback: () =>
                void document.dispatchEvent(
                    new CustomEvent("mindzj:app-command", {
                        detail: { command: "toggle-left-sidebar" },
                    }),
                ),
        },
        {
            id: "app:toggle-right-sidebar",
            name: "Toggle right sidebar",
            callback: () =>
                void document.dispatchEvent(
                    new CustomEvent("mindzj:app-command", {
                        detail: { command: "toggle-right-sidebar" },
                    }),
                ),
        },
    );

    return commands;
}
export { getBuiltinCommands };

// ---------------------------------------------------------------------------
// getAllCommands / getCommandMap / executeCommandById
// ---------------------------------------------------------------------------

function getAllCommands(): CommandEntry[] {
    return [
        ...getBuiltinCommands(),
        ...Array.from(pluginCommandRegistry.values()).map((cmd) => ({
            id: cmd.id,
            name: cmd.name,
            icon: cmd.icon,
            hotkeys: cmd.hotkeys,
            callback: cmd.callback,
            editorCallback: cmd.editorCallback,
        })),
    ];
}
export { getAllCommands };

function getCommandMap(): Record<string, CommandEntry> {
    return Object.fromEntries(getAllCommands().map((cmd) => [cmd.id, cmd]));
}
export { getCommandMap };

export function listPluginCommands(): Array<{
    id: string;
    name: string;
    hotkeys?: Array<{ modifiers?: string[]; key?: string }>;
}> {
    return getAllCommands().map((cmd) => ({
        id: cmd.id,
        name: cmd.name,
        hotkeys: cmd.hotkeys,
    }));
}

export async function runPluginCommand(commandId: string): Promise<boolean> {
    return executeCommandById(commandId);
}

export async function executeCommandById(commandId: string): Promise<boolean> {
    const command = getCommandMap()[commandId];
    if (!command) return false;

    const editor = getCurrentEditorCompat();
    const view = getCurrentMarkdownViewCompat();

    try {
        if (command.editorCallback && editor) {
            await command.editorCallback(editor, view);
            return true;
        }
        if (command.callback) {
            await command.callback();
            return true;
        }
    } catch (e) {
        console.error(`[Plugin Command] Failed to execute "${commandId}":`, e);
    }
    return false;
}

// ---------------------------------------------------------------------------
// Hotkey matching
// ---------------------------------------------------------------------------

function normalizeHotkeyKey(key: string | undefined): string {
    if (!key) return "";
    const value = key.toLowerCase();
    if (value === "space") return " ";
    return value;
}
export { normalizeHotkeyKey };

function matchesPluginHotkey(
    event: KeyboardEvent,
    hotkey: { modifiers?: string[]; key?: string } | undefined,
): boolean {
    if (!hotkey?.key) return false;
    const modifiers = new Set(
        (hotkey.modifiers ?? []).map((m) => m.toLowerCase()),
    );
    const expectsMod = modifiers.has("mod");
    const expectsCtrl = modifiers.has("ctrl");
    const expectsMeta = modifiers.has("meta");
    const expectsShift = modifiers.has("shift");
    const expectsAlt = modifiers.has("alt");

    const wantCtrl =
        expectsCtrl ||
        (expectsMod &&
            !("ontouchstart" in window) &&
            navigator.platform.toLowerCase().includes("win"));
    const wantMeta =
        expectsMeta ||
        (expectsMod && navigator.platform.toLowerCase().includes("mac"));

    if (!!event.ctrlKey !== wantCtrl) return false;
    if (!!event.metaKey !== wantMeta) return false;
    if (!!event.shiftKey !== expectsShift) return false;
    if (!!event.altKey !== expectsAlt) return false;

    return normalizeHotkeyKey(event.key) === normalizeHotkeyKey(hotkey.key);
}
export { matchesPluginHotkey };

// ---------------------------------------------------------------------------
// installPluginHotkeys / uninstallPluginHotkeys
// ---------------------------------------------------------------------------

let _pluginHotkeysInstalled = false;
let _pluginHotkeysHandler: ((event: KeyboardEvent) => void) | null = null;

/** @internal reset guard for tests */
function _resetPluginHotkeysInstalled() {
    _pluginHotkeysInstalled = false;
    _pluginHotkeysHandler = null;
}
export { _resetPluginHotkeysInstalled };

function installPluginHotkeys() {
    if (_pluginHotkeysInstalled) return;
    _pluginHotkeysInstalled = true;

    _pluginHotkeysHandler = (event) => {
        const commands = Array.from(pluginCommandRegistry.values());
        for (const command of commands) {
            if (!command.hotkeys?.length) continue;
            if (
                !command.hotkeys.some((hotkey) =>
                    matchesPluginHotkey(event, hotkey),
                )
            ) {
                continue;
            }
            event.preventDefault();
            event.stopPropagation();
            void executeCommandById(command.id);
            break;
        }
    };
    document.addEventListener("keydown", _pluginHotkeysHandler, true);
}
export { installPluginHotkeys };

function uninstallPluginHotkeys() {
    if (!_pluginHotkeysInstalled) return;
    _pluginHotkeysInstalled = false;
    if (_pluginHotkeysHandler) {
        document.removeEventListener("keydown", _pluginHotkeysHandler, true);
        _pluginHotkeysHandler = null;
    }
}
export { uninstallPluginHotkeys };
