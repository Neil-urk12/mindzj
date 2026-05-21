/**
 * Vault directory structure constants.
 *
 * Canonical source of truth: `crates/mindzj-kernel/src/types.rs` (VaultPaths).
 * This file mirrors those constants for use in the frontend.
 */

export const VAULT_CONFIG_DIR = ".mindzj";

export const SETTINGS_FILE = "settings.json";
export const WORKSPACE_FILE = "workspace.json";
export const HOTKEYS_FILE = "hotkeys.json";

export const PLUGINS_DIR = "plugins";
export const PLUGINS_CONFIG = "plugins.json";

export const SNAPSHOTS_DIR = "snapshots";
export const THEMES_DIR = "themes";
export const SNIPPETS_DIR = "snippets";
export const IMAGES_DIR = "images";

export const FILE_ORDER = "file-order.json";
export const FOLDER_STATE = "folder-state.json";

// Composite paths
export const DEFAULT_ATTACHMENT_FOLDER = `${VAULT_CONFIG_DIR}/${IMAGES_DIR}`;
export const SETTINGS_PATH = `${VAULT_CONFIG_DIR}/${SETTINGS_FILE}`;
export const WORKSPACE_PATH = `${VAULT_CONFIG_DIR}/${WORKSPACE_FILE}`;
export const HOTKEYS_PATH = `${VAULT_CONFIG_DIR}/${HOTKEYS_FILE}`;
export const PLUGINS_CONFIG_PATH = `${VAULT_CONFIG_DIR}/${PLUGINS_CONFIG}`;
export const FILE_ORDER_PATH = `${VAULT_CONFIG_DIR}/${FILE_ORDER}`;
export const FOLDER_STATE_PATH = `${VAULT_CONFIG_DIR}/${FOLDER_STATE}`;
