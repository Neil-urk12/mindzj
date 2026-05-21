import { createSignal, createRoot } from "solid-js";
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

function createWorkspaceStore() {
  const [workspace, setWorkspace] = createSignal<WorkspaceState>({ ...DEFAULT_WORKSPACE });
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  async function loadWorkspace(): Promise<WorkspaceState> {
    try {
      const ws = await invoke<WorkspaceState>("load_workspace");
      setWorkspace(ws);
      return ws;
    } catch (e) {
      console.warn("Failed to load workspace:", e);
      return DEFAULT_WORKSPACE;
    }
  }

  async function saveWorkspace(ws?: Partial<WorkspaceState>) {
    if (ws) {
      setWorkspace((prev) => ({ ...prev, ...ws }));
    }
    try {
      await invoke("save_workspace", { workspace: workspace() });
    } catch (e) {
      console.error("Failed to save workspace:", e);
    }
  }

  // Debounced save (1 second after last change)
  function scheduleSave(partial?: Partial<WorkspaceState>) {
    if (partial) {
      setWorkspace((prev) => ({ ...prev, ...partial }));
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWorkspace(), 1000);
  }

  return {
    workspace,
    loadWorkspace,
    saveWorkspace,
    scheduleSave,
  };
}

export const workspaceStore = createRoot(createWorkspaceStore);
