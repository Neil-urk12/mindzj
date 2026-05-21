use crate::OutputFormat;
use anyhow::Result;
use colored::Colorize;
use mindzj_kernel::types::SearchQuery;
use mindzj_kernel::vault::Vault;
use mindzj_kernel::{open_vault_context, VaultContext};
use serde_json::json;
use std::fs;
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::Arc;

// ---------------------------------------------------------------------------
// Vault commands
// ---------------------------------------------------------------------------

pub fn vault_info(vault_path: &Path, format: OutputFormat) -> Result<()> {
    let config_dir = vault_path.join(".mindzj");

    if !config_dir.exists() {
        eprintln!(
            "{} '{}' is not a MindZJ vault (no .mindzj directory).",
            "Error:".red(),
            vault_path.display()
        );
        eprintln!("Run {} to initialize.", "mindzj vault open <path>".cyan());
        std::process::exit(1);
    }

    let vault = Vault::open(vault_path, "cli-vault")?;
    let entries = vault.file_tree(10)?;
    let (md_count, total_size) = count_entries(&entries);
    let name = vault
        .root()
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let size_human = format_bytes(total_size);

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "name": name,
            "path": vault_path,
            "notes": md_count,
            "size_bytes": total_size,
            "size_human": size_human
        }))?;
        return Ok(());
    }

    println!("{}", "Vault Information".bold().underline());
    println!("  Name:     {}", name.cyan());
    println!("  Path:     {}", vault_path.display());
    println!("  Notes:    {}", md_count);
    println!("  Size:     {}", size_human);

    Ok(())
}

pub fn vault_list(format: OutputFormat) -> Result<()> {
    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "vaults": [],
            "implemented": false
        }))?;
        return Ok(());
    }

    println!("{}", "Known vaults:".bold());
    println!("  (vault history is not implemented yet)");
    Ok(())
}

pub fn vault_open(path: &Path, format: OutputFormat) -> Result<()> {
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());

    // Vault::open handles creating the directory structure
    let _vault = Vault::open(&path, "cli-vault")?;

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "path": path,
            "initialized": true
        }))?;
        return Ok(());
    }

    println!(
        "{} Opened vault at {}",
        "OK".green(),
        path.display().to_string().cyan()
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Note commands
// ---------------------------------------------------------------------------

pub fn note_create(
    vault_path: &Path,
    name: &str,
    content: Option<&str>,
    read_stdin: bool,
    folder: Option<&str>,
    format: OutputFormat,
) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    let file_name = normalize_note_name(name);
    let relative_path = if let Some(dir) = folder {
        format!("{}/{}", dir, file_name)
    } else {
        file_name.clone()
    };

    let input = read_content_input(content, read_stdin)?;
    let default_content = if input.is_empty() {
        format!("# {}\n\n", name.trim_end_matches(".md"))
    } else {
        input
    };

    let fc = ctx
        .vault
        .create_file(&relative_path, &default_content)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    // Update indexes
    ctx.on_file_changed(&relative_path, &default_content);

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "created": true,
            "path": fc.path,
            "bytes": fc.content.len()
        }))?;
        return Ok(());
    }

    println!(
        "{} Created note: {}",
        "OK".green(),
        fc.path.cyan()
    );

    Ok(())
}

pub fn note_write(
    vault_path: &Path,
    name: &str,
    content: Option<&str>,
    read_stdin: bool,
    create: bool,
    format: OutputFormat,
) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    let relative_path = resolve_note_path_from_vault(&ctx, name);
    let existed_before = ctx.vault.read_file(&relative_path).is_ok();

    if !existed_before && !create {
        eprintln!("{} Note '{}' not found.", "Error:".red(), name);
        std::process::exit(1);
    }

    let next_content = read_required_content(content, read_stdin, "write")?;

    let fc = if existed_before {
        ctx.vault
            .write_file(&relative_path, &next_content)
            .map_err(|e| anyhow::anyhow!("{}", e))?
    } else {
        ctx.vault
            .create_file(&relative_path, &next_content)
            .map_err(|e| anyhow::anyhow!("{}", e))?
    };

    // Update indexes
    ctx.on_file_changed(&relative_path, &next_content);

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "written": true,
            "path": fc.path,
            "bytes": fc.content.len(),
            "created": create && !existed_before
        }))?;
        return Ok(());
    }

    println!(
        "{} Wrote note: {}",
        "OK".green(),
        fc.path.cyan()
    );

    Ok(())
}

pub fn note_append(
    vault_path: &Path,
    name: &str,
    content: Option<&str>,
    read_stdin: bool,
    format: OutputFormat,
) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    let relative_path = resolve_note_path_from_vault(&ctx, name);
    let fc = ctx
        .vault
        .read_file(&relative_path)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    let appended = read_required_content(content, read_stdin, "append")?;
    let mut current = fc.content;

    if !current.is_empty() && !current.ends_with('\n') {
        current.push('\n');
    }
    current.push_str(&appended);

    let updated = ctx
        .vault
        .write_file(&relative_path, &current)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    // Update indexes
    ctx.on_file_changed(&relative_path, &current);

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "appended": true,
            "path": updated.path,
            "appended_bytes": appended.len(),
            "bytes": current.len()
        }))?;
        return Ok(());
    }

    println!(
        "{} Appended to note: {}",
        "OK".green(),
        updated.path.cyan()
    );

    Ok(())
}

pub fn note_move(
    vault_path: &Path,
    from: &str,
    to: &str,
    format: OutputFormat,
) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    let from_path = resolve_note_path_from_vault(&ctx, from);
    let to_path = resolve_note_destination(to);

    ctx.vault
        .rename_file(&from_path, &to_path)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    // Update indexes - remove old, re-index content under new path
    ctx.on_file_deleted(&from_path);
    if let Ok(fc) = ctx.vault.read_file(&to_path) {
        ctx.on_file_changed(&to_path, &fc.content);
    }

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "moved": true,
            "from": from_path,
            "to": to_path
        }))?;
        return Ok(());
    }

    println!(
        "{} Moved note: {} -> {}",
        "OK".green(),
        from_path.cyan(),
        to_path.cyan()
    );

    Ok(())
}

pub fn note_read(vault_path: &Path, name: &str, format: OutputFormat) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    let relative_path = resolve_note_path_from_vault(&ctx, name);
    let fc = ctx
        .vault
        .read_file(&relative_path)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "path": fc.path,
            "content": fc.content
        }))?;
        return Ok(());
    }

    print!("{}", fc.content);
    Ok(())
}

pub fn note_list(
    vault_path: &Path,
    tag_filter: Option<&str>,
    dir_filter: Option<&str>,
    format: OutputFormat,
) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    let entries = ctx
        .vault
        .file_tree(10)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    let mut notes: Vec<String> = Vec::new();
    collect_note_paths(&entries, &mut notes);

    // Apply directory filter
    if let Some(dir) = dir_filter {
        notes.retain(|p| p.starts_with(dir));
    }

    // Apply tag filter (grep-based, same as original)
    if let Some(tag) = tag_filter {
        let tag_pattern = format!("#{}", tag);
        notes.retain(|p| {
            if let Ok(fc) = ctx.vault.read_file(p) {
                fc.content.contains(&tag_pattern)
            } else {
                false
            }
        });
    }

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "count": notes.len(),
            "notes": notes
        }))?;
        return Ok(());
    }

    if notes.is_empty() {
        println!("No notes found.");
        return Ok(());
    }

    for path in &notes {
        println!("{}", path);
    }

    println!("\n{} notes total", notes.len().to_string().cyan());
    Ok(())
}

pub fn note_search(
    vault_path: &Path,
    query: &str,
    limit: usize,
    format: OutputFormat,
) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    let search_query = SearchQuery {
        text: query.to_string(),
        limit,
        extension_filter: Some(".md".to_string()),
        path_filter: None,
    };

    let results = ctx
        .search_index
        .lock()
        .map_err(|e| anyhow::anyhow!("Search index lock poisoned: {}", e))?
        .search(&search_query)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    if matches!(format, OutputFormat::Json) {
        let payload: Vec<_> = results
            .iter()
            .map(|r| {
                json!({
                    "path": r.path,
                    "matches": r.snippets.iter().map(|s| {
                        json!({ "line": s.line, "text": s.text })
                    }).collect::<Vec<_>>()
                })
            })
            .collect();
        emit_json(&json!({
            "query": query,
            "matched_files": payload.len(),
            "results": payload
        }))?;
        return Ok(());
    }

    if results.is_empty() {
        println!("No results for '{}'", query);
        return Ok(());
    }

    for result in &results {
        println!("{}", result.path.cyan().bold());

        for snippet in result.snippets.iter().take(3) {
            let display = snippet
                .text
                .replace(query, &format!("{}", query.yellow().bold()));
            println!("  L:{} {}", snippet.line + 1, display);
        }

        if result.snippets.len() > 3 {
            println!(
                "  {} more matches...",
                (result.snippets.len() - 3).to_string().dimmed()
            );
        }

        println!();
    }

    println!("{} files matched", results.len().to_string().cyan());
    Ok(())
}

pub fn note_delete(
    vault_path: &Path,
    name: &str,
    force: bool,
    format: OutputFormat,
) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    let relative_path = resolve_note_path_from_vault(&ctx, name);

    if !force {
        eprint!("Delete '{}'? This cannot be undone. [y/N] ", relative_path);
        io::stderr().flush()?;

        let mut input = String::new();
        io::stdin().read_line(&mut input)?;

        if !input.trim().eq_ignore_ascii_case("y") {
            println!("Cancelled.");
            return Ok(());
        }
    }

    // Delete via kernel (handles snapshots internally)
    ctx.vault
        .delete_file(&relative_path)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    // Update indexes
    ctx.on_file_deleted(&relative_path);

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "deleted": true,
            "path": relative_path
        }))?;
        return Ok(());
    }

    println!("{} Deleted: {}", "OK".green(), relative_path);
    Ok(())
}

pub fn note_links(vault_path: &Path, name: &str, format: OutputFormat) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    let relative_path = resolve_note_path_from_vault(&ctx, name);

    // Build indexes to ensure link data is fresh
    ctx.build_indexes()
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    let links = ctx
        .link_index
        .lock()
        .map_err(|e| anyhow::anyhow!("Link index lock poisoned: {}", e))?
        .get_forward_links(&relative_path);

    let link_targets: Vec<String> = links
        .iter()
        .map(|l| {
            if let Some(ref display) = l.display_text {
                format!("{} [{}]", l.target, display)
            } else {
                l.target.clone()
            }
        })
        .collect();

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "path": relative_path,
            "links": link_targets
        }))?;
        return Ok(());
    }

    println!("{}", "Outgoing links:".bold());
    if link_targets.is_empty() {
        println!("  (no links found)");
        return Ok(());
    }

    for link in &link_targets {
        println!("  -> {}", link.cyan());
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Plugin commands
// ---------------------------------------------------------------------------

pub fn plugin_list(vault_path: &Path, format: OutputFormat) -> Result<()> {
    ensure_vault(vault_path)?;

    let plugins = mindzj_kernel::plugins::list_plugins(vault_path)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "count": plugins.len(),
            "plugins": plugins
        }))?;
        return Ok(());
    }

    if plugins.is_empty() {
        println!("No plugins installed.");
        return Ok(());
    }

    println!("{}", "Installed plugins:".bold());
    for plugin in &plugins {
        let status = if plugin.enabled { "enabled" } else { "disabled" };
        let status_colored = if plugin.enabled {
            status.green()
        } else {
            status.dimmed()
        };
        println!(
            "  {} v{} [{}] - {}",
            plugin.manifest.name.cyan(),
            plugin.manifest.version,
            status_colored,
            plugin.manifest.description
        );
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Config commands
// ---------------------------------------------------------------------------

pub fn config_get(vault_path: &Path, key: &str, format: OutputFormat) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    // Load settings from kernel
    ctx.load_settings()
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    let settings = ctx
        .settings
        .read()
        .map_err(|e| anyhow::anyhow!("Settings lock poisoned: {}", e))?;

    // Serialize settings to JSON to query by key
    let settings_json = serde_json::to_value(&*settings)?;
    let value = settings_json.get(key).cloned().unwrap_or(serde_json::Value::Null);

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({ "key": key, "value": value }))?;
    } else if value.is_null() {
        println!("(not set)");
    } else {
        println!("{}", value);
    }

    Ok(())
}

pub fn config_set(vault_path: &Path, key: &str, value: &str, format: OutputFormat) -> Result<()> {
    let ctx = open_vault_or_exit(vault_path);

    // Load current settings
    ctx.load_settings()
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    // Update settings via JSON manipulation
    {
        let mut settings = ctx
            .settings
            .write()
            .map_err(|e| anyhow::anyhow!("Settings lock poisoned: {}", e))?;

        let mut settings_json = serde_json::to_value(&*settings)?;
        settings_json[key] = serde_json::Value::String(value.to_string());
        *settings = serde_json::from_value(settings_json)?;
    }

    // Save settings via kernel
    ctx.save_settings()
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "updated": true,
            "key": key,
            "value": value
        }))?;
        return Ok(());
    }

    println!("{} Set {} = {}", "OK".green(), key.cyan(), value);
    Ok(())
}

pub fn api_key_create(vault_path: &Path, format: OutputFormat) -> Result<()> {
    ensure_vault(vault_path)?;

    // Generate API key using kernel's crypto
    use rand::Rng;
    let key_bytes: [u8; 16] = rand::thread_rng().gen();
    let api_key = format!("mzk_{}", hex::encode(&key_bytes));

    // Hash the key for storage
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(api_key.as_bytes());
    let hash = hex::encode(hasher.finalize());

    let key_config_path = vault_path.join(".mindzj").join("api_key_hash");
    fs::write(&key_config_path, &hash)?;

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({
            "created": true,
            "api_key": api_key
        }))?;
        return Ok(());
    }

    println!("{} API key created:", "OK".green());
    println!();
    println!("  {}", api_key.yellow().bold());
    println!();
    println!("{}", "Save this key - it will not be shown again.".dimmed());
    println!(
        "Set it as: {} or use {}",
        "export MINDZJ_API_KEY=<key>".cyan(),
        "--key <key>".cyan()
    );

    Ok(())
}

pub fn api_key_revoke(vault_path: &Path, format: OutputFormat) -> Result<()> {
    let key_path = vault_path.join(".mindzj").join("api_key_hash");
    let revoked = key_path.exists();

    if revoked {
        fs::remove_file(&key_path)?;
    }

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({ "revoked": revoked }))?;
        return Ok(());
    }

    if revoked {
        println!("{} API key revoked.", "OK".green());
    } else {
        println!("No API key configured.");
    }

    Ok(())
}

pub fn api_key_status(vault_path: &Path, format: OutputFormat) -> Result<()> {
    let key_path = vault_path.join(".mindzj").join("api_key_hash");
    let has_api_key = key_path.exists();

    if matches!(format, OutputFormat::Json) {
        emit_json(&json!({ "has_api_key": has_api_key }))?;
        return Ok(());
    }

    if has_api_key {
        println!("{} API key is configured.", "OK".green());
    } else {
        println!("{} No API key configured.", "ERR".red());
        println!("Create one with: {}", "mindzj config api-key create".cyan());
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn emit_json(value: &serde_json::Value) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn ensure_vault(vault_path: &Path) -> Result<()> {
    if !vault_path.join(".mindzj").exists() {
        eprintln!(
            "{} '{}' is not a MindZJ vault.",
            "Error:".red(),
            vault_path.display()
        );
        eprintln!(
            "Initialize with: {}",
            format!("mindzj vault open {}", vault_path.display()).cyan()
        );
        std::process::exit(1);
    }
    Ok(())
}

fn open_vault_or_exit(vault_path: &Path) -> Arc<VaultContext> {
    ensure_vault(vault_path).unwrap_or_else(|_| std::process::exit(1));

    let name = vault_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    open_vault_context(vault_path, &name).unwrap_or_else(|e| {
        eprintln!("{} Failed to open vault: {}", "Error:".red(), e);
        std::process::exit(1);
    })
}

fn normalize_note_name(name: &str) -> String {
    if name.ends_with(".md") {
        name.to_string()
    } else {
        format!("{}.md", name)
    }
}

fn resolve_note_destination(name: &str) -> String {
    let normalized = name.replace('\\', "/");
    normalize_note_name(&normalized)
}

fn resolve_note_path_from_vault(ctx: &VaultContext, name: &str) -> String {
    // Try direct path first
    let direct = name.to_string();
    if ctx.vault.read_file(&direct).is_ok() {
        return direct;
    }

    // Try with .md extension
    let with_ext = normalize_note_name(name);
    if ctx.vault.read_file(&with_ext).is_ok() {
        return with_ext;
    }

    // Search by filename
    let entries = ctx.vault.file_tree(10).unwrap_or_default();
    let mut found = Vec::new();
    search_in_entries(&entries, name, &mut found);

    match found.len() {
        0 => {
            eprintln!("{} Note '{}' not found.", "Error:".red(), name);
            std::process::exit(1);
        }
        1 => found.into_iter().next().unwrap(),
        _ => {
            eprintln!("{} Multiple matches for '{}':", "Error:".red(), name);
            for path in &found {
                eprintln!("  {}", path);
            }
            eprintln!("Use the full path to specify which one.");
            std::process::exit(1);
        }
    }
}

fn search_in_entries(entries: &[mindzj_kernel::types::VaultEntry], name: &str, results: &mut Vec<String>) {
    for entry in entries {
        if entry.is_dir {
            if let Some(ref children) = entry.children {
                search_in_entries(children, name, results);
            }
        } else {
            let file_name = &entry.name;
            let name_no_ext = file_name.trim_end_matches(".md");

            if file_name == name || name_no_ext == name {
                results.push(entry.relative_path.clone());
            }
        }
    }
}

fn read_content_input(content: Option<&str>, read_stdin: bool) -> Result<String> {
    if let Some(content) = content {
        return Ok(content.to_string());
    }
    if read_stdin {
        let mut buffer = String::new();
        io::stdin().read_to_string(&mut buffer)?;
        return Ok(buffer);
    }
    Ok(String::new())
}

fn read_required_content(content: Option<&str>, read_stdin: bool, action: &str) -> Result<String> {
    let value = read_content_input(content, read_stdin)?;
    if value.is_empty() {
        anyhow::bail!(
            "No content provided for {}. Use --content or --stdin.",
            action
        );
    }
    Ok(value)
}

fn count_entries(entries: &[mindzj_kernel::types::VaultEntry]) -> (u32, u64) {
    let mut md_count = 0u32;
    let mut total_size = 0u64;
    for entry in entries {
        if entry.is_dir {
            if let Some(ref children) = entry.children {
                let (c, s) = count_entries(children);
                md_count += c;
                total_size += s;
            }
        } else {
            total_size += entry.size;
            if entry.extension == "md" {
                md_count += 1;
            }
        }
    }
    (md_count, total_size)
}

fn collect_note_paths(entries: &[mindzj_kernel::types::VaultEntry], results: &mut Vec<String>) {
    for entry in entries {
        if entry.is_dir {
            if let Some(ref children) = entry.children {
                collect_note_paths(children, results);
            }
        } else if entry.extension == "md" {
            results.push(entry.relative_path.clone());
        }
    }
}

fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}
