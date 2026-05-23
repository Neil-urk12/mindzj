# Domain Context — MindZJ

## Core Concepts

| Term | Definition |
|------|-----------|
| **Vault** | A directory of Markdown files + `.mindzj/` config dir. The primary unit of user data. |
| **Kernel** | Shared Rust crate (`crates/mindzj-kernel/`): vault I/O, search index, link graph, plugin ops. Used by both Tauri app and CLI. |
| **Note** | A single Markdown file inside a vault. May contain wiki-links, frontmatter, embedded images. |
| **Wiki-link** | `[[target]]` or `[[target|alias]]` syntax for cross-note references. Bidirectional. |
| **Backlink** | A note that wiki-links *to* the current note. Computed by the link graph. |
| **NoteAttachment** | An image or binary file referenced by a Note. Stored in the vault's attachment folder. Lifecycle managed by the editor (paste, delete) through a dedicated utility. |
| **Mindmap** | `.mindzj` file format — structured tree document (not Markdown). |
| **Plugin** | WebWorker-sandboxed extension with declarative permissions. Obsidian-compatible API surface. |
| **Theme** | CSS file targeting `data-theme` attribute. 30 built-in + user-importable. |
| **Skin** | `custom:<name>` theme variant applying user CSS snippets. |
| **Snapshot** | Versioned copy of a note (stored in `.mindzj/snapshots/`). |
| **Workspace** | Per-vault UI state: open files, split layout, sidebar visibility. Persisted in `.mindzj/workspace.json`. |
| **AppSettings** | Global user preferences (theme, editor, AI, attachments). Persisted in `.mindzj/settings.json`. |
| **Hotkey** | Keyboard shortcut override. Persisted in `.mindzj/hotkeys.json`. |

## Architecture Terms

| Term | Definition |
|------|-----------|
| **API layer** | `src-tauri/src/api/` — Tauri command handlers bridging frontend ↔ kernel. |
| **Store** | SolidJS reactive state (`src/stores/`). Each store owns a domain slice. |
| **ts-rs binding** | Auto-generated TypeScript types from Rust structs via `#[derive(TS)]`. |
| **AI provider** | OpenAI-compatible, Anthropic, or Gemini API endpoint. Proxied through Rust backend (no CORS). |
| **Tool** | AI function-calling capability (file CRUD, mindmap ops, search). Defined in `ai.ts`. |
