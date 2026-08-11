use crate::assets::{
    asset_directory_for_note, cleanup_unreferenced_note_assets, copy_note_assets,
    move_note_and_assets, move_note_assets, rewrite_note_asset_references,
};
use crate::model::{
    FolderRenamePath, FolderRenameResult, IndexWarningKind, NoteDocument, SaveNoteResult,
};
use crate::paths::{
    canonical_library_root, existing_library_path, is_markdown_path, library_folder,
    path_for_title, relative_folder_path, relative_note_id, safe_file_stem, unique_directory_path,
    unique_path,
};
use chrono::Local;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use walkdir::WalkDir;

enum SaveNoteFailure {
    Conflict(Box<NoteDocument>),
    Error(String),
}

static TEMPORARY_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Default, Serialize, Deserialize)]
struct FrontMatter {
    title: Option<String>,
    tags: Option<Vec<String>>,
    created: Option<String>,
    updated: Option<String>,
}

fn modified_seconds(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn file_revision(path: &Path, contents: &str) -> String {
    let modified = fs::metadata(path)
        .and_then(|meta| meta.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let digest = Sha256::digest(contents.as_bytes());
    format!("{modified}:{}:{digest:x}", contents.len())
}

pub(crate) fn now_rfc3339() -> String {
    Local::now().to_rfc3339()
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut result = Vec::new();
    for tag in tags {
        let cleaned = tag.trim();
        if !cleaned.is_empty()
            && cleaned.chars().count() <= 64
            && !result
                .iter()
                .any(|item: &String| item.eq_ignore_ascii_case(cleaned))
        {
            result.push(cleaned.to_string());
        }
    }
    result
}

fn front_matter_body(raw: &str) -> String {
    let normalized = raw.replace("\r\n", "\n");
    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some((_, body)) = rest.split_once("\n---\n") {
            return body.strip_prefix('\n').unwrap_or(body).to_string();
        }
    }
    normalized
}

fn split_front_matter_result(raw: &str) -> Result<(FrontMatter, String), serde_yaml::Error> {
    let normalized = raw.replace("\r\n", "\n");
    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some((yaml, _)) = rest.split_once("\n---\n") {
            // The blank line after front matter is a file-format separator, not
            // part of the note body. Consuming it prevents autosave from
            // accumulating one more leading blank line on every write.
            return Ok((serde_yaml::from_str(yaml)?, front_matter_body(raw)));
        }
    }
    Ok((FrontMatter::default(), normalized))
}

fn split_front_matter(raw: &str) -> (FrontMatter, String) {
    split_front_matter_result(raw)
        .unwrap_or_else(|_| (FrontMatter::default(), front_matter_body(raw)))
}

fn title_from_body(body: &str, fallback: &str) -> String {
    body.lines()
        .find_map(|line| {
            line.strip_prefix("# ")
                .map(|title| title.trim().to_string())
        })
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

pub(crate) fn body_with_title(body: &str, title: &str) -> String {
    let mut lines = body.lines().map(str::to_string).collect::<Vec<_>>();
    if let Some(index) = lines.iter().position(|line| line.starts_with("# ")) {
        lines[index] = format!("# {}", title);
    } else {
        lines.insert(0, format!("# {}", title));
        lines.insert(1, String::new());
    }
    let mut result = lines.join("\n");
    if body.ends_with('\n') {
        result.push('\n');
    }
    result
}

pub(crate) fn note_excerpt(body: &str) -> String {
    body.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with("```"))
        .map(|line| line.trim_start_matches(['>', '-', '*', ' ']).trim())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(180)
        .collect()
}

fn note_document_from_parts(
    path: &Path,
    raw: &str,
    front: FrontMatter,
    body: String,
) -> NoteDocument {
    let fallback = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("Untitled");
    NoteDocument {
        id: None,
        path: path.to_string_lossy().to_string(),
        // The visible first heading is the canonical note title. Front matter
        // remains for compatibility, but must never mask what the note says.
        title: title_from_body(&body, fallback),
        tags: normalize_tags(front.tags.unwrap_or_default()),
        body,
        updated: modified_seconds(path),
        revision: file_revision(path, raw),
        created: front.created,
        updated_at: front.updated,
    }
}

pub(crate) fn read_note_file(path: &Path) -> Result<NoteDocument, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let (front, body) = split_front_matter(&raw);
    Ok(note_document_from_parts(path, &raw, front, body))
}

fn read_library_note_file(library: &Path, path: &Path) -> Result<NoteDocument, String> {
    let path = existing_library_path(library, path)?;
    let mut note = read_note_file(&path)?;
    note.id = Some(relative_note_id(library, &path)?);
    Ok(note)
}

pub(crate) fn read_library_note_file_for_index(
    library: &Path,
    path: &Path,
) -> Result<(NoteDocument, Option<IndexWarningKind>), IndexWarningKind> {
    let path =
        existing_library_path(library, path).map_err(|_| IndexWarningKind::UnreadableMarkdown)?;
    let raw = fs::read_to_string(&path).map_err(|_| IndexWarningKind::UnreadableMarkdown)?;
    let (front, body, warning) = match split_front_matter_result(&raw) {
        Ok((front, body)) => (front, body, None),
        Err(_) => {
            let (front, body) = split_front_matter(&raw);
            (front, body, Some(IndexWarningKind::InvalidMetadata))
        }
    };
    let mut note = note_document_from_parts(&path, &raw, front, body);
    note.id =
        Some(relative_note_id(library, &path).map_err(|_| IndexWarningKind::UnreadableMarkdown)?);
    Ok((note, warning))
}

pub(crate) fn managed_note(library: &Path, note: NoteDocument) -> Result<NoteDocument, String> {
    read_library_note_file(library, Path::new(&note.path))
}

#[tauri::command]
pub(crate) fn read_note(path: String) -> Result<NoteDocument, String> {
    read_note_file(Path::new(&path))
}

#[tauri::command]
pub(crate) fn create_note(
    library_path: String,
    folder: Option<String>,
) -> Result<NoteDocument, String> {
    let library = canonical_library_root(library_path)?;
    let folder = library_folder(&library, folder)?;
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut index = 0;
    let path = loop {
        let name = if index == 0 {
            "Untitled.md".to_string()
        } else {
            format!("Untitled-{}.md", index)
        };
        let candidate = folder.join(name);
        if !candidate.exists() {
            break candidate;
        }
        index += 1;
    };
    let now = now_rfc3339();
    let content = format!(
        "---\ntitle: Untitled\ncreated: {}\nupdated: {}\n---\n\n# Untitled\n\n",
        now, now
    );
    fs::write(&path, content).map_err(|e| e.to_string())?;
    read_library_note_file(&library, &path)
}

#[tauri::command]
pub(crate) fn create_folder(library_path: String, folder: String) -> Result<String, String> {
    let library = canonical_library_root(library_path)?;
    let destination = library_folder(&library, Some(folder))?;
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    relative_folder_path(&library, &destination)
}

#[tauri::command]
pub(crate) fn rename_folder(
    folder: String,
    name: String,
    library_path: String,
) -> Result<FolderRenameResult, String> {
    let library = canonical_library_root(library_path)?;
    let source = existing_library_path(&library, library_folder(&library, Some(folder))?)?;
    if relative_folder_path(&library, &source)?.is_empty() {
        return Err("Choose a folder inside the selected library".into());
    }
    if source.starts_with(library.join(".markdown-notes")) {
        return Err("Margin's internal storage cannot be renamed".into());
    }
    if !source.is_dir() {
        return Err("Folder no longer exists".into());
    }

    let name = name.trim();
    let path = Path::new(name);
    if name.is_empty()
        || path.is_absolute()
        || !matches!(
            (path.components().next(), path.components().nth(1)),
            (Some(std::path::Component::Normal(_)), None)
        )
        || safe_file_stem(name) != name
    {
        return Err("Folder name must be a single valid folder name".into());
    }

    let parent = source.parent().ok_or("Folder has no parent")?;
    let destination = parent.join(name);
    if destination != source && destination.exists() {
        return Err("A folder with that name already exists".into());
    }

    let paths = WalkDir::new(&source)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        })
        .filter_map(|entry| {
            entry
                .path()
                .strip_prefix(&source)
                .ok()
                .map(|relative| FolderRenamePath {
                    from: entry.path().to_string_lossy().to_string(),
                    to: destination.join(relative).to_string_lossy().to_string(),
                })
        })
        .collect();

    if destination != source {
        fs::rename(&source, &destination).map_err(|error| error.to_string())?;
    }
    Ok(FolderRenameResult {
        folder: relative_folder_path(&library, &destination)?,
        paths,
    })
}

#[tauri::command]
pub(crate) fn restore_note_from_trash(
    path: String,
    library_path: String,
) -> Result<NoteDocument, String> {
    let library = canonical_library_root(library_path)?;
    let source = existing_library_path(&library, path)?;
    let trash = fs::canonicalize(library.join(".markdown-notes").join("trash"))
        .map_err(|_| "Note is not in this library's trash")?;
    if !source.starts_with(&trash) {
        return Err("Note is not in this library's trash".into());
    }
    let relative = source
        .strip_prefix(&trash)
        .map_err(|_| "Note is not in this library's trash")?;
    let requested = library.join(relative);
    let parent = requested.parent().ok_or("Note has no parent folder")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let destination = if requested.exists() {
        unique_path(
            parent,
            requested
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("Untitled"),
        )
    } else {
        requested
    };
    move_note_and_assets(&library, &source, &destination)?;
    read_library_note_file(&library, &destination)
}

#[tauri::command]
pub(crate) fn delete_note_permanently(path: String, library_path: String) -> Result<(), String> {
    let library = canonical_library_root(library_path)?;
    let source = existing_library_path(&library, path)?;
    let trash = fs::canonicalize(library.join(".markdown-notes").join("trash"))
        .map_err(|_| "Only notes in this library's trash can be permanently deleted")?;
    if !source.starts_with(&trash) {
        return Err("Only notes in this library's trash can be permanently deleted".into());
    }
    if !is_markdown_path(&source) {
        return Err("Only Markdown notes can be permanently deleted".into());
    }
    let assets = asset_directory_for_note(&source)?;
    fs::remove_file(&source).map_err(|e| e.to_string())?;
    if assets.exists() {
        fs::remove_dir_all(assets).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn unique_temporary_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note.md");
    let sequence = TEMPORARY_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    path.with_file_name(format!(
        ".{}.margin-{}-{}-{}.tmp",
        file_name,
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        sequence
    ))
}

#[derive(Debug)]
struct LinkRewrite {
    path: PathBuf,
    content: String,
}

#[derive(Debug)]
struct StagedFileUpdate {
    target: PathBuf,
    replacement: PathBuf,
    backup: PathBuf,
    applied: bool,
}

/// Returns the byte offset immediately after YAML front matter, so link repair
/// never alters a note's metadata values.
fn markdown_body_offset(content: &str) -> usize {
    let mut offset = 0;
    let mut first_line = true;
    while offset < content.len() {
        let remaining = &content[offset..];
        let Some(line_end) = remaining.find('\n') else {
            return 0;
        };
        let end = offset + line_end;
        let line = content[offset..end].trim_end_matches('\r');
        if first_line {
            if line != "---" {
                return 0;
            }
            first_line = false;
        } else if line == "---" {
            return end + 1;
        }
        offset = end + 1;
    }
    0
}

fn normalize_relative_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        use std::path::Component;
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn has_safe_relative_markdown_syntax(target: &str) -> bool {
    fn has_uri_scheme(path: &str) -> bool {
        let Some(separator) = path.find(':') else {
            return false;
        };
        let scheme = &path[..separator];
        scheme
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic)
            && scheme
                .as_bytes()
                .iter()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'+' | b'-' | b'.'))
    }

    let path = target.trim();
    !path.is_empty()
        && path == target
        && !path.contains(['#', '?'])
        && !path.starts_with(['/', '\\'])
        && !path.starts_with('<')
        && !path.contains("://")
        && !has_uri_scheme(path)
        && path.get(1..2) != Some(":")
}

fn decode_percent_encoded_path_once(target: &str) -> Option<String> {
    fn hex_value(value: u8) -> Option<u8> {
        match value {
            b'0'..=b'9' => Some(value - b'0'),
            b'a'..=b'f' => Some(value - b'a' + 10),
            b'A'..=b'F' => Some(value - b'A' + 10),
            _ => None,
        }
    }

    let bytes = target.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] == b'%'
            && cursor + 2 < bytes.len()
            && hex_value(bytes[cursor + 1]).is_some()
            && hex_value(bytes[cursor + 2]).is_some()
        {
            decoded.push(hex_value(bytes[cursor + 1])? * 16 + hex_value(bytes[cursor + 2])?);
            cursor += 3;
        } else {
            decoded.push(bytes[cursor]);
            cursor += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

/// Resolves a portable relative Markdown target against a canonical note ID.
/// Percent escapes are decoded once, and a path that climbs above the library
/// root is rejected instead of being lexically folded back into the library.
pub(crate) fn resolve_relative_markdown_target(source_id: &str, target: &str) -> Option<String> {
    if !has_safe_relative_markdown_syntax(target) {
        return None;
    }
    let target = decode_percent_encoded_path_once(target)?;
    if !is_rewritable_relative_markdown_target(&target) {
        return None;
    }

    let source = Path::new(source_id);
    if !is_markdown_path(source) {
        return None;
    }
    let mut resolved = PathBuf::new();
    for component in source
        .parent()?
        .components()
        .chain(Path::new(&target).components())
    {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !resolved.pop() {
                    return None;
                }
            }
            std::path::Component::Normal(value) => resolved.push(value),
            std::path::Component::RootDir | std::path::Component::Prefix(_) => return None,
        }
    }
    is_markdown_path(&resolved).then(|| resolved.to_string_lossy().replace('\\', "/"))
}

pub(crate) fn note_ids_match(left: &str, right: &str) -> bool {
    let left = left.replace('\\', "/");
    let right = right.replace('\\', "/");
    if cfg!(any(target_os = "windows", target_os = "macos")) {
        use unicode_normalization::UnicodeNormalization;
        let left = left.nfc().flat_map(char::to_lowercase).collect::<String>();
        let right = right.nfc().flat_map(char::to_lowercase).collect::<String>();
        left == right
    } else {
        left == right
    }
}

fn relative_markdown_path(from_file: &Path, target: &Path) -> Option<String> {
    let from = from_file.parent()?;
    let from_parts: Vec<_> = from
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value),
            _ => None,
        })
        .collect();
    let target_parts: Vec<_> = target
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value),
            _ => None,
        })
        .collect();
    let shared = from_parts
        .iter()
        .zip(&target_parts)
        .take_while(|(left, right)| left == right)
        .count();
    let mut parts = Vec::new();
    parts.extend(std::iter::repeat_n(
        "..".to_string(),
        from_parts.len() - shared,
    ));
    parts.extend(
        target_parts[shared..]
            .iter()
            .map(|part| part.to_string_lossy().to_string()),
    );
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn is_rewritable_relative_markdown_target(target: &str) -> bool {
    has_safe_relative_markdown_syntax(target) && is_markdown_path(Path::new(target))
}

fn rewrite_markdown_links(body: &str, source: &Path, old_path: &Path, new_path: &Path) -> String {
    let source_parent = match source.parent() {
        Some(parent) => parent,
        None => return body.to_string(),
    };
    let old_path = normalize_relative_path(old_path);
    let mut output = String::with_capacity(body.len());
    let mut fenced = false;

    for line in body.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            output.push_str(line);
            continue;
        }
        if fenced {
            output.push_str(line);
            continue;
        }

        let mut cursor = 0;
        while let Some(marker_offset) = line[cursor..].find("](") {
            let marker = cursor + marker_offset;
            let target_start = marker + 2;
            let Some(close_offset) = line[target_start..].find(')') else {
                break;
            };
            let target_end = target_start + close_offset;
            // Do not alter examples inside inline code. This check is purposely
            // conservative: an unmatched backtick means we leave the link alone.
            if line[..marker].matches('`').count() % 2 != 0 {
                output.push_str(&line[cursor..target_end + 1]);
                cursor = target_end + 1;
                continue;
            }
            let target = &line[target_start..target_end];
            let resolved = normalize_relative_path(&source_parent.join(target));
            if is_rewritable_relative_markdown_target(target) && resolved == old_path {
                if let Some(replacement) = relative_markdown_path(source, new_path) {
                    output.push_str(&line[cursor..target_start]);
                    output.push_str(&replacement);
                    cursor = target_end;
                    continue;
                }
            }
            output.push_str(&line[cursor..target_end]);
            cursor = target_end;
        }
        output.push_str(&line[cursor..]);
    }
    output
}

fn plan_link_rewrites(
    library: &Path,
    old_path: &Path,
    new_path: &Path,
) -> Result<Vec<LinkRewrite>, String> {
    let mut rewrites = Vec::new();
    for entry in WalkDir::new(library)
        .min_depth(1)
        .into_iter()
        .filter_entry(|entry| entry.file_name() != ".markdown-notes")
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().is_file() || !is_markdown_path(entry.path()) {
            continue;
        }
        let content = fs::read_to_string(entry.path()).map_err(|error| error.to_string())?;
        let body_offset = markdown_body_offset(&content);
        let rewritten_body =
            rewrite_markdown_links(&content[body_offset..], entry.path(), old_path, new_path);
        if rewritten_body != content[body_offset..] {
            rewrites.push(LinkRewrite {
                path: entry.path().to_path_buf(),
                content: format!("{}{}", &content[..body_offset], rewritten_body),
            });
        }
    }
    Ok(rewrites)
}

/// Removes a completed transaction's temporary files after every replacement
/// has either committed or been successfully restored.
fn discard_staged_file_updates(updates: &[StagedFileUpdate]) {
    for update in updates {
        let _ = fs::remove_file(&update.replacement);
        let _ = fs::remove_file(&update.backup);
    }
}

/// A failed restore must retain its backup: it is the user's only recoverable
/// copy of the original note. The caller receives that path in the error.
fn cleanup_after_rollback(updates: &[StagedFileUpdate]) {
    for update in updates {
        let _ = fs::remove_file(&update.replacement);
        if !update.applied {
            let _ = fs::remove_file(&update.backup);
        }
    }
}

fn stage_file_updates(rewrites: Vec<LinkRewrite>) -> Result<Vec<StagedFileUpdate>, String> {
    let mut updates = Vec::with_capacity(rewrites.len());
    for rewrite in rewrites {
        let original = match fs::read(&rewrite.path) {
            Ok(content) => content,
            Err(error) => {
                discard_staged_file_updates(&updates);
                return Err(error.to_string());
            }
        };
        let backup = unique_temporary_path(&rewrite.path);
        let replacement = unique_temporary_path(&rewrite.path);
        if let Err(error) =
            fs::write(&backup, original).and_then(|_| fs::write(&replacement, rewrite.content))
        {
            let _ = fs::remove_file(&backup);
            let _ = fs::remove_file(&replacement);
            discard_staged_file_updates(&updates);
            return Err(error.to_string());
        }
        updates.push(StagedFileUpdate {
            target: rewrite.path,
            replacement,
            backup,
            applied: false,
        });
    }
    Ok(updates)
}

fn rollback_staged_file_updates(
    updates: &mut [StagedFileUpdate],
    fail_restore_for_index: Option<usize>,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for index in (0..updates.len()).rev() {
        let update = &mut updates[index];
        if update.applied {
            if fail_restore_for_index == Some(index) {
                errors.push(format!(
                    "Could not restore {}; recovery copy retained at {}",
                    update.target.display(),
                    update.backup.display()
                ));
            } else if let Err(error) = fs::rename(&update.backup, &update.target) {
                errors.push(format!(
                    "Could not restore {}: {}; recovery copy retained at {}",
                    update.target.display(),
                    error,
                    update.backup.display()
                ));
            } else {
                update.applied = false;
            }
        }
    }
    cleanup_after_rollback(updates);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Replacements are all staged before the first file changes. If any commit
/// fails, every already-applied replacement is restored from its same-folder
/// backup before the error reaches the caller.
fn apply_staged_file_updates(
    updates: &mut [StagedFileUpdate],
    fail_before_index: Option<usize>,
    fail_restore_for_index: Option<usize>,
) -> Result<(), String> {
    for index in 0..updates.len() {
        if fail_before_index == Some(index) {
            let rollback = rollback_staged_file_updates(updates, fail_restore_for_index);
            return Err(match rollback {
                Ok(()) => "A staged link repair could not be applied".into(),
                Err(rollback_error) => format!(
                    "A staged link repair could not be applied; rollback failed: {}",
                    rollback_error
                ),
            });
        }
        let result = {
            let update = &mut updates[index];
            fs::rename(&update.replacement, &update.target).map(|()| {
                update.applied = true;
            })
        };
        if let Err(error) = result {
            let rollback = rollback_staged_file_updates(updates, fail_restore_for_index);
            return Err(match rollback {
                Ok(()) => error.to_string(),
                Err(rollback_error) => format!("{}; rollback failed: {}", error, rollback_error),
            });
        }
    }
    Ok(())
}

fn rename_file_safely(source: &Path, destination: &Path) -> Result<(), String> {
    if source == destination {
        return Ok(());
    }
    let case_only = source.parent() == destination.parent()
        && source
            .file_name()
            .zip(destination.file_name())
            .is_some_and(|(left, right)| left != right && left.eq_ignore_ascii_case(right));
    if !case_only {
        return fs::rename(source, destination).map_err(|error| error.to_string());
    }
    let intermediate = unique_temporary_path(source);
    fs::rename(source, &intermediate).map_err(|error| error.to_string())?;
    if let Err(error) = fs::rename(&intermediate, destination) {
        let _ = fs::rename(&intermediate, source);
        return Err(error.to_string());
    }
    Ok(())
}

fn save_note_checked(
    note: NoteDocument,
    library: Option<&Path>,
) -> Result<NoteDocument, SaveNoteFailure> {
    let path = PathBuf::from(&note.path);
    if path.exists() {
        let disk = read_note_file(&path).map_err(SaveNoteFailure::Error)?;
        if note.revision.is_empty() || note.revision != disk.revision {
            return Err(SaveNoteFailure::Conflict(Box::new(disk)));
        }
    } else if !note.revision.is_empty() {
        return Err(SaveNoteFailure::Error(
            "The note no longer exists on disk".into(),
        ));
    }
    let created = note.created.or_else(|| Some(now_rfc3339()));
    let title = title_from_body(&note.body, "Untitled");
    let front = FrontMatter {
        title: Some(title.clone()),
        tags: {
            let tags = normalize_tags(note.tags);
            if tags.is_empty() {
                None
            } else {
                Some(tags)
            }
        },
        created,
        updated: Some(now_rfc3339()),
    };
    let destination = path_for_title(&path, &title).map_err(SaveNoteFailure::Error)?;
    let body = if destination != path {
        rewrite_note_asset_references(&note.body, &path, &destination)
    } else {
        note.body.clone()
    };
    let yaml =
        serde_yaml::to_string(&front).map_err(|error| SaveNoteFailure::Error(error.to_string()))?;
    let content = format!("---\n{}---\n\n{}", yaml, body);
    if destination == path {
        let temporary = unique_temporary_path(&path);
        fs::write(&temporary, content)
            .map_err(|error| SaveNoteFailure::Error(error.to_string()))?;
        fs::rename(&temporary, &path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            SaveNoteFailure::Error(error.to_string())
        })?;
    } else {
        let mut rewrites = match library {
            Some(library) if path.starts_with(library) && destination.starts_with(library) => {
                plan_link_rewrites(library, &path, &destination).map_err(SaveNoteFailure::Error)?
            }
            _ => Vec::new(),
        };
        // Replace the old on-disk source plan with the new note body so self
        // links are repaired without discarding the edit being saved.
        rewrites.retain(|rewrite| rewrite.path != path);
        let source_body_offset = markdown_body_offset(&content);
        let rewritten_source_body =
            rewrite_markdown_links(&content[source_body_offset..], &path, &path, &destination);
        rewrites.push(LinkRewrite {
            path: path.clone(),
            content: format!(
                "{}{}",
                &content[..source_body_offset],
                rewritten_source_body
            ),
        });

        let mut staged = stage_file_updates(rewrites).map_err(SaveNoteFailure::Error)?;
        if let Err(error) = apply_staged_file_updates(&mut staged, None, None) {
            return Err(SaveNoteFailure::Error(error));
        }
        let managed_library =
            library.filter(|root| path.starts_with(root) && destination.starts_with(root));
        let assets_moved = managed_library.is_some_and(|_| {
            asset_directory_for_note(&path).is_ok_and(|directory| directory.exists())
        });
        if assets_moved {
            if let Err(error) = move_note_assets(managed_library.unwrap(), &path, &destination) {
                let rollback = rollback_staged_file_updates(&mut staged, None);
                let message = match rollback {
                    Ok(()) => error,
                    Err(rollback_error) => {
                        format!("{}; rollback failed: {}", error, rollback_error)
                    }
                };
                return Err(SaveNoteFailure::Error(message));
            }
        }
        if let Err(error) = rename_file_safely(&path, &destination) {
            if assets_moved {
                let _ = move_note_assets(managed_library.unwrap(), &destination, &path);
            }
            let rollback = rollback_staged_file_updates(&mut staged, None);
            let message = match rollback {
                Ok(()) => error,
                Err(rollback_error) => format!("{}; rollback failed: {}", error, rollback_error),
            };
            return Err(SaveNoteFailure::Error(message));
        }
        discard_staged_file_updates(&staged);
    }
    let saved = read_note_file(&destination).map_err(SaveNoteFailure::Error)?;
    if let Some(library) = library {
        cleanup_unreferenced_note_assets(library, &destination, &saved.body)
            .map_err(SaveNoteFailure::Error)?;
    }
    Ok(saved)
}

pub(crate) fn save_note_document(note: NoteDocument) -> Result<NoteDocument, String> {
    match save_note_checked(note, None) {
        Ok(saved) => Ok(saved),
        Err(SaveNoteFailure::Conflict(_)) => {
            Err("The note changed on disk before it could be saved".into())
        }
        Err(SaveNoteFailure::Error(message)) => Err(message),
    }
}

#[tauri::command]
pub(crate) fn save_note(note: NoteDocument, library_path: String) -> SaveNoteResult {
    let result = (|| -> Result<NoteDocument, SaveNoteFailure> {
        let library = canonical_library_root(library_path).map_err(SaveNoteFailure::Error)?;
        let path = existing_library_path(&library, &note.path).map_err(SaveNoteFailure::Error)?;
        if !is_markdown_path(&path) {
            return Err(SaveNoteFailure::Error(
                "Only Markdown notes can be saved".into(),
            ));
        }
        let mut note = note;
        note.path = path.to_string_lossy().to_string();
        managed_note(&library, save_note_checked(note, Some(&library))?)
            .map_err(SaveNoteFailure::Error)
    })();
    match result {
        Ok(note) => SaveNoteResult::Saved { note },
        Err(SaveNoteFailure::Conflict(disk)) => SaveNoteResult::Conflict { disk: *disk },
        Err(SaveNoteFailure::Error(message)) => SaveNoteResult::Error { message },
    }
}

#[cfg(test)]
#[tauri::command]
fn rename_note(path: String, name: String, library_path: String) -> Result<NoteDocument, String> {
    let library = canonical_library_root(library_path)?;
    let path = existing_library_path(&library, path)?;
    if !is_markdown_path(&path) {
        return Err("Only Markdown notes can be renamed".into());
    }
    let mut note = read_library_note_file(&library, &path)?;
    note.body = body_with_title(&note.body, name.trim_end_matches(".md").trim());
    let saved = match save_note_checked(note, Some(&library)) {
        Ok(note) => note,
        Err(SaveNoteFailure::Conflict(_)) => {
            return Err("The note changed on disk before it could be saved".into())
        }
        Err(SaveNoteFailure::Error(message)) => return Err(message),
    };
    managed_note(&library, saved)
}

#[tauri::command]
pub(crate) fn duplicate_note(path: String, library_path: String) -> Result<NoteDocument, String> {
    let library = canonical_library_root(library_path)?;
    let source = existing_library_path(&library, path)?;
    if !is_markdown_path(&source) {
        return Err("Only Markdown notes can be duplicated".into());
    }
    let parent = source.parent().ok_or("Note has no parent folder")?;
    let original = read_library_note_file(&library, &source)?;
    let copy_title = format!("{} copy", original.title);
    let destination = unique_path(parent, &copy_title);
    fs::copy(&source, &destination).map_err(|e| e.to_string())?;
    if let Err(error) = copy_note_assets(&library, &source, &destination) {
        let _ = fs::remove_file(&destination);
        return Err(error);
    }
    let mut copy = read_library_note_file(&library, &destination)?;
    copy.body = rewrite_note_asset_references(
        &body_with_title(&copy.body, &copy_title),
        &source,
        &destination,
    );
    let saved = match save_note_checked(copy, Some(&library)) {
        Ok(note) => note,
        Err(error) => {
            let _ = fs::remove_file(&destination);
            if let Ok(assets) = asset_directory_for_note(&destination) {
                let _ = fs::remove_dir_all(assets);
            }
            return match error {
                SaveNoteFailure::Conflict(_) => {
                    Err("The note changed on disk before it could be saved".into())
                }
                SaveNoteFailure::Error(message) => Err(message),
            };
        }
    };
    managed_note(&library, saved)
}

/// Imports a standalone Markdown file as a new note without changing the
/// original. This is used when Margin is selected as the system Markdown
/// opener and the opened file is outside the active library.
#[tauri::command]
pub(crate) fn import_markdown_file(
    source_path: String,
    library_path: String,
    folder: Option<String>,
) -> Result<NoteDocument, String> {
    let source = fs::canonicalize(source_path).map_err(|_| "Choose an existing Markdown file")?;
    if !source.is_file() || !is_markdown_path(&source) {
        return Err("Choose an existing Markdown file".into());
    }
    let library = canonical_library_root(library_path)?;
    if source.starts_with(&library) {
        return read_library_note_file(&library, &source);
    }
    let destination_folder = library_folder(&library, folder)?;
    fs::create_dir_all(&destination_folder).map_err(|error| error.to_string())?;
    let source_note = read_note_file(&source)?;
    let destination = unique_path(&destination_folder, &source_note.title);
    fs::copy(&source, &destination).map_err(|error| error.to_string())?;
    read_library_note_file(&library, &destination)
}

#[tauri::command]
pub(crate) fn move_note_to_folder(
    path: String,
    folder: Option<String>,
    library_path: String,
) -> Result<NoteDocument, String> {
    let library = canonical_library_root(library_path)?;
    let source = existing_library_path(&library, path)?;
    if !source.is_file() || !is_markdown_path(&source) {
        return Err("Note is outside the selected library".into());
    }
    let destination_folder = library_folder(&library, folder)?;
    fs::create_dir_all(&destination_folder).map_err(|error| error.to_string())?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled");
    let requested = destination_folder.join(format!("{}.md", safe_file_stem(stem)));
    let destination = if requested == source {
        requested
    } else if requested.exists() {
        unique_path(&destination_folder, stem)
    } else {
        requested
    };
    if destination != source {
        move_note_and_assets(&library, &source, &destination)?;
    }
    read_library_note_file(&library, &destination)
}

#[tauri::command]
pub(crate) fn reveal_note_in_file_manager(
    app: AppHandle,
    path: String,
    library_path: String,
) -> Result<(), String> {
    let library = canonical_library_root(library_path)?;
    let note = existing_library_path(&library, path)?;
    if !note.is_file() || !is_markdown_path(&note) {
        return Err("Note is outside the selected library".into());
    }
    app.opener()
        .reveal_item_in_dir(&note)
        .map_err(|error| format!("Could not reveal note: {error}"))
}

#[tauri::command]
pub(crate) fn move_note_to_trash(path: String, library_path: String) -> Result<(), String> {
    let library = canonical_library_root(library_path)?;
    let source = existing_library_path(&library, path)?;
    relative_note_id(&library, &source)?;
    let trash = library.join(".markdown-notes").join("trash");
    let relative = source
        .strip_prefix(&library)
        .map_err(|_| "Note is outside the selected library")?;
    let requested = trash.join(relative);
    let parent = requested.parent().ok_or("Note has no parent folder")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let destination = if requested.exists() {
        unique_path(
            parent,
            requested
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("Untitled"),
        )
    } else {
        requested
    };
    move_note_and_assets(&library, &source, &destination)
}

#[tauri::command]
pub(crate) fn move_folder_to_trash(folder: String, library_path: String) -> Result<(), String> {
    if folder.trim().is_empty() {
        return Err("Choose a folder to delete".into());
    }
    let library = canonical_library_root(library_path)?;
    let source = existing_library_path(&library, library_folder(&library, Some(folder))?)?;
    if source.starts_with(library.join(".markdown-notes")) {
        return Err("Margin's internal storage cannot be moved".into());
    }
    if !source.is_dir() {
        return Err("Folder no longer exists".into());
    }
    let relative = source
        .strip_prefix(&library)
        .map_err(|_| "Folder is outside the selected library")?;
    let requested = library.join(".markdown-notes").join("trash").join(relative);
    let parent = requested.parent().ok_or("Folder has no parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let destination = unique_directory_path(&requested)?;
    fs::rename(source, destination).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_staged_file_updates, body_with_title, create_folder, create_note,
        delete_note_permanently, duplicate_note, import_markdown_file, move_folder_to_trash,
        move_note_to_folder, move_note_to_trash, normalize_tags, read_library_note_file,
        read_note_file, rename_file_safely, rename_folder, rename_note, restore_note_from_trash,
        save_note, save_note_document, split_front_matter, stage_file_updates, LinkRewrite,
    };
    #[cfg(unix)]
    use crate::library::load_library;
    use crate::{
        model::SaveNoteResult,
        paths::{
            existing_library_path, library_folder, path_for_title, relative_note_id, safe_file_stem,
        },
        test_support::{copy_example_library, temporary_library},
    };
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    #[test]
    fn metadata_and_portable_filenames_handle_edge_cases() {
        assert_eq!(
            normalize_tags(vec![
                " Work ".into(),
                "work".into(),
                "".into(),
                "\u{00e9}".repeat(65),
                "Planning".into(),
            ]),
            ["Work", "Planning"]
        );
        assert_eq!(safe_file_stem("  plan: launch?  "), "plan- launch-");
        assert_eq!(safe_file_stem("CON"), "Note-CON");
        assert_eq!(safe_file_stem("con.txt"), "Note-con.txt");
        assert_eq!(safe_file_stem("e\u{301}"), "\u{00e9}");
        assert_eq!(safe_file_stem("A\u{0000}B"), "A-B");
        assert_eq!(safe_file_stem("..."), "Untitled");
        let long_name = safe_file_stem(&"\u{00e9}".repeat(200));
        assert!(long_name.len() <= 240);
        assert!(long_name.is_char_boundary(long_name.len()));
        assert_eq!(
            body_with_title("Intro only\n", "Named"),
            "# Named\n\nIntro only\n"
        );
        assert_eq!(body_with_title("# Old\n\nBody", "New"), "# New\n\nBody");

        let raw = "---\r\ntags: [one, two]\r\n---\r\n\r\n# Windows newlines\r\n";
        let (front, body) = split_front_matter(raw);
        assert_eq!(front.tags.unwrap(), ["one", "two"]);
        assert_eq!(body, "# Windows newlines\n");
    }

    #[test]
    fn parses_multiple_tags_and_excludes_separator_blank_line() {
        let raw = "---\ntags:\n  - ideas\n  - product\n---\n\n# A note\n\nBody";
        let (front, body) = split_front_matter(raw);
        assert_eq!(front.tags.unwrap(), vec!["ideas", "product"]);
        assert_eq!(body, "# A note\n\nBody");
    }

    #[test]
    fn preserves_one_intentional_leading_body_newline() {
        let raw = "---\ntitle: Example\n---\n\n\nBody";
        let (_, body) = split_front_matter(raw);
        assert_eq!(body, "\nBody");
    }

    #[test]
    fn note_workflows_keep_titles_and_filenames_together() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let library_path = library.to_string_lossy().to_string();

        let result = (|| -> Result<(), String> {
            let legacy = library.join("legacy.md");
            fs::write(
                &legacy,
                "---\ntitle: Old metadata title\n---\n\n# Actual heading\n",
            )
            .map_err(|error| error.to_string())?;
            assert_eq!(read_note_file(&legacy)?.title, "Actual heading");
            fs::remove_file(&legacy).map_err(|error| error.to_string())?;

            let mut note = create_note(library_path.clone(), None)?;
            assert!(note.path.ends_with("Untitled.md"));

            note.title = "Ignored metadata title".into();
            note.tags = vec!["work".into(), "planning".into()];
            note.body = "# Project plan\n\n- [ ] Start here".into();
            let saved = save_note_document(note)?;
            assert_eq!(saved.title, "Project plan");
            assert!(saved.path.ends_with("Project plan.md"));
            assert!(PathBuf::from(&saved.path).exists());
            assert!(!library.join("Untitled.md").exists());

            let mut same_title = create_note(library_path.clone(), None)?;
            same_title.body = "# Project plan\n".into();
            let collision = save_note_document(same_title)?;
            assert!(collision.path.ends_with("Project plan-1.md"));

            let duplicate = duplicate_note(saved.path.clone(), library_path.clone())?;
            assert_eq!(duplicate.title, "Project plan copy");
            assert!(duplicate.path.ends_with("Project plan copy.md"));

            let renamed = rename_note(
                duplicate.path,
                "Project archive".into(),
                library_path.clone(),
            )?;
            assert_eq!(renamed.title, "Project archive");
            assert!(renamed.path.ends_with("Project archive.md"));

            move_note_to_trash(renamed.path, library_path.clone())?;
            assert!(library
                .join(".markdown-notes")
                .join("trash")
                .join("Project archive.md")
                .exists());

            let indexed = fs::read_dir(&library)
                .map_err(|error| error.to_string())?
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry.path().is_file()
                        && entry
                            .path()
                            .extension()
                            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
                })
                .count();
            assert_eq!(indexed, 2);
            let library_root = fs::canonicalize(&library).map_err(|error| error.to_string())?;
            let project =
                read_library_note_file(&library_root, &library_root.join("Project plan.md"))?;
            assert_eq!(project.title, "Project plan");
            assert_eq!(project.tags, ["work", "planning"]);
            Ok(())
        })();

        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn stale_save_returns_the_external_disk_version() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let result = (|| -> Result<(), String> {
            let mut note = create_note(library_path.clone(), None)?;
            note.body = "# Before\n\nOriginal body\n".into();
            let saved = save_note_document(note)?;
            let mut stale = saved.clone();
            stale.body = "# Mine\n\nUnsaved local change\n".into();
            let saved_modified = fs::metadata(&saved.path)
                .and_then(|metadata| metadata.modified())
                .map_err(|error| error.to_string())?;

            fs::write(&saved.path, "# On disk\n\nExternal change\n")
                .map_err(|error| error.to_string())?;
            fs::OpenOptions::new()
                .write(true)
                .open(&saved.path)
                .and_then(|file| file.set_times(fs::FileTimes::new().set_modified(saved_modified)))
                .map_err(|error| error.to_string())?;

            match save_note(stale, library_path) {
                SaveNoteResult::Conflict { disk } => {
                    assert_eq!(disk.title, "On disk");
                    assert!(disk.body.contains("External change"));
                }
                SaveNoteResult::Saved { .. } => {
                    return Err("stale save overwrote the external change".into());
                }
                SaveNoteResult::Error { message } => return Err(message),
            }
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn folders_are_real_directories_and_trash_restores_them() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let result = (|| -> Result<(), String> {
            assert_eq!(
                create_folder(library_path.clone(), "Work/Planning".into())?,
                "Work/Planning"
            );
            let mut note = create_note(library_path.clone(), Some("Work/Planning".into()))?;
            note.body = "# Sprint\n".into();
            let saved = save_note_document(note)?;
            assert!(
                PathBuf::from(&saved.path)
                    .ends_with(Path::new("Work").join("Planning").join("Sprint.md")),
                "{}",
                saved.path
            );
            assert!(library.join("Work").is_dir());
            assert!(library.join("Work").join("Planning").is_dir());

            let renamed_folder = rename_folder(
                "Work/Planning".into(),
                "Roadmap".into(),
                library_path.clone(),
            )?;
            assert_eq!(renamed_folder.folder, "Work/Roadmap");
            assert_eq!(renamed_folder.paths.len(), 1);
            assert!(PathBuf::from(&renamed_folder.paths[0].to)
                .ends_with(Path::new("Work").join("Roadmap").join("Sprint.md")));
            let saved = read_note_file(Path::new(&renamed_folder.paths[0].to))?;

            assert_eq!(
                create_folder(library_path.clone(), "Inbox".into())?,
                "Inbox"
            );
            let mut inbox_note = create_note(library_path.clone(), Some("Inbox".into()))?;
            inbox_note.body = "# Triage item\n".into();
            save_note_document(inbox_note)?;
            let renamed_top_level =
                rename_folder("Inbox".into(), "Triage".into(), library_path.clone())?;
            assert_eq!(renamed_top_level.folder, "Triage");
            assert_eq!(renamed_top_level.paths.len(), 1);
            assert!(Path::new(&renamed_top_level.paths[0].to)
                .ends_with(Path::new("Triage").join("Triage item.md")));

            move_note_to_trash(saved.path, library_path.clone())?;
            let trashed_path = library
                .join(".markdown-notes")
                .join("trash")
                .join("Work")
                .join("Roadmap")
                .join("Sprint.md");
            assert!(trashed_path.exists());
            let trashed_path =
                fs::canonicalize(&trashed_path).map_err(|error| error.to_string())?;
            let restored = restore_note_from_trash(
                trashed_path.to_string_lossy().to_string(),
                library_path.clone(),
            )?;
            assert!(
                PathBuf::from(&restored.path)
                    .ends_with(Path::new("Work").join("Roadmap").join("Sprint.md")),
                "{}",
                restored.path
            );
            move_note_to_trash(restored.path, library_path.clone())?;
            assert!(trashed_path.exists());
            let trashed_path =
                fs::canonicalize(&trashed_path).map_err(|error| error.to_string())?;
            delete_note_permanently(
                trashed_path.to_string_lossy().to_string(),
                library_path.clone(),
            )?;
            assert!(!trashed_path.exists());

            create_folder(library_path.clone(), "Archive/Completed".into())?;
            let mut archived = create_note(library_path.clone(), Some("Archive/Completed".into()))?;
            archived.body = "# Completed work\n".into();
            save_note_document(archived)?;
            move_folder_to_trash("Archive".into(), library_path.clone())?;
            assert!(!library.join("Archive").exists());
            assert!(library
                .join(".markdown-notes")
                .join("trash")
                .join("Archive")
                .join("Completed")
                .join("Completed work.md")
                .exists());
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn filename_renames_repair_only_unambiguous_relative_markdown_links() {
        let library = temporary_library();
        fs::create_dir_all(library.join("Projects")).unwrap();
        fs::create_dir_all(library.join("Reference")).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let old_path = library.join("Projects").join("Old title.md");
        let links_path = library.join("Reference").join("Links.md");
        let result = (|| -> Result<(), String> {
            fs::write(
                &old_path,
                "---\ntags: [project]\n---\n\n# Old title\n\n[self](Old title.md)\n",
            )
            .map_err(|error| error.to_string())?;
            let links_source = "---\r\nlink: ../Projects/Old title.md\r\n---\r\n\r\n# Links\r\n\r\n[relative](../Projects/Old title.md)\r\n[external](https://example.com/Old title.md)\r\n[anchor](../Projects/Old title.md#part)\r\n[absolute](/Projects/Old title.md)\r\n[missing](../Projects/Missing.md)\r\n`[code](../Projects/Old title.md)`\r\n";
            fs::write(&links_path, links_source).map_err(|error| error.to_string())?;

            let canonical_old_path =
                fs::canonicalize(&old_path).map_err(|error| error.to_string())?;
            let mut note = read_note_file(&canonical_old_path)?;
            note.body = "# New title\n\n[self](Old title.md)\n".into();
            let saved = match save_note(note, library_path.clone()) {
                SaveNoteResult::Saved { note } => note,
                SaveNoteResult::Conflict { .. } => return Err("unexpected save conflict".into()),
                SaveNoteResult::Error { message } => return Err(message),
            };
            assert!(saved.path.ends_with("New title.md"));
            assert!(!old_path.exists());

            let renamed = fs::read_to_string(&saved.path).map_err(|error| error.to_string())?;
            assert!(renamed.contains("[self](New title.md)"));
            let links = fs::read_to_string(&links_path).map_err(|error| error.to_string())?;
            assert!(links.starts_with("---\r\nlink: ../Projects/Old title.md\r\n---\r\n\r\n"));
            assert!(links.contains("[relative](../Projects/New title.md)"));
            assert!(links.contains("[external](https://example.com/Old title.md)"));
            assert!(links.contains("[anchor](../Projects/Old title.md#part)"));
            assert!(links.contains("[absolute](/Projects/Old title.md)"));
            assert!(links.contains("[missing](../Projects/Missing.md)"));
            assert!(links.contains("`[code](../Projects/Old title.md)`"));
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn filename_renames_repair_relative_markdown_extension_links() {
        let library = temporary_library();
        fs::create_dir_all(library.join("Projects")).unwrap();
        fs::create_dir_all(library.join("Reference")).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let old_path = library.join("Projects").join("Old title.markdown");
        let links_path = library.join("Reference").join("Links.markdown");
        let result = (|| -> Result<(), String> {
            fs::write(&old_path, "# Old title\n\n[self](Old title.markdown)\n")
                .map_err(|error| error.to_string())?;
            fs::write(
                &links_path,
                "# Links\n\n[relative](../Projects/Old title.markdown)\n",
            )
            .map_err(|error| error.to_string())?;

            let canonical_old_path =
                fs::canonicalize(&old_path).map_err(|error| error.to_string())?;
            let mut note = read_note_file(&canonical_old_path)?;
            note.body = "# New title\n\n[self](Old title.markdown)\n".into();
            let saved = match save_note(note, library_path.clone()) {
                SaveNoteResult::Saved { note } => note,
                SaveNoteResult::Conflict { .. } => return Err("unexpected save conflict".into()),
                SaveNoteResult::Error { message } => return Err(message),
            };
            assert!(saved.path.ends_with("New title.md"));
            assert!(!old_path.exists());

            let renamed = fs::read_to_string(&saved.path).map_err(|error| error.to_string())?;
            assert!(renamed.contains("[self](New title.md)"));
            let links = fs::read_to_string(&links_path).map_err(|error| error.to_string())?;
            assert!(links.contains("[relative](../Projects/New title.md)"));
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn explicit_renames_repair_relative_markdown_links() {
        let library = temporary_library();
        fs::create_dir_all(library.join("Projects")).unwrap();
        fs::create_dir_all(library.join("Reference")).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let old_path = library.join("Projects").join("Old title.md");
        let links_path = library.join("Reference").join("Links.md");
        let result = (|| -> Result<(), String> {
            fs::write(&old_path, "# Old title\n").map_err(|error| error.to_string())?;
            fs::write(
                &links_path,
                "# Links\n\n[relative](../Projects/Old title.md)\n",
            )
            .map_err(|error| error.to_string())?;
            let canonical_old_path =
                fs::canonicalize(&old_path).map_err(|error| error.to_string())?;

            let renamed = rename_note(
                canonical_old_path.to_string_lossy().to_string(),
                "New title".into(),
                library_path,
            )?;
            assert!(renamed.path.ends_with("New title.md"));
            assert!(!old_path.exists());
            let links = fs::read_to_string(&links_path).map_err(|error| error.to_string())?;
            assert!(links.contains("[relative](../Projects/New title.md)"));
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn staged_link_repair_failure_rolls_back_every_previously_written_file() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let first = library.join("First.md");
        let second = library.join("Second.md");
        fs::write(&first, "# First\noriginal\n").unwrap();
        fs::write(&second, "# Second\noriginal\n").unwrap();

        let result = (|| -> Result<(), String> {
            let mut staged = stage_file_updates(vec![
                LinkRewrite {
                    path: first.clone(),
                    content: "# First\nrewritten\n".into(),
                },
                LinkRewrite {
                    path: second.clone(),
                    content: "# Second\nrewritten\n".into(),
                },
            ])?;
            // Simulate a failure after the first atomic replacement. The helper
            // must restore that write before reporting the error.
            assert!(apply_staged_file_updates(&mut staged, Some(1), None).is_err());
            assert_eq!(
                fs::read_to_string(&first).map_err(|error| error.to_string())?,
                "# First\noriginal\n"
            );
            assert_eq!(
                fs::read_to_string(&second).map_err(|error| error.to_string())?,
                "# Second\noriginal\n"
            );
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn failed_link_repair_rollback_retains_the_recovery_copy() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let first = library.join("First.md");
        let second = library.join("Second.md");
        fs::write(&first, "# First\noriginal\n").unwrap();
        fs::write(&second, "# Second\noriginal\n").unwrap();

        let result = (|| -> Result<(), String> {
            let mut staged = stage_file_updates(vec![
                LinkRewrite {
                    path: first.clone(),
                    content: "# First\nrewritten\n".into(),
                },
                LinkRewrite {
                    path: second.clone(),
                    content: "# Second\nrewritten\n".into(),
                },
            ])?;
            let recovery_copy = staged[0].backup.clone();

            // Simulate a failure after the first replacement and an inability
            // to restore it. The original content must remain recoverable.
            let error = apply_staged_file_updates(&mut staged, Some(1), Some(0))
                .expect_err("the simulated rollback must fail");
            assert!(error.contains(recovery_copy.to_string_lossy().as_ref()));
            assert_eq!(
                fs::read_to_string(&first).map_err(|error| error.to_string())?,
                "# First\nrewritten\n"
            );
            assert_eq!(
                fs::read_to_string(&recovery_copy).map_err(|error| error.to_string())?,
                "# First\noriginal\n"
            );
            assert_eq!(
                fs::read_to_string(&second).map_err(|error| error.to_string())?,
                "# Second\noriginal\n"
            );
            fs::remove_file(&recovery_copy).map_err(|error| error.to_string())?;
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn case_only_filename_renames_keep_the_requested_spelling() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let source = library.join("case.md");
        fs::write(&source, "# case\n").unwrap();
        let result = (|| -> Result<(), String> {
            let destination = path_for_title(&source, "Case")?;
            rename_file_safely(&source, &destination)?;
            assert!(destination.exists());
            assert_eq!(
                destination.file_name().and_then(|name| name.to_str()),
                Some("Case.md")
            );
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn file_operations_reject_paths_outside_the_selected_library() {
        let library = temporary_library();
        let outside = temporary_library();
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let outside_note = outside.join("Outside.md");
        fs::write(&outside_note, "# Outside\n").unwrap();
        let inside_note = library.join("Inside.md");
        fs::write(&inside_note, "# Inside\n").unwrap();

        assert!(library_folder(&library, Some("../outside".into())).is_err());
        assert!(library_folder(&library, Some(outside.to_string_lossy().to_string())).is_err());
        assert!(create_folder(library_path.clone(), "../outside".into()).is_err());
        assert!(move_note_to_folder(
            outside_note.to_string_lossy().to_string(),
            None,
            library_path.clone()
        )
        .is_err());
        assert!(move_note_to_trash(
            outside_note.to_string_lossy().to_string(),
            library_path.clone()
        )
        .is_err());
        assert!(restore_note_from_trash(
            inside_note.to_string_lossy().to_string(),
            library_path.clone()
        )
        .is_err());
        let mut outside_document = read_note_file(&outside_note).unwrap();
        outside_document.body = "# Attempted external write\n".into();
        assert!(matches!(
            save_note(outside_document, library_path.clone()),
            SaveNoteResult::Error { .. }
        ));
        assert!(rename_note(
            outside_note.to_string_lossy().to_string(),
            "Renamed outside".into(),
            library_path.clone(),
        )
        .is_err());
        assert!(duplicate_note(
            outside_note.to_string_lossy().to_string(),
            library_path.clone(),
        )
        .is_err());
        assert!(
            delete_note_permanently(inside_note.to_string_lossy().to_string(), library_path)
                .is_err()
        );

        fs::remove_dir_all(&library).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn permanently_deletes_markdown_extension_notes() {
        let library = temporary_library();
        let trash = library.join(".markdown-notes").join("trash");
        fs::create_dir_all(&trash).unwrap();
        let note = trash.join("Legacy.markdown");
        fs::write(&note, "# Legacy\n").unwrap();
        let note_path = fs::canonicalize(&note).unwrap();

        delete_note_permanently(
            note_path.to_string_lossy().to_string(),
            library.to_string_lossy().to_string(),
        )
        .unwrap();
        assert!(!note.exists());

        fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn managed_notes_have_canonical_relative_ids_and_reject_escaped_paths() {
        let library = temporary_library();
        let outside = temporary_library();
        fs::create_dir_all(library.join("Work")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let note = library.join("Work").join("Plan.md");
        let escaped = outside.join("Outside.md");
        fs::write(&note, "# Plan\n").unwrap();
        fs::write(&escaped, "# Outside\n").unwrap();

        let root = fs::canonicalize(&library).unwrap();
        let note = fs::canonicalize(&note).unwrap();
        assert_eq!(relative_note_id(&root, &note).unwrap(), "Work/Plan.md");
        assert_eq!(
            read_library_note_file(&root, &note).unwrap().id.as_deref(),
            Some("Work/Plan.md")
        );
        assert!(existing_library_path(&root, &escaped).is_err());

        fs::remove_dir_all(&library).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[cfg(unix)]
    #[test]
    fn managed_operations_reject_symlinks_inside_libraries() {
        use std::os::unix::fs::symlink;

        let library = temporary_library();
        let outside = temporary_library();
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let target = outside.join("Outside.md");
        fs::write(&target, "# Outside\n").unwrap();
        let link = library.join("Linked.md");
        symlink(&target, &link).unwrap();

        let root = fs::canonicalize(&library).unwrap();
        assert!(existing_library_path(&root, &link).is_err());
        assert!(load_library(root.to_string_lossy().to_string())
            .unwrap()
            .is_empty());

        fs::remove_dir_all(&library).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn move_and_restore_disambiguate_existing_destinations() {
        let library = copy_example_library().unwrap();
        let library_path = library.to_string_lossy().to_string();
        let result = (|| -> Result<(), String> {
            let mut duplicate = create_note(library_path.clone(), Some("Personal".into()))?;
            duplicate.body = "# Project Alpha\n".into();
            let duplicate = save_note_document(duplicate)?;
            let moved =
                move_note_to_folder(duplicate.path, Some("Work".into()), library_path.clone())?;
            assert!(moved.path.ends_with("Project Alpha-1.md"));

            fs::write(library.join("Deleted note.md"), "# Existing deletion\n")
                .map_err(|error| error.to_string())?;
            let trashed = library
                .join(".markdown-notes")
                .join("trash")
                .join("Deleted note.md");
            let trashed = fs::canonicalize(trashed).map_err(|error| error.to_string())?;
            let restored =
                restore_note_from_trash(trashed.to_string_lossy().to_string(), library_path)?;
            assert!(restored.path.ends_with("Deleted note-1.md"));
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn importing_an_opened_markdown_file_preserves_the_source() {
        let library = temporary_library();
        let outside = temporary_library();
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let source = outside.join("Outside.markdown");
        fs::write(&source, "# Imported source\n\nKeep the original untouched.").unwrap();

        let imported = import_markdown_file(
            source.to_string_lossy().to_string(),
            library.to_string_lossy().to_string(),
            Some("Inbox".into()),
        )
        .unwrap();
        assert!(Path::new(&imported.path).ends_with(Path::new("Inbox").join("Imported source.md")));
        assert_eq!(
            fs::read_to_string(&source).unwrap(),
            "# Imported source\n\nKeep the original untouched."
        );
        assert!(import_markdown_file(
            outside
                .join("not-markdown.txt")
                .to_string_lossy()
                .to_string(),
            library.to_string_lossy().to_string(),
            None,
        )
        .is_err());

        fs::remove_dir_all(&library).ok();
        fs::remove_dir_all(&outside).ok();
    }
}
