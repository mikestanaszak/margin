use chrono::Local;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::{
    window::Color, AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use unicode_normalization::UnicodeNormalization;
use walkdir::WalkDir;

/// The active capture shortcut is kept in the native process so it remains
/// available when every webview is backgrounded.
struct CaptureShortcut(Mutex<CaptureShortcutState>);

struct CaptureShortcutState {
    shortcut: Shortcut,
    registered: bool,
}

/// Markdown paths delivered by the OS before the webview is ready. Keeping
/// these in memory lets a normal file-open launch work without copying or
/// modifying the user's source file.
struct OpenedMarkdownFiles(Mutex<Vec<String>>);

fn is_markdown_path(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
    })
}

/// Margin stores its managed note identifiers as forward-slash relative paths.
/// The UI may still receive an absolute path for OS integrations, but every
/// managed filesystem operation is resolved through these helpers first.
///
/// Symlink policy: a selected library may itself be a symlink (we persist its
/// canonical target), but symlinks *inside* a library are never followed. This
/// keeps a library from accidentally exposing or modifying files elsewhere.
fn canonical_library_root(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let root = fs::canonicalize(path.as_ref())
        .map_err(|error| format!("Choose an existing notes folder: {error}"))?;
    if !root.is_dir() {
        return Err("Choose an existing notes folder".into());
    }
    Ok(root)
}

fn relative_note_id(library: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(library)
        .map_err(|_| "Note is outside the selected library")?;
    if relative.as_os_str().is_empty() || !is_markdown_path(relative) {
        return Err("Choose a Markdown note inside the selected library".into());
    }
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn reject_symlink_components(library: &Path, candidate: &Path) -> Result<(), String> {
    let relative = candidate
        .strip_prefix(library)
        .map_err(|_| "Path is outside the selected library")?;
    let mut current = library.to_path_buf();
    for component in relative.components() {
        match component {
            std::path::Component::Normal(part) => current.push(part),
            _ => return Err("Path is outside the selected library".into()),
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("Symlinks inside a Margin library are not supported".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn existing_library_path(library: &Path, raw: impl AsRef<Path>) -> Result<PathBuf, String> {
    let candidate = raw.as_ref();
    if !candidate.starts_with(library) {
        return Err("Path is outside the selected library".into());
    }
    reject_symlink_components(library, candidate)?;
    let canonical = fs::canonicalize(candidate).map_err(|error| error.to_string())?;
    if !canonical.starts_with(library) {
        return Err("Path is outside the selected library".into());
    }
    Ok(canonical)
}

fn library_path_for_relative(library: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(relative.trim());
    if candidate.as_os_str().is_empty() {
        return Ok(library.to_path_buf());
    }
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
    let destination = library.join(candidate);
    reject_symlink_components(library, &destination)?;
    Ok(destination)
}

fn markdown_file_paths<I>(paths: I) -> Vec<String>
where
    I: IntoIterator<Item = PathBuf>,
{
    let mut result = Vec::new();
    for path in paths {
        let Ok(path) = fs::canonicalize(path) else {
            continue;
        };
        if path.is_file() && is_markdown_path(&path) {
            let value = path.to_string_lossy().to_string();
            if !result.iter().any(|existing| existing == &value) {
                result.push(value);
            }
        }
    }
    result
}

fn markdown_asset_directory(path: &Path) -> Option<PathBuf> {
    let canonical = fs::canonicalize(path).ok()?;
    if canonical.is_file() && is_markdown_path(&canonical) {
        canonical.parent().map(Path::to_path_buf)
    } else {
        None
    }
}

fn allow_asset_directory(app: &AppHandle, directory: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(directory, true)
        .map_err(|error| format!("Could not allow note images: {error}"))
}

fn allow_opened_markdown_assets(app: &AppHandle, paths: &[String]) -> Result<(), String> {
    for path in paths {
        if let Some(directory) = markdown_asset_directory(Path::new(path)) {
            allow_asset_directory(app, &directory)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn queue_opened_markdown_files(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if allow_opened_markdown_assets(app, &paths).is_err() {
        return;
    }
    if let Ok(mut pending) = app.state::<OpenedMarkdownFiles>().0.lock() {
        for path in &paths {
            if !pending.iter().any(|existing| existing == path) {
                pending.push(path.clone());
            }
        }
    }
    let _ = app.emit("margin://open-markdown-files", paths);
}

#[tauri::command]
fn take_opened_markdown_files(app: AppHandle) -> Result<Vec<String>, String> {
    let opened = app.state::<OpenedMarkdownFiles>();
    let mut pending = opened
        .0
        .lock()
        .map_err(|_| "Opened Markdown queue is unavailable")?;
    Ok(std::mem::take(&mut *pending))
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

fn runtime_icon_bytes(palette: &str) -> Result<&'static [u8], String> {
    match palette {
        "ink" => Ok(&include_bytes!("../icons/runtime/ink.png")[..]),
        "mint" => Ok(&include_bytes!("../icons/runtime/mint.png")[..]),
        "linen" => Ok(&include_bytes!("../icons/runtime/linen.png")[..]),
        _ => Err("Unknown palette icon".into()),
    }
}

#[cfg(target_os = "macos")]
fn set_macos_application_icon(app: &AppHandle, icon_bytes: &'static [u8]) -> Result<(), String> {
    app.run_on_main_thread(move || {
        use objc2::{AllocAnyThread, MainThreadMarker};
        use objc2_app_kit::{NSApplication, NSImage};
        use objc2_foundation::NSData;

        let Some(main_thread) = MainThreadMarker::new() else {
            return;
        };
        let data = NSData::with_bytes(icon_bytes);
        let Some(icon) = NSImage::initWithData(NSImage::alloc(), &data) else {
            return;
        };
        let application = NSApplication::sharedApplication(main_thread);
        // SAFETY: the icon is non-null and this closure runs on AppKit's main thread.
        unsafe { application.setApplicationIconImage(Some(&icon)) };
    })
    .map_err(|error| format!("Could not update palette icon: {error}"))
}

#[tauri::command]
fn set_runtime_palette_icon(app: AppHandle, palette: String) -> Result<(), String> {
    let icon_bytes = runtime_icon_bytes(&palette)?;

    #[cfg(target_os = "windows")]
    {
        let icon = tauri::image::Image::from_bytes(icon_bytes)
            .map_err(|error| format!("Could not load palette icon: {error}"))?;
        for window in app.webview_windows().into_values() {
            window
                .set_icon(icon.clone())
                .map_err(|error| format!("Could not update palette icon: {error}"))?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        tauri::image::Image::from_bytes(icon_bytes)
            .map_err(|error| format!("Could not load palette icon: {error}"))?;
        set_macos_application_icon(&app, icon_bytes)?;
    }

    #[cfg(target_os = "linux")]
    let _ = (app, icon_bytes);

    Ok(())
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

/// Opens a user-authored web or communication link with the operating
/// system's default handler. Keeping this native avoids WebView-specific
/// navigation behavior and works the same way on macOS and Windows.
#[tauri::command]
fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let url = url.trim();
    let allowed = ["https://", "http://", "mailto:", "tel:"]
        .iter()
        .any(|prefix| {
            url.get(..prefix.len())
                .is_some_and(|value| value.eq_ignore_ascii_case(prefix))
        });
    if !allowed {
        return Err("Links must begin with https://, http://, mailto:, or tel:".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("Could not open link: {error}"))
}

#[tauri::command]
fn save_selected_library(app: AppHandle, library_path: String) -> Result<(), String> {
    let library = canonical_library_root(library_path.trim())?;
    allow_asset_directory(&app, &library)?;
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
        Ok(value) => match canonical_library_root(value.trim()) {
            Ok(library) => {
                allow_asset_directory(&app, &library)?;
                Ok(Some(library.to_string_lossy().to_string()))
            }
            Err(_) => Ok(None),
        },
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
    id: String,
    path: String,
    title: String,
    tags: Vec<String>,
    updated: u64,
    #[serde(skip_serializing)]
    searchable_text: String,
    excerpt: String,
    folder: String,
}

#[derive(Clone, Serialize)]
struct LibrarySnapshot {
    notes: Vec<NoteSummary>,
    folders: Vec<String>,
    trash: Vec<NoteSummary>,
}

/// A process-owned snapshot keeps note contents and search data out of the
/// webview. The watcher marks the snapshot stale; the next normal refresh
/// rebuilds it, while a low-frequency reconciliation catches missed events.
/// Margin deliberately indexes one selected library at a time.
struct LibraryIndex(Mutex<Option<IndexedLibrary>>);

struct IndexedLibrary {
    path: PathBuf,
    snapshot: LibrarySnapshot,
    dirty: Arc<AtomicBool>,
    reconciled_at: Instant,
    _watcher: RecommendedWatcher,
}

const INDEX_RECONCILIATION_INTERVAL: Duration = Duration::from_secs(45);

impl LibraryIndex {
    fn snapshot(&self, library_path: &str, force: bool) -> Result<LibrarySnapshot, String> {
        let requested = PathBuf::from(library_path);
        let library = fs::canonicalize(&requested)
            .map_err(|error| format!("Could not open the selected library: {error}"))?;
        if !library.is_dir() {
            return Err("Choose an existing notes folder".into());
        }

        let mut state = self.0.lock().map_err(|_| "Library index is unavailable")?;
        let replace_index = state.as_ref().is_none_or(|current| current.path != library);
        if replace_index {
            *state = Some(index_library(&library)?);
        }
        let current = state.as_mut().expect("library index was initialized");
        let should_rebuild = force
            || current.dirty.swap(false, Ordering::AcqRel)
            || current.reconciled_at.elapsed() >= INDEX_RECONCILIATION_INTERVAL;
        if should_rebuild {
            current.snapshot = build_library_snapshot(&current.path);
            current.reconciled_at = Instant::now();
        }
        Ok(current.snapshot.clone())
    }
}

fn build_library_snapshot(library: &Path) -> LibrarySnapshot {
    let Ok(library) = fs::canonicalize(library) else {
        return LibrarySnapshot {
            notes: Vec::new(),
            folders: Vec::new(),
            trash: Vec::new(),
        };
    };
    let (notes, folders) = load_library_contents(&library);
    LibrarySnapshot {
        notes,
        folders,
        trash: load_trash_contents(&library),
    }
}

fn index_library(library: &Path) -> Result<IndexedLibrary, String> {
    let dirty = Arc::new(AtomicBool::new(false));
    let watcher_dirty = Arc::clone(&dirty);
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            watcher_dirty.store(true, Ordering::Release);
        }
    })
    .map_err(|error| format!("Could not watch the selected library: {error}"))?;
    watcher
        .watch(library, RecursiveMode::Recursive)
        .map_err(|error| format!("Could not watch the selected library: {error}"))?;
    Ok(IndexedLibrary {
        path: library.to_path_buf(),
        snapshot: build_library_snapshot(library),
        dirty,
        reconciled_at: Instant::now(),
        _watcher: watcher,
    })
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
    library_path_for_relative(library, folder.as_deref().unwrap_or_default())
}

#[derive(Clone, Serialize, Deserialize)]
struct NoteDocument {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<String>,
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

#[derive(Serialize)]
struct ImportedImage {
    markdown_path: String,
    alt: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum SaveNoteResult {
    Saved { note: NoteDocument },
    Conflict { disk: NoteDocument },
    Error { message: String },
}

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
        .map(|line| line.trim_start_matches(['>', '-', '*', ' ']).trim())
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
        id: None,
        path: path.to_string_lossy().to_string(),
        // The visible first heading is the canonical note title. Front matter
        // remains for compatibility, but must never mask what the note says.
        title: title_from_body(&body, fallback),
        tags: normalize_tags(front.tags.unwrap_or_default()),
        body,
        updated: modified_seconds(path),
        revision: file_revision(path, &raw),
        created: front.created,
        updated_at: front.updated,
    })
}

fn read_library_note_file(library: &Path, path: &Path) -> Result<NoteDocument, String> {
    let path = existing_library_path(library, path)?;
    let mut note = read_note_file(&path)?;
    note.id = Some(relative_note_id(library, &path)?);
    Ok(note)
}

fn managed_note(library: &Path, note: NoteDocument) -> Result<NoteDocument, String> {
    read_library_note_file(library, Path::new(&note.path))
}

const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn asset_directory_for_note(note: &Path) -> Result<PathBuf, String> {
    let parent = note.parent().ok_or("Note has no parent folder")?;
    let stem = note
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Note filename is invalid")?;
    Ok(parent.join(format!("{}.assets", stem)))
}

fn move_note_assets(
    library: &Path,
    source_note: &Path,
    destination_note: &Path,
) -> Result<(), String> {
    let source_assets = asset_directory_for_note(source_note)?;
    if !source_assets.exists() {
        return Ok(());
    }
    reject_symlink_components(library, &source_assets)?;
    if !source_assets.is_dir() {
        return Err("The note's asset path is not a folder".into());
    }
    let destination_assets = asset_directory_for_note(destination_note)?;
    reject_symlink_components(library, &destination_assets)?;
    if destination_assets.exists() {
        return Err("The destination already has an asset folder".into());
    }
    fs::rename(source_assets, destination_assets).map_err(|error| error.to_string())
}

fn move_note_and_assets(library: &Path, source: &Path, destination: &Path) -> Result<(), String> {
    move_note_assets(library, source, destination)?;
    if let Err(error) = fs::rename(source, destination) {
        let _ = move_note_assets(library, destination, source);
        return Err(error.to_string());
    }
    Ok(())
}

fn unique_asset_path(directory: &Path, stem: &str, extension: &str) -> PathBuf {
    let base = safe_file_stem(stem);
    let base = if base.is_empty() { "image" } else { &base };
    let mut number = 0;
    loop {
        let suffix = if number == 0 {
            String::new()
        } else {
            format!("-{}", number)
        };
        let candidate = directory.join(format!("{}{}.{}", base, suffix, extension));
        if !candidate.exists() {
            return candidate;
        }
        number += 1;
    }
}

fn store_note_image(
    library: &Path,
    note: &Path,
    source_name: &str,
    bytes: Vec<u8>,
) -> Result<ImportedImage, String> {
    let note = existing_library_path(library, note)?;
    if !is_markdown_path(&note) {
        return Err("Choose a Markdown note inside the selected library".into());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Images must be 25 MB or smaller".into());
    }
    let extension = image_extension(&bytes).ok_or("Choose a PNG, JPEG, GIF, or WebP image")?;
    let directory = asset_directory_for_note(&note)?;
    reject_symlink_components(library, &directory)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let stem = Path::new(source_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let target = unique_asset_path(&directory, stem, extension);
    fs::write(&target, bytes).map_err(|error| error.to_string())?;
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Image filename is invalid")?;
    let folder_name = directory
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Image folder name is invalid")?;
    Ok(ImportedImage {
        markdown_path: format!("{}/{}", folder_name, file_name),
        alt: stem.to_string(),
    })
}

#[tauri::command]
fn import_note_image_from_path(
    note_path: String,
    source_path: String,
    library_path: String,
) -> Result<ImportedImage, String> {
    let library = canonical_library_root(library_path)?;
    let source = fs::canonicalize(source_path).map_err(|_| "Choose an existing image file")?;
    if !source.is_file() {
        return Err("Choose an existing image file".into());
    }
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image")
        .to_string();
    store_note_image(
        &library,
        Path::new(&note_path),
        &name,
        fs::read(source).map_err(|error| error.to_string())?,
    )
}

#[tauri::command]
fn import_note_image_from_bytes(
    note_path: String,
    filename: String,
    bytes: Vec<u8>,
    library_path: String,
) -> Result<ImportedImage, String> {
    let library = canonical_library_root(library_path)?;
    store_note_image(&library, Path::new(&note_path), &filename, bytes)
}

fn note_summary(note: NoteDocument, library: &Path) -> NoteSummary {
    let folder = folder_for_path(library, Path::new(&note.path));
    NoteSummary {
        id: note.id.unwrap_or_else(|| {
            relative_note_id(library, Path::new(&note.path)).unwrap_or_default()
        }),
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
}

fn load_library_contents(library: &Path) -> (Vec<NoteSummary>, Vec<String>) {
    let mut notes = Vec::new();
    let mut folders = Vec::new();
    for entry in WalkDir::new(library)
        .min_depth(1)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.file_name() != ".markdown-notes")
        .filter_map(Result::ok)
    {
        if entry.file_type().is_symlink() {
            continue;
        }
        if entry.file_type().is_dir() {
            if let Ok(relative) = entry.path().strip_prefix(library) {
                let folder = relative.to_string_lossy().replace('\\', "/");
                if !folder.is_empty() {
                    folders.push(folder);
                }
            }
        } else if entry.file_type().is_file() && is_markdown_path(entry.path()) {
            if let Ok(note) = read_library_note_file(library, entry.path()) {
                notes.push(note_summary(note, library));
            }
        }
    }
    notes.sort_by_key(|note| std::cmp::Reverse(note.updated));
    folders.sort_by_key(|folder| folder.to_lowercase());
    (notes, folders)
}

#[tauri::command]
fn load_library(library_path: String) -> Result<Vec<NoteSummary>, String> {
    let library = canonical_library_root(library_path)?;
    Ok(load_library_contents(&library).0)
}

#[tauri::command]
fn load_library_snapshot(
    library_index: State<'_, LibraryIndex>,
    library_path: String,
    force: Option<bool>,
) -> Result<LibrarySnapshot, String> {
    library_index.snapshot(&library_path, force.unwrap_or(false))
}

fn wiki_targets(text: &str) -> Vec<&str> {
    let mut targets = Vec::new();
    let mut remaining = text;
    while let Some(start) = remaining.find("[[") {
        let after_start = &remaining[start + 2..];
        let Some(end) = after_start.find("]]") else {
            break;
        };
        let target = after_start[..end].split('|').next().unwrap_or("").trim();
        if !target.is_empty() {
            targets.push(target);
        }
        remaining = &after_start[end + 2..];
    }
    targets
}

#[tauri::command]
fn search_library(
    library_index: State<'_, LibraryIndex>,
    library_path: String,
    query: String,
) -> Result<Vec<NoteSummary>, String> {
    Ok(search_snapshot(
        &library_index.snapshot(&library_path, false)?,
        &query,
    ))
}

#[tauri::command]
fn find_backlinks(
    library_index: State<'_, LibraryIndex>,
    library_path: String,
    note_path: String,
    title: String,
) -> Result<Vec<NoteSummary>, String> {
    Ok(backlinks_for_snapshot(
        &library_index.snapshot(&library_path, false)?,
        &note_path,
        &title,
    ))
}

fn search_snapshot(snapshot: &LibrarySnapshot, query: &str) -> Vec<NoteSummary> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }
    snapshot
        .notes
        .iter()
        .filter(|note| note.searchable_text.contains(&query))
        .cloned()
        .collect()
}

fn backlinks_for_snapshot(
    snapshot: &LibrarySnapshot,
    note_path: &str,
    title: &str,
) -> Vec<NoteSummary> {
    let target = title.to_lowercase();
    snapshot
        .notes
        .iter()
        .filter(|item| {
            item.path != note_path
                && wiki_targets(&item.searchable_text)
                    .iter()
                    .any(|link| link.to_lowercase() == target)
        })
        .cloned()
        .collect()
}

#[tauri::command]
fn read_note(path: String) -> Result<NoteDocument, String> {
    read_note_file(Path::new(&path))
}

#[tauri::command]
fn create_note(library_path: String, folder: Option<String>) -> Result<NoteDocument, String> {
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
fn create_folder(library_path: String, folder: String) -> Result<String, String> {
    let library = canonical_library_root(library_path)?;
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
fn load_folders(library_path: String) -> Result<Vec<String>, String> {
    let library = canonical_library_root(library_path)?;
    Ok(load_library_contents(&library).1)
}

fn load_trash_contents(library: &Path) -> Vec<NoteSummary> {
    let trash = library.join(".markdown-notes").join("trash");
    if !trash.exists() {
        return Vec::new();
    }
    let mut notes = WalkDir::new(&trash)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            !entry.file_type().is_symlink()
                && entry.file_type().is_file()
                && is_markdown_path(entry.path())
        })
        .filter_map(|entry| read_library_note_file(library, entry.path()).ok())
        .map(|note| NoteSummary {
            folder: "Trash".into(),
            ..note_summary(note, library)
        })
        .collect::<Vec<_>>();
    notes.sort_by_key(|note| std::cmp::Reverse(note.updated));
    notes
}

#[tauri::command]
fn load_trash(library_path: String) -> Result<Vec<NoteSummary>, String> {
    let library = canonical_library_root(library_path)?;
    Ok(load_trash_contents(&library))
}

#[tauri::command]
fn restore_note_from_trash(path: String, library_path: String) -> Result<NoteDocument, String> {
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
fn delete_note_permanently(path: String, library_path: String) -> Result<(), String> {
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

#[tauri::command]
fn append_quick_note(
    library_path: String,
    text: String,
    daily_folder: Option<String>,
    daily_template: Option<String>,
) -> Result<NoteDocument, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Quick note cannot be empty".into());
    }
    let library = canonical_library_root(library_path)?;
    let date = Local::now().format("%Y-%m-%d").to_string();
    let time = Local::now().format("%H:%M").to_string();
    let folder = library_folder(&library, daily_folder.or_else(|| Some("Daily".into())))?;
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!("{}.md", date));
    let mut note = if path.exists() {
        read_note_file(&path)?
    } else {
        NoteDocument {
            id: None,
            path: path.to_string_lossy().to_string(),
            title: date.clone(),
            tags: Vec::new(),
            body: body_with_title(
                &daily_template.unwrap_or_else(|| format!("# {}\n", date)),
                &date,
            ),
            updated: 0,
            revision: String::new(),
            created: Some(now_rfc3339()),
            updated_at: None,
        }
    };
    note.body = format!("{}\n\n## {}\n\n{}\n", note.body.trim_end(), time, text);
    managed_note(&library, save_note_document(note)?)
}

#[tauri::command]
fn import_daily_note(
    source_path: String,
    target_path: String,
    library_path: String,
) -> Result<NoteDocument, String> {
    let library = canonical_library_root(library_path)?;
    let source = existing_library_path(&library, source_path)?;
    let target = existing_library_path(&library, target_path)?;
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
    managed_note(&library, save_note_document(target_note)?)
}

#[tauri::command]
fn import_daily_note_to_new_note(
    source_path: String,
    folder: Option<String>,
    title: String,
    library_path: String,
) -> Result<NoteDocument, String> {
    let library = canonical_library_root(library_path)?;
    let source = existing_library_path(&library, source_path)?;
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
    managed_note(
        &library,
        save_note_document(NoteDocument {
            id: None,
            path: destination.to_string_lossy().to_string(),
            title: title.clone(),
            tags: Vec::new(),
            body: format!("# {}\n\n## {}\n\n{}\n", title, source_note.title, entries),
            updated: 0,
            revision: String::new(),
            created: Some(now_rfc3339()),
            updated_at: None,
        })?,
    )
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
    let path = target.trim();
    if path.is_empty()
        || path != target
        || path.contains(['#', '?'])
        || path.starts_with(['/', '\\'])
        || path.starts_with('<')
        || path.contains("://")
        || path.get(1..2) == Some(":")
    {
        return false;
    }
    is_markdown_path(Path::new(path))
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
    let yaml =
        serde_yaml::to_string(&front).map_err(|error| SaveNoteFailure::Error(error.to_string()))?;
    let content = format!("---\n{}---\n\n{}", yaml, note.body);
    let destination = path_for_title(&path, &title).map_err(SaveNoteFailure::Error)?;
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
    read_note_file(&destination).map_err(SaveNoteFailure::Error)
}

fn save_note_document(note: NoteDocument) -> Result<NoteDocument, String> {
    match save_note_checked(note, None) {
        Ok(saved) => Ok(saved),
        Err(SaveNoteFailure::Conflict(_)) => {
            Err("The note changed on disk before it could be saved".into())
        }
        Err(SaveNoteFailure::Error(message)) => Err(message),
    }
}

#[tauri::command]
fn save_note(note: NoteDocument, library_path: String) -> SaveNoteResult {
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

const MAX_FILE_STEM_BYTES: usize = 240;

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

/// Produces a portable NFC filename stem while retaining the note title
/// everywhere the filesystem permits it. The 240-byte cap leaves room for the
/// extension on common 255-byte filesystems.
fn safe_file_stem(title: &str) -> String {
    let normalized: String = title.nfc().collect();
    let cleaned: String = normalized
        .trim()
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '-'
            } else {
                character
            }
        })
        .collect::<String>()
        .trim_matches(['.', ' '])
        .to_string();
    let fallback = if cleaned.is_empty() {
        "Untitled".to_string()
    } else {
        truncate_utf8(&cleaned, MAX_FILE_STEM_BYTES)
    };
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.iter().any(|name| {
        fallback
            .split('.')
            .next()
            .is_some_and(|stem| stem.eq_ignore_ascii_case(name))
    }) {
        truncate_utf8(&format!("Note-{}", fallback), MAX_FILE_STEM_BYTES)
    } else {
        fallback
    }
}

fn path_for_title(source: &Path, title: &str) -> Result<PathBuf, String> {
    let parent = source.parent().ok_or("Note has no parent folder")?;
    let stem = safe_file_stem(title);
    let destination = parent.join(format!("{}.md", stem));
    if source == destination {
        Ok(source.to_path_buf())
    } else if cfg!(any(target_os = "windows", target_os = "macos"))
        && source.parent() == destination.parent()
        && source
            .file_name()
            .zip(destination.file_name())
            .is_some_and(|(current, next)| current.eq_ignore_ascii_case(next))
    {
        // Windows and the default macOS volume are case-insensitive. Returning
        // the requested spelling lets rename_file_safely perform a case-only
        // transition through an intermediate path.
        Ok(destination)
    } else {
        Ok(unique_path(parent, &stem))
    }
}

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
fn duplicate_note(path: String, library_path: String) -> Result<NoteDocument, String> {
    let library = canonical_library_root(library_path)?;
    let source = existing_library_path(&library, path)?;
    if !is_markdown_path(&source) {
        return Err("Only Markdown notes can be duplicated".into());
    }
    let parent = source.parent().ok_or("Note has no parent folder")?;
    let original = read_library_note_file(&library, &source)?;
    let copy_title = format!("{} copy", original.title);
    let destination = unique_path(parent, &copy_title);
    fs::copy(source, &destination).map_err(|e| e.to_string())?;
    let mut copy = read_library_note_file(&library, &destination)?;
    copy.body = body_with_title(&copy.body, &copy_title);
    managed_note(&library, save_note_document(copy)?)
}

/// Imports a standalone Markdown file as a new note without changing the
/// original. This is used when Margin is selected as the system Markdown
/// opener and the opened file is outside the active library.
#[tauri::command]
fn import_markdown_file(
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
fn move_note_to_folder(
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
fn reveal_note_in_file_manager(path: String, library_path: String) -> Result<(), String> {
    let library = canonical_library_root(library_path)?;
    let note = existing_library_path(&library, path)?;
    if !note.is_file() || !is_markdown_path(&note) {
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

pub fn run() {
    let default_capture = default_capture_shortcut();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            app.manage(LibraryIndex(Mutex::new(None)));
            let opened_markdown_files =
                markdown_file_paths(std::env::args_os().skip(1).map(PathBuf::from));
            allow_opened_markdown_assets(app.handle(), &opened_markdown_files)?;
            app.manage(OpenedMarkdownFiles(Mutex::new(opened_markdown_files)));
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
                .shadow(false)
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
            load_library_snapshot,
            search_library,
            find_backlinks,
            load_trash,
            read_note,
            create_note,
            create_folder,
            rename_folder,
            load_folders,
            save_note,
            rename_note,
            duplicate_note,
            import_markdown_file,
            import_note_image_from_path,
            import_note_image_from_bytes,
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
            open_external_url,
            save_selected_library,
            load_selected_library,
            configure_quick_capture_shortcut,
            take_opened_markdown_files,
            set_runtime_palette_icon
        ])
        .build(tauri::generate_context!())
        .expect("error while building Margin")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            match event {
                tauri::RunEvent::Reopen { .. } => {
                    let _ = show_main_window(app);
                }
                tauri::RunEvent::Opened { urls } => {
                    let paths = markdown_file_paths(
                        urls.into_iter().filter_map(|url| url.to_file_path().ok()),
                    );
                    queue_opened_markdown_files(app, paths);
                    let _ = show_main_window(app);
                }
                _ => {}
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::{
        append_quick_note, apply_staged_file_updates, backlinks_for_snapshot, body_with_title,
        build_library_snapshot, create_folder, create_note, delete_note_permanently,
        duplicate_note, existing_library_path, import_daily_note, import_daily_note_to_new_note,
        import_markdown_file, library_folder, load_folders, load_library, load_trash,
        markdown_asset_directory, move_folder_to_trash, move_note_to_folder, move_note_to_trash,
        normalize_tags, path_for_title, read_library_note_file, read_note_file, relative_note_id,
        rename_file_safely, rename_folder, rename_note, restore_note_from_trash,
        runtime_icon_bytes, safe_file_stem, save_note, save_note_document, search_snapshot,
        split_front_matter, stage_file_updates, LibraryIndex, LinkRewrite, SaveNoteResult,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicU64, Ordering},
            Mutex,
        },
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
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
    fn runtime_palette_icon_accepts_only_shipped_palettes() {
        assert!(runtime_icon_bytes("ink").is_ok());
        assert!(runtime_icon_bytes("mint").is_ok());
        assert!(runtime_icon_bytes("linen").is_ok());
        assert!(runtime_icon_bytes("violet").is_err());
    }

    #[test]
    fn preserves_one_intentional_leading_body_newline() {
        let raw = "---\ntitle: Example\n---\n\n\nBody";
        let (_, body) = split_front_matter(raw);
        assert_eq!(body, "\nBody");
    }

    #[test]
    fn markdown_assets_are_scoped_to_explicit_note_directories() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let note = library.join("Example.md");
        let not_markdown = library.join("image.png");
        let missing = library.join("Missing.md");
        fs::write(&note, "# Example\n").unwrap();
        fs::write(&not_markdown, "not an image").unwrap();

        assert_eq!(
            markdown_asset_directory(&note),
            Some(fs::canonicalize(&library).unwrap())
        );
        assert_eq!(markdown_asset_directory(&not_markdown), None);
        assert_eq!(markdown_asset_directory(&missing), None);

        fs::remove_dir_all(&library).ok();
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
    fn library_snapshot_indexes_markdown_and_prunes_internal_storage() {
        let library = temporary_library();
        fs::create_dir_all(library.join("Projects")).unwrap();
        fs::create_dir_all(library.join(".markdown-notes").join("trash")).unwrap();
        let result = (|| -> Result<(), String> {
            fs::write(
                library.join("Projects").join("Plan.markdown"),
                "# Project plan\n\nVisible note\n",
            )
            .map_err(|error| error.to_string())?;
            fs::write(
                library.join(".markdown-notes").join("hidden.md"),
                "# Internal note\n",
            )
            .map_err(|error| error.to_string())?;
            fs::write(
                library
                    .join(".markdown-notes")
                    .join("trash")
                    .join("Deleted.markdown"),
                "# Deleted note\n",
            )
            .map_err(|error| error.to_string())?;

            let snapshot = build_library_snapshot(&library);
            assert_eq!(snapshot.notes.len(), 1);
            assert_eq!(snapshot.notes[0].title, "Project plan");
            assert_eq!(snapshot.folders, ["Projects"]);
            assert_eq!(snapshot.trash.len(), 1);
            assert_eq!(snapshot.trash[0].title, "Deleted note");
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
            save_note_document(inbox_note)?;
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
    fn quick_captures_append_to_daily_note_and_import_to_a_log() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let result = (|| -> Result<(), String> {
            let mut log = create_note(library_path.clone(), None)?;
            log.body = "# 2026 Work Log\n\n## Week 31\n".into();
            let log = save_note_document(log)?;

            let first = append_quick_note(
                library_path.clone(),
                "Reviewed the release checklist".into(),
                None,
                None,
            )?;
            let daily = append_quick_note(
                library_path.clone(),
                "Fixed the preview link behavior".into(),
                None,
                None,
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

        assert!(append_quick_note(library_path.clone(), "  ".into(), None, None).is_err());
        let daily =
            append_quick_note(library_path.clone(), "Inside capture".into(), None, None).unwrap();
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

    #[test]
    fn native_index_watches_changes_and_reconciles_on_demand() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let path = library.join("Watched.md");
        fs::write(&path, "# Before\n\nOriginal text").unwrap();
        let index = LibraryIndex(Mutex::new(None));
        let library_path = library.to_string_lossy().to_string();

        assert_eq!(
            index.snapshot(&library_path, false).unwrap().notes[0].title,
            "Before"
        );
        fs::write(&path, "# After\n\nChanged outside Margin").unwrap();

        let mut watched_title = String::new();
        for _ in 0..30 {
            thread::sleep(Duration::from_millis(100));
            watched_title = index.snapshot(&library_path, false).unwrap().notes[0]
                .title
                .clone();
            if watched_title == "After" {
                break;
            }
        }
        assert_eq!(watched_title, "After");

        fs::write(&path, "# Reconciled\n\nExplicit refresh").unwrap();
        assert_eq!(
            index.snapshot(&library_path, true).unwrap().notes[0].title,
            "Reconciled"
        );
        fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn native_search_and_backlinks_keep_note_bodies_out_of_snapshot_payloads() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let result = (|| -> Result<(), String> {
            fs::write(
                library.join("Project.md"),
                format!(
                    "# Project\n\n{} alpine architecture.",
                    "Background ".repeat(40)
                ),
            )
            .map_err(|error| error.to_string())?;
            fs::write(
                library.join("Reference.md"),
                "# Reference\n\nSee [[Project]] for the next milestone.",
            )
            .map_err(|error| error.to_string())?;
            let snapshot = build_library_snapshot(&library);
            assert_eq!(search_snapshot(&snapshot, "alpine").len(), 1);
            let project = snapshot
                .notes
                .iter()
                .find(|note| note.title == "Project")
                .ok_or("Project was not indexed")?;
            assert_eq!(
                backlinks_for_snapshot(&snapshot, &project.path, &project.title)[0].title,
                "Reference"
            );
            let payload = serde_json::to_value(&snapshot).map_err(|error| error.to_string())?;
            assert!(!payload.to_string().contains("alpine architecture"));
            assert!(!payload.to_string().contains("searchable_text"));
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
