import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceState } from "../types";

export type { WorkspaceState } from "../types";

const DEFAULT_WORKSPACE: WorkspaceState = {
    open_files: [],
    active_file: null,
    primary_pane_path: null,
    secondary_pane_path: null,
    active_pane_slot: "primary",
    split_direction: "right",
    split_ratio: 0.5,
    sidebar_tab: "files",
    sidebar_collapsed: false,
    sidebar_width: 260,
    sidebar_tab_order: [],
    file_scroll_positions: {},
    file_top_lines: {},
    file_view_modes: {},
    file_last_non_reading_view_modes: {},
    window_x: null,
    window_y: null,
    window_width: null,
    window_height: null,
    window_maximized: null,
};

let workspace: WorkspaceState = { ...DEFAULT_WORKSPACE };
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadWorkspace(): Promise<WorkspaceState> {
    try {
        workspace = await invoke<WorkspaceState>("load_workspace");
        return workspace;
    } catch (e) {
        console.warn("Failed to load workspace:", e);
        return DEFAULT_WORKSPACE;
    }
}

export async function saveWorkspace(
    partial?: Partial<WorkspaceState>,
): Promise<void> {
    if (partial) {
        workspace = { ...workspace, ...partial };
    }
    try {
        await invoke("save_workspace", { workspace });
    } catch (e) {
        console.error("Failed to save workspace:", e);
    }
}

export function scheduleSave(partial?: Partial<WorkspaceState>): void {
    if (partial) {
        workspace = { ...workspace, ...partial };
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWorkspace(), 1000);
}
