use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use walkdir::WalkDir;

#[derive(Clone, Serialize, Deserialize)]
struct NoteSummary { path: String, title: String, tags: Vec<String>, updated: u64 }

#[derive(Clone, Serialize, Deserialize)]
struct NoteDocument {
    path: String, title: String, tags: Vec<String>, body: String, updated: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct FrontMatter { title: Option<String>, tags: Option<Vec<String>>, created: Option<String>, updated: Option<String> }

fn modified_seconds(path: &Path) -> u64 {
    fs::metadata(path).and_then(|meta| meta.modified()).unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn split_front_matter(raw: &str) -> (FrontMatter, String) {
    let normalized = raw.replace("\r\n", "\n");
    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some((yaml, body)) = rest.split_once("\n---\n") {
            // The blank line after front matter is a file-format separator, not
            // part of the note body. Consuming it prevents autosave from
            // accumulating one more leading blank line on every write.
            return (serde_yaml::from_str(yaml).unwrap_or_default(), body.strip_prefix('\n').unwrap_or(body).to_string());
        }
    }
    (FrontMatter::default(), normalized)
}

fn title_from_body(body: &str, fallback: &str) -> String {
    body.lines().find_map(|line| line.strip_prefix("# ").map(|title| title.trim().to_string()))
        .filter(|title| !title.is_empty()).unwrap_or_else(|| fallback.to_string())
}

fn read_note_file(path: &Path) -> Result<NoteDocument, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let (front, body) = split_front_matter(&raw);
    let fallback = path.file_stem().and_then(|v| v.to_str()).unwrap_or("Untitled");
    Ok(NoteDocument { path: path.to_string_lossy().to_string(), title: front.title.unwrap_or_else(|| title_from_body(&body, fallback)), tags: front.tags.unwrap_or_default(), body, updated: modified_seconds(path), created: front.created, updated_at: front.updated })
}

#[tauri::command]
fn load_library(library_path: String) -> Result<Vec<NoteSummary>, String> {
    let mut notes = WalkDir::new(library_path).into_iter().filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && entry.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")))
        .filter_map(|entry| read_note_file(entry.path()).ok())
        .map(|note| NoteSummary { path: note.path, title: note.title, tags: note.tags, updated: note.updated }).collect::<Vec<_>>();
    notes.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(notes)
}

#[tauri::command]
fn read_note(path: String) -> Result<NoteDocument, String> { read_note_file(Path::new(&path)) }

#[tauri::command]
fn create_note(library_path: String) -> Result<NoteDocument, String> {
    let folder = PathBuf::from(library_path);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut index = 0;
    let path = loop { let name = if index == 0 { "Untitled.md".to_string() } else { format!("Untitled-{}.md", index) }; let candidate = folder.join(name); if !candidate.exists() { break candidate; } index += 1; };
    fs::write(&path, "# Untitled\n\n").map_err(|e| e.to_string())?;
    read_note_file(&path)
}

#[tauri::command]
fn save_note(note: NoteDocument) -> Result<NoteDocument, String> {
    let path = PathBuf::from(&note.path);
    let front = FrontMatter { title: Some(title_from_body(&note.body, &note.title)), tags: if note.tags.is_empty() { None } else { Some(note.tags) }, created: note.created, updated: note.updated_at };
    let yaml = serde_yaml::to_string(&front).map_err(|e| e.to_string())?;
    let content = format!("---\n{}---\n\n{}", yaml, note.body);
    let temporary = path.with_extension("md.tmp");
    fs::write(&temporary, content).map_err(|e| e.to_string())?;
    if path.exists() { fs::remove_file(&path).map_err(|e| e.to_string())?; }
    fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
    read_note_file(&path)
}

pub fn run() {
    tauri::Builder::default().plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![load_library, read_note, create_note, save_note])
        .run(tauri::generate_context!()).expect("error while running Markdown Notes");
}

#[cfg(test)]
mod tests {
    use super::split_front_matter;

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
}
