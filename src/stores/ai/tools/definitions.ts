import type { ToolDefinition } from "../types";

export const NOTE_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    path: { type: "string", description: "Vault-relative path, for example notes/today.md" },
  },
  required: ["path"],
  additionalProperties: false,
};

export const OPTIONAL_MINDMAP_PATH_PROPERTY = {
  type: "string",
  description: "Vault-relative .mindzj path. Optional when the active file is the target mind map.",
};

export const MINDMAP_TEXT_PATH_PROPERTY = {
  type: "array",
  items: { type: "string" },
  description: "Node text path from root to target, for example [\"Project\", \"Tasks\", \"Done\"]. Prefer node_id after read_mindmap when possible.",
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_notes",
      description: "List notes and folders in the current vault.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_app_commands",
      description: "List built-in automation tool names and registered plugin command ids.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_note",
      description: "Get the currently active note path and view mode.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description: "Read the full contents of a vault note.",
      parameters: NOTE_TOOL_PARAMETERS,
    },
  },
  {
    type: "function",
    function: {
      name: "list_mindmaps",
      description: "List .mindzj mind map files in the current vault.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_mindmap",
      description: "Read a .mindzj mind map as a structured node outline. Use this before editing nodes to get node ids or text paths.",
      parameters: {
        type: "object",
        properties: {
          path: OPTIONAL_MINDMAP_PATH_PROPERTY,
          query: { type: "string", description: "Optional text query to return matching nodes." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_mindmap_from_markdown",
      description: "Convert a Markdown file into a .mindzj mind map. Defaults to the active Markdown file and writes beside it using the .mindzj extension.",
      parameters: {
        type: "object",
        properties: {
          source_path: { type: "string", description: "Vault-relative Markdown source path. Optional when the active file is Markdown." },
          target_path: { type: "string", description: "Vault-relative .mindzj target path. Optional; defaults to source basename with .mindzj extension." },
          root_title: { type: "string", description: "Fallback root title when the Markdown content has no H1 heading." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_mindmap",
      description: "Create or replace a .mindzj mind map from an indented Markdown outline such as '# Root\\n## Branch\\n- Leaf'.",
      parameters: {
        type: "object",
        properties: {
          path: OPTIONAL_MINDMAP_PATH_PROPERTY,
          outline_markdown: { type: "string", description: "Markdown outline to convert to rootNodes." },
          root_title: { type: "string", description: "Fallback root title when outline_markdown has no H1 heading." },
        },
        required: ["outline_markdown"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_mindmap_node",
      description: "Add a node to a .mindzj mind map. If parent is omitted, add under the only root node, or create a new root when the map has multiple roots.",
      parameters: {
        type: "object",
        properties: {
          path: OPTIONAL_MINDMAP_PATH_PROPERTY,
          parent_id: { type: "string", description: "Parent node id from read_mindmap." },
          parent_text_path: MINDMAP_TEXT_PATH_PROPERTY,
          parent_text: { type: "string", description: "Parent node text, only when it is unique." },
          text: { type: "string", description: "New node text." },
          index: { type: "number", description: "Optional child insertion index." },
          side: { type: "string", enum: ["left", "right"], description: "Optional side for root children." },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_mindmap_node",
      description: "Change the text of one node in a .mindzj mind map.",
      parameters: {
        type: "object",
        properties: {
          path: OPTIONAL_MINDMAP_PATH_PROPERTY,
          node_id: { type: "string", description: "Target node id from read_mindmap." },
          text_path: MINDMAP_TEXT_PATH_PROPERTY,
          current_text: { type: "string", description: "Current target text, only when it is unique." },
          text: { type: "string", description: "Replacement node text." },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_mindmap_node",
      description: "Delete one node and its children from a .mindzj mind map.",
      parameters: {
        type: "object",
        properties: {
          path: OPTIONAL_MINDMAP_PATH_PROPERTY,
          node_id: { type: "string", description: "Target node id from read_mindmap." },
          text_path: MINDMAP_TEXT_PATH_PROPERTY,
          current_text: { type: "string", description: "Current target text, only when it is unique." },
          allow_delete_root: { type: "boolean", description: "Set true only when the user explicitly asked to delete a root node." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_note",
      description: "Create a new note with content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_note",
      description: "Replace the full content of an existing note.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append_note",
      description: "Append text to the end of a note.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_note",
      description: "Delete a note from the vault.",
      parameters: NOTE_TOOL_PARAMETERS,
    },
  },
  {
    type: "function",
    function: {
      name: "delete_folder",
      description: "Delete a folder from the vault.",
      parameters: NOTE_TOOL_PARAMETERS,
    },
  },
  {
    type: "function",
    function: {
      name: "rename_note",
      description: "Rename or move a note.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes",
      description: "Search text across the vault.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_backlinks",
      description: "Get notes that link to a vault note.",
      parameters: NOTE_TOOL_PARAMETERS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_forward_links",
      description: "Get notes that a vault note links to.",
      parameters: NOTE_TOOL_PARAMETERS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_graph_data",
      description: "Get current vault graph data.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_note",
      description: "Open a note in the editor.",
      parameters: NOTE_TOOL_PARAMETERS,
    },
  },
  {
    type: "function",
    function: {
      name: "create_folder",
      description: "Create a folder in the vault.",
      parameters: NOTE_TOOL_PARAMETERS,
    },
  },
  {
    type: "function",
    function: {
      name: "refresh_file_tree",
      description: "Refresh the vault file tree from disk.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_view_mode",
      description: "Set the active note view mode.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["source", "live-preview", "reading"] },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_default_view_mode",
      description: "Set the default note view mode in settings.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["source", "live-preview", "reading"] },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_settings",
      description: "Read current app settings. API keys are not included.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_setting",
      description: "Update one app setting by key. Use get_settings first to inspect available keys.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: {},
        },
        required: ["key", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_plugin_command",
      description: "Run a registered plugin command by command id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
];
