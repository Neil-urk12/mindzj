# ADR-0001: Extract shared kernel crate

## Status

Accepted

## Context

The CLI crate (`cli/`) reimplements vault operations, link parsing, search, and file I/O independently of the Tauri app's kernel (`src-tauri/src/kernel/`). This means:
- Bug fixes in the kernel must be manually replicated in the CLI
- The CLI's link parser is a buggy subset (no code block skipping, no embed handling, no anchor stripping)
- Two implementations of the same domain logic drift over time

The kernel has zero Tauri dependencies — it uses only `std::fs`, `rusqlite`, `tantivy`, and `notify`.

Two options were considered:
- **A.** Extract kernel into a shared crate (`mindzj-kernel`). Both `src-tauri` and `cli` depend on it.
- **B.** Make `cli` depend on `mindzj_lib` directly (the Tauri app's library crate).

## Decision

Extract `mindzj-kernel` as a third workspace member at `crates/mindzj-kernel/`.

## Consequences

**Positive:**
- Single implementation of vault, link, search, and plugin logic
- CLI automatically gets bug fixes and new features
- Kernel crate is testable in isolation (no Tauri, no frontend)
- Clean dependency graph — kernel has no Tauri transitive deps

**Negative:**
- File moves required: `kernel/`, `types.rs`, `error.rs` out of `src-tauri/`
- `src-tauri/src/api/` must import from `mindzj-kernel` instead of `crate::kernel`
- `AppState` (multi-vault window management) must be separated from `VaultContext` (per-vault state)
- Plugin filesystem operations move from API layer into kernel

**Why not B:**
Depending on `mindzj_lib` would pull Tauri dependencies into the CLI binary. The kernel is pure domain logic — it deserves a clean crate boundary that reflects this. Option B is a shortcut that creates an honest dependency problem.
