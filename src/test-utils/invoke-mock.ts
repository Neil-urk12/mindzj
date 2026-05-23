import { vi } from "vitest";

type InvokeResult = unknown;

/**
 * Default stubs for Tauri invoke commands.
 * Returns sensible empty values for known commands; tests override what they care about.
 */
const DEFAULT_STUBS: Record<string, InvokeResult> = {
  // Vault
  read_file: { path: "", content: "", modified: "", hash: "" },
  write_file: { path: "", content: "", modified: "", hash: "" },
  create_file: { path: "", content: "", modified: "", hash: "" },
  delete_file: undefined,
  delete_dir: undefined,
  create_dir: undefined,
  rename_file: undefined,
  get_file_tree: [],
  open_vault: { name: "", path: "" },
  list_entries: [],

  // Search / backlinks
  search_vault: [],
  get_backlinks: [],
  get_forward_links: [],
  get_graph_data: { nodes: [], edges: [] },

  // Settings
  get_settings: {},
  update_settings: undefined,
  get_hotkeys: [],
  save_hotkeys: undefined,

  // Binary files
  read_binary_file: new Uint8Array(),
  write_binary_file: undefined,

  // File metadata
  get_file_metadata: { size: 0, modified: 0 },

  // AI
  ai_chat_completion: { choices: [] },
  ai_get_json: {},
  ai_transcribe_audio: { text: "" },
  ai_text_to_speech: { audio_base64: "", content_type: "" },
  get_ai_api_key: null,

  // Plugins
  list_plugins: [],
  read_plugin_styles: "",
  read_plugin_main: "",

  // Themes / CSS
  read_theme: "",
  read_css_snippet: "",

  // Workspace
  save_workspace: undefined,
  load_workspace: {
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
  },

  // App
  open_in_default_app: undefined,
  reveal_in_file_manager: undefined,
};

export function createMockInvoke(overrides?: Record<string, InvokeResult>) {
  const stubs = { ...DEFAULT_STUBS, ...overrides };
  const mock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
    if (command in stubs) return stubs[command];
    throw new Error(`Unmocked invoke command: ${command}`);
  });
  return mock;
}
