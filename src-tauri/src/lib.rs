use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{window::Color, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use walkdir::WalkDir;

/// The active capture shortcut is kept in the native process so it remains
/// available when every webview is backgrounded.
struct CaptureShortcut(Mutex<CaptureShortcutState>);

struct CaptureShortcutState {
    shortcut: Shortcut,
    registered: bool,
}

fn default_capture_shortcut() -> Shortcut {
    #[cfg(target_os = "macos")]
    let modifiers = Modifiers::SUPER | Modifiers::ALT | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let modifiers = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT;
    Shortcut::new(Some(modifiers), Code::Space)
}

fn show_capture_window(app: &AppHandle) -> Result<(), String> {
    let capture = app
        .get_webview_window("capture")
        .ok_or("Quick capture window is unavailable")?;
    // Start the capture window on the display where Margin was last being
    // used, rather than always falling back to the primary display.
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(main_position), Ok(main_size), Ok(capture_size)) = (
            main.outer_position(),
            main.outer_size(),
            capture.outer_size(),
        ) {
            let x = main_position.x + (main_size.width as i32 - capture_size.width as i32) / 2;
            let y = main_position.y + (main_size.height as i32 - capture_size.height as i32) / 2;
            let _ = capture.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
    // `show` does not necessarily restore a minimized native window on
    // Windows. Explicitly restore the capture surface before focusing it.
    capture.unminimize().map_err(|error| error.to_string())?;
    capture.show().map_err(|error| error.to_string())?;
    capture.set_focus().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Margin window is unavailable")?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())
}

fn selected_library_file(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("selected-library.txt"))
}

#[tauri::command]
fn show_quick_capture(app: AppHandle) -> Result<(), String> {
    show_capture_window(&app)
}

#[tauri::command]
async fn hide_quick_capture(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("capture")
        .ok_or("Quick capture window is unavailable")?
        .hide()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_selected_library(app: AppHandle, library_path: String) -> Result<(), String> {
    let library = PathBuf::from(library_path.trim());
    if !library.is_dir() {
        return Err("Choose an existing notes folder".into());
    }
    fs::write(
        selected_library_file(&app)?,
        library.to_string_lossy().as_bytes(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_selected_library(app: AppHandle) -> Result<Option<String>, String> {
    let path = selected_library_file(&app)?;
    match fs::read_to_string(path) {
        Ok(value) => {
            let library = PathBuf::from(value.trim());
            Ok(library
                .is_dir()
                .then(|| library.to_string_lossy().to_string()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Replaces the capture shortcut without ever leaving the previous working
/// shortcut unregistered when the requested binding is already claimed.
#[tauri::command]
async fn configure_quick_capture_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    let requested: Shortcut = shortcut
        .parse()
        .map_err(|error| format!("Invalid quick-capture shortcut: {error}"))?;
    let state = app.state::<CaptureShortcut>();
    let mut active = state
        .0
        .lock()
        .map_err(|_| "Quick-capture shortcut state is unavailable")?;
    if active.shortcut == requested && active.registered {
        return Ok(());
    }
    if !active.registered {
        app.global_shortcut()
            .register(requested)
            .map_err(|error| error.to_string())?;
        active.shortcut = requested;
        active.registered = true;
        return Ok(());
    }
    app.global_shortcut()
        .register(requested)
        .map_err(|error| error.to_string())?;
    if let Err(error) = app.global_shortcut().unregister(active.shortcut) {
        let _ = app.global_shortcut().unregister(requested);
        return Err(error.to_string());
    }
    active.shortcut = requested;
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
struct NoteSummary {
    path: String,
    title: String,
    tags: Vec<String>,
    updated: u64,
    searchable_text: String,
    excerpt: String,
    folder: String,
}

#[derive(Serialize)]
struct FolderRenamePath {
    from: String,
    to: String,
}

#[derive(Serialize)]
struct FolderRenameResult {
    folder: String,
    paths: Vec<FolderRenamePath>,
}

fn folder_for_path(library: &Path, path: &Path) -> String {
    path.parent()
        .and_then(|parent| parent.strip_prefix(library).ok())
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// Returns the path of a directory itself relative to the selected library.
/// `folder_for_path` intentionally returns a note's parent, so it must not be
/// used for a folder: doing so turns `Work/Planning` into just `Work` and makes
/// a top-level folder look like the library root.
fn relative_folder_path(library: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(library)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "Folder is outside the selected library".into())
}

/// Converts an app-provided folder name into a path that is guaranteed to stay
/// inside the selected library. Notes stay ordinary files in these folders.
fn library_folder(library: &Path, folder: Option<String>) -> Result<PathBuf, String> {
    let Some(folder) = folder else {
        return Ok(library.to_path_buf());
    };
    let folder = folder.trim();
    if folder.is_empty() {
        return Ok(library.to_path_buf());
    }
    let candidate = Path::new(folder);
    if candidate.is_absolute()
        || candidate.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err("Folder must be inside the selected library".into());
    }
    Ok(library.join(candidate))
}

#[derive(Clone, Serialize, Deserialize)]
struct NoteDocument {
    path: String,
    title: String,
    tags: Vec<String>,
    body: String,
    updated: u64,
    revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

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

fn file_revision(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}

fn now_rfc3339() -> String {
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

fn split_front_matter(raw: &str) -> (FrontMatter, String) {
    let normalized = raw.replace("\r\n", "\n");
    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some((yaml, body)) = rest.split_once("\n---\n") {
            // The blank line after front matter is a file-format separator, not
            // part of the note body. Consuming it prevents autosave from
            // accumulating one more leading blank line on every write.
            return (
                serde_yaml::from_str(yaml).unwrap_or_default(),
                body.strip_prefix('\n').unwrap_or(body).to_string(),
            );
        }
    }
    (FrontMatter::default(), normalized)
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

fn body_with_title(body: &str, title: &str) -> String {
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

fn note_excerpt(body: &str) -> String {
    body.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with("```"))
        .map(|line| {
            line.trim_start_matches(|character: char| matches!(character, '>' | '-' | '*' | ' '))
                .trim()
        })
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(180)
        .collect()
}

fn read_note_file(path: &Path) -> Result<NoteDocument, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let (front, body) = split_front_matter(&raw);
    let fallback = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("Untitled");
    Ok(NoteDocument {
        path: path.to_string_lossy().to_string(),
        // The visible first heading is the canonical note title. Front matter
        // remains for compatibility, but must never mask what the note says.
        title: title_from_body(&body, fallback),
        tags: normalize_tags(front.tags.unwrap_or_default()),
        body,
        updated: modified_seconds(path),
        revision: file_revision(path),
        created: front.created,
        updated_at: front.updated,
    })
}

#[tauri::command]
fn load_library(library_path: String) -> Result<Vec<NoteSummary>, String> {
    let library = PathBuf::from(&library_path);
    let mut notes = WalkDir::new(library_path)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && !entry
                    .path()
                    .components()
                    .any(|part| part.as_os_str() == ".markdown-notes")
                && entry
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        })
        .filter_map(|entry| read_note_file(entry.path()).ok())
        .map(|note| {
            let folder = folder_for_path(&library, Path::new(&note.path));
            NoteSummary {
                searchable_text: format!(
                    "{} {} {} {}",
                    note.title,
                    Path::new(&note.path)
                        .file_name()
                        .and_then(|v| v.to_str())
                        .unwrap_or(""),
                    note.tags.join(" "),
                    note.body
                )
                .to_lowercase(),
                excerpt: note_excerpt(&note.body),
                path: note.path,
                title: note.title,
                tags: note.tags,
                updated: note.updated,
                folder,
            }
        })
        .collect::<Vec<_>>();
    notes.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(notes)
}

#[tauri::command]
fn read_note(path: String) -> Result<NoteDocument, String> {
    read_note_file(Path::new(&path))
}

#[tauri::command]
fn create_note(library_path: String, folder: Option<String>) -> Result<NoteDocument, String> {
    let library = PathBuf::from(library_path);
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
    read_note_file(&path)
}

#[tauri::command]
fn create_folder(library_path: String, folder: String) -> Result<String, String> {
    let library = PathBuf::from(library_path);
    let destination = library_folder(&library, Some(folder))?;
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    relative_folder_path(&library, &destination)
}

#[tauri::command]
fn rename_folder(
    folder: String,
    name: String,
    library_path: String,
) -> Result<FolderRenameResult, String> {
    let library = PathBuf::from(library_path);
    let source = library_folder(&library, Some(folder))?;
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
fn load_folders(library_path: String) -> Result<Vec<String>, String> {
    let library = PathBuf::from(&library_path);
    if !library.exists() {
        return Ok(Vec::new());
    }
    let mut folders = WalkDir::new(&library)
        .min_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_dir()
                && !entry
                    .path()
                    .components()
                    .any(|part| part.as_os_str() == ".markdown-notes")
        })
        .map(|entry| {
            entry
                .path()
                .strip_prefix(&library)
                .map(|relative| relative.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default()
        })
        .filter(|folder| !folder.is_empty())
        .collect::<Vec<_>>();
    folders.sort_by_key(|folder| folder.to_lowercase());
    Ok(folders)
}

#[tauri::command]
fn load_trash(library_path: String) -> Result<Vec<NoteSummary>, String> {
    let library = PathBuf::from(library_path);
    let trash = library.join(".markdown-notes").join("trash");
    if !trash.exists() {
        return Ok(Vec::new());
    }
    let mut notes = WalkDir::new(&trash)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        })
        .filter_map(|entry| read_note_file(entry.path()).ok())
        .map(|note| NoteSummary {
            searchable_text: format!("{} {} {}", note.title, note.tags.join(" "), note.body)
                .to_lowercase(),
            excerpt: note_excerpt(&note.body),
            path: note.path,
            title: note.title,
            tags: note.tags,
            updated: note.updated,
            folder: "Trash".into(),
        })
        .collect::<Vec<_>>();
    notes.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(notes)
}

#[tauri::command]
fn restore_note_from_trash(path: String, library_path: String) -> Result<NoteDocument, String> {
    let source = PathBuf::from(&path);
    let library = PathBuf::from(library_path);
    let trash = library.join(".markdown-notes").join("trash");
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
    fs::rename(source, &destination).map_err(|e| e.to_string())?;
    read_note_file(&destination)
}

#[tauri::command]
fn delete_note_permanently(path: String, library_path: String) -> Result<(), String> {
    let source = PathBuf::from(path);
    let trash = PathBuf::from(library_path)
        .join(".markdown-notes")
        .join("trash");
    if !source.starts_with(&trash) {
        return Err("Only notes in this library's trash can be permanently deleted".into());
    }
    if !source
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
    {
        return Err("Only Markdown notes can be permanently deleted".into());
    }
    fs::remove_file(source).map_err(|e| e.to_string())
}

#[tauri::command]
fn append_quick_note(library_path: String, text: String) -> Result<NoteDocument, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Quick note cannot be empty".into());
    }
    let library = PathBuf::from(library_path);
    let date = Local::now().format("%Y-%m-%d").to_string();
    let time = Local::now().format("%H:%M").to_string();
    let folder = library.join("Daily");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!("{}.md", date));
    let mut note = if path.exists() {
        read_note_file(&path)?
    } else {
        NoteDocument {
            path: path.to_string_lossy().to_string(),
            title: date.clone(),
            tags: Vec::new(),
            body: format!("# {}\n", date),
            updated: 0,
            revision: String::new(),
            created: Some(now_rfc3339()),
            updated_at: None,
        }
    };
    note.body = format!("{}\n\n## {}\n\n{}\n", note.body.trim_end(), time, text);
    save_note(note)
}

#[tauri::command]
fn import_daily_note(
    source_path: String,
    target_path: String,
    library_path: String,
) -> Result<NoteDocument, String> {
    let library = PathBuf::from(library_path);
    let source = PathBuf::from(&source_path);
    let target = PathBuf::from(&target_path);
    if !source.starts_with(library.join("Daily")) || !target.starts_with(&library) {
        return Err("Quick-note import must stay inside the selected library".into());
    }
    let source_note = read_note_file(&source)?;
    let mut target_note = read_note_file(&target)?;
    let entries = source_note
        .body
        .lines()
        .skip_while(|line| !line.starts_with("# "))
        .skip(1)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if entries.is_empty() {
        return Err("This daily note has no captures to import".into());
    }
    target_note.body = format!(
        "{}\n\n## {}\n\n{}\n",
        target_note.body.trim_end(),
        source_note.title,
        entries
    );
    save_note(target_note)
}

#[tauri::command]
fn import_daily_note_to_new_note(
    source_path: String,
    folder: Option<String>,
    title: String,
    library_path: String,
) -> Result<NoteDocument, String> {
    let library = PathBuf::from(library_path);
    let source = PathBuf::from(&source_path);
    if !source.starts_with(library.join("Daily")) {
        return Err("Quick-note import must come from this library's Daily folder".into());
    }
    let source_note = read_note_file(&source)?;
    let entries = source_note
        .body
        .lines()
        .skip_while(|line| !line.starts_with("# "))
        .skip(1)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if entries.is_empty() {
        return Err("This daily note has no captures to import".into());
    }
    let title = title.trim();
    let title = if title.is_empty() {
        format!("{} captures", source_note.title)
    } else {
        title.to_string()
    };
    let destination_folder = library_folder(&library, folder)?;
    fs::create_dir_all(&destination_folder).map_err(|error| error.to_string())?;
    let destination = unique_path(&destination_folder, &title);
    save_note(NoteDocument {
        path: destination.to_string_lossy().to_string(),
        title: title.clone(),
        tags: Vec::new(),
        body: format!("# {}\n\n## {}\n\n{}\n", title, source_note.title, entries),
        updated: 0,
        revision: String::new(),
        created: Some(now_rfc3339()),
        updated_at: None,
    })
}

#[tauri::command]
fn save_note(note: NoteDocument) -> Result<NoteDocument, String> {
    let path = PathBuf::from(&note.path);
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
    let yaml = serde_yaml::to_string(&front).map_err(|e| e.to_string())?;
    let content = format!("---\n{}---\n\n{}", yaml, note.body);
    let temporary = path.with_extension("md.tmp");
    fs::write(&temporary, content).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
    let destination = path_for_title(&path, &title)?;
    if destination != path {
        fs::rename(&path, &destination).map_err(|e| e.to_string())?;
    }
    read_note_file(&destination)
}

fn unique_path(parent: &Path, stem: &str) -> PathBuf {
    let safe_stem = safe_file_stem(stem);
    let base = if safe_stem.is_empty() {
        "Untitled"
    } else {
        &safe_stem
    };
    let mut number = 0;
    loop {
        let suffix = if number == 0 {
            String::new()
        } else {
            format!("-{}", number)
        };
        let candidate = parent.join(format!("{}{}.md", base, suffix));
        if !candidate.exists() {
            return candidate;
        }
        number += 1;
    }
}

/// Produces a portable filename stem while retaining the note title everywhere
/// the filesystem permits it. Windows reserves a small set of device names and
/// forbids a few characters, so those cases receive a readable safe fallback.
fn safe_file_stem(title: &str) -> String {
    let cleaned = title
        .trim()
        .trim_matches(['.', ' '])
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-");
    let fallback = if cleaned.is_empty() {
        "Untitled"
    } else {
        &cleaned
    };
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved
        .iter()
        .any(|name| fallback.eq_ignore_ascii_case(name))
    {
        format!("Note-{}", fallback)
    } else {
        fallback.to_string()
    }
}

fn path_for_title(source: &Path, title: &str) -> Result<PathBuf, String> {
    let parent = source.parent().ok_or("Note has no parent folder")?;
    let stem = safe_file_stem(title);
    if source
        .file_stem()
        .and_then(|value| value.to_str())
        .is_some_and(|current| current == stem)
    {
        Ok(source.to_path_buf())
    } else {
        Ok(unique_path(parent, &stem))
    }
}

#[tauri::command]
fn rename_note(path: String, name: String) -> Result<NoteDocument, String> {
    let mut note = read_note_file(Path::new(&path))?;
    note.body = body_with_title(&note.body, name.trim_end_matches(".md").trim());
    save_note(note)
}

#[tauri::command]
fn duplicate_note(path: String) -> Result<NoteDocument, String> {
    let source = PathBuf::from(path);
    let parent = source.parent().ok_or("Note has no parent folder")?;
    let original = read_note_file(&source)?;
    let copy_title = format!("{} copy", original.title);
    let destination = unique_path(parent, &copy_title);
    fs::copy(source, &destination).map_err(|e| e.to_string())?;
    let mut copy = read_note_file(&destination)?;
    copy.body = body_with_title(&copy.body, &copy_title);
    save_note(copy)
}

#[tauri::command]
fn move_note_to_folder(
    path: String,
    folder: Option<String>,
    library_path: String,
) -> Result<NoteDocument, String> {
    let source = PathBuf::from(path);
    let library = PathBuf::from(library_path);
    if !source.is_file() || !source.starts_with(&library) {
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
        fs::rename(&source, &destination).map_err(|error| error.to_string())?;
    }
    read_note_file(&destination)
}

#[tauri::command]
fn reveal_note_in_file_manager(path: String, library_path: String) -> Result<(), String> {
    let note = PathBuf::from(path);
    let library = PathBuf::from(library_path);
    if !note.is_file() || !note.starts_with(&library) {
        return Err("Note is outside the selected library".into());
    }
    #[cfg(target_os = "macos")]
    let command = Command::new("open").arg("-R").arg(&note).spawn();
    #[cfg(target_os = "windows")]
    let command = Command::new("explorer.exe")
        .arg(format!("/select,{}", note.to_string_lossy()))
        .spawn();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let command = Command::new("xdg-open")
        .arg(note.parent().ok_or("Note has no parent folder")?)
        .spawn();
    command.map(|_| ()).map_err(|error| error.to_string())
}

#[tauri::command]
fn move_note_to_trash(path: String, library_path: String) -> Result<(), String> {
    let source = PathBuf::from(path);
    let library = PathBuf::from(library_path);
    if !source.starts_with(&library) {
        return Err("Note is outside the selected library".into());
    }
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
    fs::rename(source, destination).map_err(|e| e.to_string())
}

fn unique_directory_path(requested: &Path) -> Result<PathBuf, String> {
    if !requested.exists() {
        return Ok(requested.to_path_buf());
    }
    let parent = requested.parent().ok_or("Folder has no parent")?;
    let stem = requested
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Folder name is invalid")?;
    let mut number = 1;
    loop {
        let candidate = parent.join(format!("{}-{}", stem, number));
        if !candidate.exists() {
            return Ok(candidate);
        }
        number += 1;
    }
}

#[tauri::command]
fn move_folder_to_trash(folder: String, library_path: String) -> Result<(), String> {
    if folder.trim().is_empty() {
        return Err("Choose a folder to delete".into());
    }
    let library = PathBuf::from(library_path);
    let source = library_folder(&library, Some(folder))?;
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

pub fn run() {
    let default_capture = default_capture_shortcut();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let is_capture_shortcut =
                        app.try_state::<CaptureShortcut>().is_some_and(|state| {
                            state.0.lock().is_ok_and(|active| {
                                active.registered && active.shortcut == *shortcut
                            })
                        });
                    if is_capture_shortcut && event.state() == ShortcutState::Pressed {
                        let handle = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            let _ = show_capture_window(&handle);
                        });
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let registered = app.global_shortcut().register(default_capture).is_ok();
            app.manage(CaptureShortcut(Mutex::new(CaptureShortcutState {
                shortcut: default_capture,
                registered,
            })));
            WebviewWindowBuilder::new(app, "capture", WebviewUrl::App("index.html".into()))
                .title("Margin Capture")
                .inner_size(496.0, 276.0)
                .min_inner_size(420.0, 240.0)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                // `transparent(true)` makes the native window transparent, while
                // this clears WKWebView's own default white backing layer. Both
                // are necessary on macOS for the space around the capture card
                // to show the app beneath it instead of an opaque rectangle.
                .background_color(Color(0, 0, 0, 0))
                .always_on_top(true)
                .skip_taskbar(true)
                .center()
                .visible(false)
                .build()
                .map_err(|error| error.to_string())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_library,
            load_trash,
            read_note,
            create_note,
            create_folder,
            rename_folder,
            load_folders,
            save_note,
            rename_note,
            duplicate_note,
            move_note_to_folder,
            reveal_note_in_file_manager,
            move_note_to_trash,
            move_folder_to_trash,
            restore_note_from_trash,
            delete_note_permanently,
            append_quick_note,
            import_daily_note,
            import_daily_note_to_new_note,
            show_quick_capture,
            hide_quick_capture,
            save_selected_library,
            load_selected_library,
            configure_quick_capture_shortcut
        ])
        .build(tauri::generate_context!())
        .expect("error while building Margin")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                let _ = show_main_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::{
        append_quick_note, body_with_title, create_folder, create_note, delete_note_permanently,
        duplicate_note, import_daily_note, import_daily_note_to_new_note, library_folder,
        load_folders, load_library, load_trash, move_folder_to_trash, move_note_to_folder,
        move_note_to_trash, normalize_tags, read_note_file, rename_folder, rename_note,
        restore_note_from_trash, safe_file_stem, save_note, split_front_matter,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static TEMP_LIBRARY_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temporary_library() -> PathBuf {
        std::env::temp_dir().join(format!(
            "markdown-notes-test-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            TEMP_LIBRARY_COUNTER.fetch_add(1, Ordering::Relaxed),
        ))
    }

    fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
        fs::create_dir_all(destination).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let target = destination.join(entry.file_name());
            if entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                copy_directory(&entry.path(), &target)?;
            } else {
                fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }

    fn copy_example_library() -> Result<PathBuf, String> {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("example-library");
        let destination = temporary_library();
        copy_directory(&source, &destination)?;
        Ok(destination)
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
            let saved = save_note(note)?;
            assert_eq!(saved.title, "Project plan");
            assert!(saved.path.ends_with("Project plan.md"));
            assert!(PathBuf::from(&saved.path).exists());
            assert!(!library.join("Untitled.md").exists());

            let mut same_title = create_note(library_path.clone(), None)?;
            same_title.body = "# Project plan\n".into();
            let collision = save_note(same_title)?;
            assert!(collision.path.ends_with("Project plan-1.md"));

            let duplicate = duplicate_note(saved.path.clone())?;
            assert_eq!(duplicate.title, "Project plan copy");
            assert!(duplicate.path.ends_with("Project plan copy.md"));

            let renamed = rename_note(duplicate.path, "Project archive".into())?;
            assert_eq!(renamed.title, "Project archive");
            assert!(renamed.path.ends_with("Project archive.md"));

            move_note_to_trash(renamed.path, library_path.clone())?;
            assert!(library
                .join(".markdown-notes")
                .join("trash")
                .join("Project archive.md")
                .exists());

            let indexed = load_library(library_path)?;
            assert_eq!(indexed.len(), 2);
            assert!(indexed
                .iter()
                .any(|item| item.title == "Project plan" && item.tags == ["work", "planning"]));
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
            let saved = save_note(note)?;
            assert!(
                PathBuf::from(&saved.path)
                    .ends_with(Path::new("Work").join("Planning").join("Sprint.md")),
                "{}",
                saved.path
            );
            assert_eq!(
                load_folders(library_path.clone())?,
                vec!["Work", "Work/Planning"]
            );
            assert_eq!(
                load_library(library_path.clone())?[0].folder,
                "Work/Planning"
            );

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
            save_note(inbox_note)?;
            let renamed_top_level =
                rename_folder("Inbox".into(), "Triage".into(), library_path.clone())?;
            assert_eq!(renamed_top_level.folder, "Triage");
            assert_eq!(renamed_top_level.paths.len(), 1);
            assert!(Path::new(&renamed_top_level.paths[0].to)
                .ends_with(Path::new("Triage").join("Triage item.md")));

            move_note_to_trash(saved.path, library_path.clone())?;
            assert!(library
                .join(".markdown-notes")
                .join("trash")
                .join("Work")
                .join("Roadmap")
                .join("Sprint.md")
                .exists());
            let deleted = load_trash(library_path.clone())?;
            assert_eq!(deleted.len(), 1);
            let restored = restore_note_from_trash(deleted[0].path.clone(), library_path.clone())?;
            assert!(
                PathBuf::from(&restored.path)
                    .ends_with(Path::new("Work").join("Roadmap").join("Sprint.md")),
                "{}",
                restored.path
            );
            move_note_to_trash(restored.path, library_path.clone())?;
            let deleted_again = load_trash(library_path.clone())?;
            delete_note_permanently(deleted_again[0].path.clone(), library_path.clone())?;
            assert!(load_trash(library_path.clone())?.is_empty());

            create_folder(library_path.clone(), "Archive/Completed".into())?;
            let mut archived = create_note(library_path.clone(), Some("Archive/Completed".into()))?;
            archived.body = "# Completed work\n".into();
            save_note(archived)?;
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
    fn quick_captures_append_to_daily_note_and_import_to_a_log() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let result = (|| -> Result<(), String> {
            let mut log = create_note(library_path.clone(), None)?;
            log.body = "# 2026 Work Log\n\n## Week 31\n".into();
            let log = save_note(log)?;

            let first = append_quick_note(
                library_path.clone(),
                "Reviewed the release checklist".into(),
            )?;
            let daily = append_quick_note(
                library_path.clone(),
                "Fixed the preview link behavior".into(),
            )?;
            assert_eq!(first.path, daily.path);
            assert!(daily.path.contains("Daily"));
            assert!(daily.body.contains("Reviewed the release checklist"));
            assert!(daily.body.contains("Fixed the preview link behavior"));

            let imported = import_daily_note(daily.path.clone(), log.path, library_path)?;
            assert!(imported.body.contains("## Week 31"));
            assert!(imported.body.contains("Reviewed the release checklist"));
            assert!(imported.body.contains("Fixed the preview link behavior"));

            let separate = import_daily_note_to_new_note(
                daily.path,
                Some("Work/Captures".into()),
                "Release notes".into(),
                library.to_string_lossy().to_string(),
            )?;
            assert!(PathBuf::from(&separate.path)
                .ends_with(Path::new("Work").join("Captures").join("Release notes.md")));
            assert!(separate.body.contains("Reviewed the release checklist"));
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn quick_capture_rejects_empty_and_cross_library_operations() {
        let library = temporary_library();
        let outside = temporary_library();
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let library_path = library.to_string_lossy().to_string();

        assert!(append_quick_note(library_path.clone(), "  ".into()).is_err());
        let daily = append_quick_note(library_path.clone(), "Inside capture".into()).unwrap();
        let outside_target = outside.join("Outside.md");
        fs::write(&outside_target, "# Outside\n").unwrap();
        assert!(import_daily_note(
            daily.path.clone(),
            outside_target.to_string_lossy().to_string(),
            library_path.clone(),
        )
        .is_err());
        assert!(import_daily_note_to_new_note(
            daily.path,
            Some("../outside".into()),
            "Escaped".into(),
            library_path,
        )
        .is_err());

        fs::remove_dir_all(&library).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn example_library_indexes_realistic_portable_markdown() {
        let library = copy_example_library().unwrap();
        let library_path = library.to_string_lossy().to_string();
        let result = (|| -> Result<(), String> {
            let notes = load_library(library_path.clone())?;
            assert_eq!(notes.len(), 8);
            assert!(!notes.iter().any(|note| note.title == "Deleted note"));

            let welcome = notes
                .iter()
                .find(|note| note.title == "Welcome to Margin")
                .ok_or("Welcome fixture was not indexed")?;
            assert_eq!(welcome.tags, ["welcome", "Demo"]);
            assert!(welcome.searchable_text.contains("localfirst = true"));

            let unicode = notes
                .iter()
                .find(|note| note.title == "Café ideas ☕")
                .ok_or("Unicode fixture was not indexed")?;
            assert_eq!(unicode.folder, "Personal");
            assert!(unicode.searchable_text.contains("crème brûlée"));

            let fallback = notes
                .iter()
                .find(|note| note.title == "No heading")
                .ok_or("Filename title fallback was not indexed")?;
            assert!(fallback
                .excerpt
                .contains("intentionally has no level-one heading"));

            assert_eq!(load_trash(library_path.clone())?.len(), 1);
            assert_eq!(
                load_folders(library_path)?,
                vec![
                    "assets",
                    "Daily",
                    "Edge Cases",
                    "Personal",
                    "Work",
                    "Work/Research",
                ]
            );
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn metadata_and_portable_filenames_handle_edge_cases() {
        assert_eq!(
            normalize_tags(vec![
                " Work ".into(),
                "work".into(),
                "".into(),
                "é".repeat(65),
                "Planning".into(),
            ]),
            ["Work", "Planning"]
        );
        assert_eq!(safe_file_stem("  plan: launch?  "), "plan- launch-");
        assert_eq!(safe_file_stem("CON"), "Note-CON");
        assert_eq!(safe_file_stem("..."), "Untitled");
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
        assert!(
            delete_note_permanently(inside_note.to_string_lossy().to_string(), library_path)
                .is_err()
        );

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
            let duplicate = save_note(duplicate)?;
            let moved =
                move_note_to_folder(duplicate.path, Some("Work".into()), library_path.clone())?;
            assert!(moved.path.ends_with("Project Alpha-1.md"));

            fs::write(library.join("Deleted note.md"), "# Existing deletion\n")
                .map_err(|error| error.to_string())?;
            let trashed = load_trash(library_path.clone())?;
            let restored = restore_note_from_trash(trashed[0].path.clone(), library_path)?;
            assert!(restored.path.ends_with("Deleted note-1.md"));
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn external_file_edits_are_visible_on_the_next_index() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let path = library.join("External.md");
        fs::write(&path, "# Before\n\nOriginal text").unwrap();
        let library_path = library.to_string_lossy().to_string();
        assert_eq!(
            load_library(library_path.clone()).unwrap()[0].title,
            "Before"
        );

        fs::write(&path, "# After\n\nChanged outside Margin").unwrap();
        let indexed = load_library(library_path).unwrap();
        assert_eq!(indexed[0].title, "After");
        assert!(indexed[0]
            .searchable_text
            .contains("changed outside margin"));

        fs::remove_dir_all(&library).ok();
    }
}
