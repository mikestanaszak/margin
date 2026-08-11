use crate::assets::is_managed_note_asset_directory;
use crate::model::{IndexWarning, IndexWarningKind, LibrarySnapshot, NoteDocument, NoteSummary};
use crate::notes::{
    note_excerpt, note_ids_match, read_library_note_file_for_index,
    resolve_relative_markdown_target,
};
#[cfg(test)]
use crate::paths::canonical_library_root;
use crate::paths::{folder_for_path, is_markdown_path, relative_note_id};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::State;
use walkdir::WalkDir;

/// A process-owned snapshot keeps note contents and search data out of the
/// webview. The watcher marks the snapshot stale; the next normal refresh
/// rebuilds it, while a low-frequency reconciliation catches missed events.
/// Margin deliberately indexes one selected library at a time.
pub(crate) struct LibraryIndex(Mutex<Option<IndexedLibrary>>);

struct IndexedLibrary {
    path: PathBuf,
    snapshot: LibrarySnapshot,
    dirty: Arc<AtomicBool>,
    reconciled_at: Instant,
    _watcher: RecommendedWatcher,
}

const INDEX_RECONCILIATION_INTERVAL: Duration = Duration::from_secs(45);

#[derive(Clone, Serialize)]
pub(crate) struct SearchResult {
    #[serde(flatten)]
    pub(crate) note: NoteSummary,
    pub(crate) score: u32,
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SearchScope {
    #[default]
    Notes,
    Trash,
}

impl LibraryIndex {
    pub(crate) fn new() -> Self {
        Self(Mutex::new(None))
    }

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
            warnings: Vec::new(),
        };
    };
    let (notes, folders, mut warnings) = load_library_contents(&library);
    LibrarySnapshot {
        notes,
        folders,
        trash: load_trash_contents(&library, &mut warnings),
        warnings,
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
        ),
        excerpt: note_excerpt(&note.body),
        path: note.path,
        title: note.title,
        tags: note.tags,
        updated: note.updated,
        folder,
    }
}

fn push_index_warning(warnings: &mut Vec<IndexWarning>, path: &Path, kind: IndexWarningKind) {
    warnings.push(IndexWarning {
        path: path.to_string_lossy().to_string(),
        kind,
    });
}

fn collect_library_entry(
    library: &Path,
    entry: Result<walkdir::DirEntry, walkdir::Error>,
    notes: &mut Vec<NoteSummary>,
    folders: &mut Vec<String>,
    warnings: &mut Vec<IndexWarning>,
) {
    let entry = match entry {
        Ok(entry) => entry,
        Err(error) => {
            push_index_warning(
                warnings,
                error.path().unwrap_or(library),
                IndexWarningKind::Walk,
            );
            return;
        }
    };
    if entry.file_type().is_symlink() {
        return;
    }
    if entry.file_type().is_dir() {
        if let Ok(relative) = entry.path().strip_prefix(library) {
            let folder = relative.to_string_lossy().replace('\\', "/");
            if !folder.is_empty() {
                folders.push(folder);
            }
        }
    } else if entry.file_type().is_file() && is_markdown_path(entry.path()) {
        match read_library_note_file_for_index(library, entry.path()) {
            Ok((note, warning)) => {
                notes.push(note_summary(note, library));
                if let Some(kind) = warning {
                    push_index_warning(warnings, entry.path(), kind);
                }
            }
            Err(kind) => push_index_warning(warnings, entry.path(), kind),
        }
    }
}

fn load_library_contents(library: &Path) -> (Vec<NoteSummary>, Vec<String>, Vec<IndexWarning>) {
    let mut notes = Vec::new();
    let mut folders = Vec::new();
    let mut warnings = Vec::new();
    for entry in WalkDir::new(library)
        .min_depth(1)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.file_name() != ".markdown-notes" && !is_managed_note_asset_directory(entry.path())
        })
    {
        collect_library_entry(library, entry, &mut notes, &mut folders, &mut warnings);
    }
    notes.sort_by_key(|note| std::cmp::Reverse(note.updated));
    folders.sort_by_key(|folder| folder.to_lowercase());
    (notes, folders, warnings)
}

#[cfg(test)]
#[tauri::command]
pub(crate) fn load_library(library_path: String) -> Result<Vec<NoteSummary>, String> {
    let library = canonical_library_root(library_path)?;
    Ok(load_library_contents(&library).0)
}

#[tauri::command]
pub(crate) fn load_library_snapshot(
    library_index: State<'_, LibraryIndex>,
    library_path: String,
    force: Option<bool>,
) -> Result<LibrarySnapshot, String> {
    library_index.snapshot(&library_path, force.unwrap_or(false))
}

#[derive(Debug, PartialEq, Eq)]
enum LinkTarget {
    Wiki(String),
    Markdown(String),
}

fn link_targets(text: &str) -> Vec<LinkTarget> {
    let mut targets = Vec::new();
    let mut remaining = text;
    while let Some(start) = remaining.find("[[") {
        let after_start = &remaining[start + 2..];
        let Some(end) = after_start.find("]]") else {
            break;
        };
        let target = after_start[..end].split('|').next().unwrap_or("").trim();
        if !target.is_empty() {
            targets.push(LinkTarget::Wiki(target.to_string()));
        }
        remaining = &after_start[end + 2..];
    }

    let mut fenced = false;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
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
            if line[..marker].matches('`').count() % 2 == 0 {
                let target = &line[target_start..target_end];
                if !target.is_empty() {
                    targets.push(LinkTarget::Markdown(target.to_string()));
                }
            }
            cursor = target_end + 1;
        }
    }
    targets
}

#[tauri::command]
pub(crate) fn search_library(
    library_index: State<'_, LibraryIndex>,
    library_path: String,
    query: String,
    scope: Option<SearchScope>,
) -> Result<Vec<SearchResult>, String> {
    Ok(search_snapshot(
        &library_index.snapshot(&library_path, false)?,
        &query,
        scope.unwrap_or_default(),
    ))
}

#[tauri::command]
pub(crate) fn find_backlinks(
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

fn search_snapshot(
    snapshot: &LibrarySnapshot,
    query: &str,
    scope: SearchScope,
) -> Vec<SearchResult> {
    let query = query.trim().to_lowercase();
    let notes = match scope {
        SearchScope::Notes => &snapshot.notes,
        SearchScope::Trash => &snapshot.trash,
    };
    if query.is_empty() {
        let mut results = notes
            .iter()
            .cloned()
            .map(|note| SearchResult { note, score: 0 })
            .collect::<Vec<_>>();
        results.sort_by(|left, right| {
            right
                .note
                .updated
                .cmp(&left.note.updated)
                .then_with(|| left.note.path.cmp(&right.note.path))
        });
        return results;
    }

    let mut results = notes
        .iter()
        .filter_map(|note| {
            let title = note.title.to_lowercase();
            let path = note.id.to_lowercase();
            let tags = note
                .tags
                .iter()
                .map(|tag| tag.to_lowercase())
                .collect::<Vec<_>>();
            let score = if title == query {
                500
            } else if title.starts_with(&query) {
                450
            } else if title.contains(&query) {
                400
            } else if path.contains(&query) {
                300
            } else if tags.iter().any(|tag| tag == &query) {
                250
            } else if tags.iter().any(|tag| tag.contains(&query)) {
                200
            } else if note.searchable_text.to_lowercase().contains(&query) {
                100
            } else {
                return None;
            };
            Some(SearchResult {
                note: note.clone(),
                score,
            })
        })
        .collect::<Vec<_>>();
    results.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| right.note.updated.cmp(&left.note.updated))
            .then_with(|| left.note.path.cmp(&right.note.path))
    });
    results
}

fn backlinks_for_snapshot(
    snapshot: &LibrarySnapshot,
    note_path: &str,
    title: &str,
) -> Vec<NoteSummary> {
    fn unique_title_target<'a>(snapshot: &'a LibrarySnapshot, title: &str) -> Option<&'a str> {
        let title = title.to_lowercase();
        let mut matches = snapshot
            .notes
            .iter()
            .filter(|note| note.title.to_lowercase() == title);
        let target = matches.next()?;
        matches.next().is_none().then_some(target.id.as_str())
    }

    let target_id = snapshot
        .notes
        .iter()
        .find(|note| note_ids_match(&note.path, note_path) || note_ids_match(&note.id, note_path))
        .map(|note| note.id.as_str())
        .or_else(|| unique_title_target(snapshot, title));
    let Some(target_id) = target_id else {
        return Vec::new();
    };

    snapshot
        .notes
        .iter()
        .filter(|item| {
            !note_ids_match(&item.id, target_id)
                && link_targets(&item.searchable_text)
                    .iter()
                    .any(|link| match link {
                        LinkTarget::Wiki(target) => unique_title_target(snapshot, target)
                            .is_some_and(|resolved| note_ids_match(resolved, target_id)),
                        LinkTarget::Markdown(target) => {
                            resolve_relative_markdown_target(&item.id, target)
                                .is_some_and(|resolved| note_ids_match(&resolved, target_id))
                        }
                    })
        })
        .cloned()
        .collect()
}

fn load_trash_contents(library: &Path, warnings: &mut Vec<IndexWarning>) -> Vec<NoteSummary> {
    let trash = library.join(".markdown-notes").join("trash");
    if !trash.exists() {
        return Vec::new();
    }
    let mut notes = Vec::new();
    for entry in WalkDir::new(&trash).follow_links(false) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                push_index_warning(
                    warnings,
                    error.path().unwrap_or(&trash),
                    IndexWarningKind::Walk,
                );
                continue;
            }
        };
        if entry.file_type().is_symlink()
            || !entry.file_type().is_file()
            || !is_markdown_path(entry.path())
        {
            continue;
        }
        match read_library_note_file_for_index(library, entry.path()) {
            Ok((note, warning)) => {
                notes.push(NoteSummary {
                    folder: "Trash".into(),
                    ..note_summary(note, library)
                });
                if let Some(kind) = warning {
                    push_index_warning(warnings, entry.path(), kind);
                }
            }
            Err(kind) => push_index_warning(warnings, entry.path(), kind),
        }
    }
    notes.sort_by_key(|note| std::cmp::Reverse(note.updated));
    notes
}

#[cfg(test)]
mod tests {
    use super::{
        backlinks_for_snapshot, build_library_snapshot, collect_library_entry, load_library,
        search_snapshot, LibraryIndex, SearchScope,
    };
    use crate::{
        model::{IndexWarningKind, LibrarySnapshot, NoteSummary},
        test_support::{copy_example_library, temporary_library},
    };
    use std::{fs, thread, time::Duration};
    use walkdir::WalkDir;

    fn searchable_note(
        path: &str,
        title: &str,
        tags: &[&str],
        body: &str,
        updated: u64,
    ) -> NoteSummary {
        NoteSummary {
            id: path.to_string(),
            path: path.to_string(),
            title: title.to_string(),
            tags: tags.iter().map(|tag| (*tag).to_string()).collect(),
            updated,
            searchable_text: format!("{title} {path} {} {body}", tags.join(" ")),
            excerpt: body.to_string(),
            folder: String::new(),
        }
    }

    #[test]
    fn ranked_search_prioritizes_title_path_tags_and_body() {
        let snapshot = LibrarySnapshot {
            notes: vec![
                searchable_note("Body.md", "Meeting notes", &[], "alpha appears here", 50),
                searchable_note("Tags.md", "Labels", &["alpha"], "ordinary body", 60),
                searchable_note(
                    "Work/alpha-reference.md",
                    "Reference",
                    &[],
                    "ordinary body",
                    70,
                ),
                searchable_note("Prefix.md", "Alpha planning", &[], "ordinary body", 80),
                searchable_note("Exact.md", "Alpha", &[], "ordinary body", 10),
            ],
            folders: Vec::new(),
            trash: Vec::new(),
            warnings: Vec::new(),
        };

        let results = search_snapshot(&snapshot, "  ALPHA  ", SearchScope::Notes);
        let titles = results
            .iter()
            .map(|result| result.note.title.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            titles,
            [
                "Alpha",
                "Alpha planning",
                "Reference",
                "Labels",
                "Meeting notes"
            ]
        );
        assert!(results.windows(2).all(|pair| pair[0].score > pair[1].score));
    }

    #[test]
    fn ranked_search_empty_query_returns_recent_notes() {
        let snapshot = LibrarySnapshot {
            notes: vec![
                searchable_note("Old.md", "Old", &[], "", 10),
                searchable_note("Newest.md", "Newest", &[], "", 30),
                searchable_note("Middle.md", "Middle", &[], "", 20),
            ],
            folders: Vec::new(),
            trash: Vec::new(),
            warnings: Vec::new(),
        };

        let results = search_snapshot(&snapshot, "   ", SearchScope::Notes);
        assert_eq!(
            results
                .iter()
                .map(|result| result.note.title.as_str())
                .collect::<Vec<_>>(),
            ["Newest", "Middle", "Old"]
        );
        assert!(results.iter().all(|result| result.score == 0));
    }

    #[test]
    fn ranked_search_breaks_equal_scores_by_updated_time_then_path() {
        let snapshot = LibrarySnapshot {
            notes: vec![
                searchable_note("B.md", "Alpha beta", &[], "", 30),
                searchable_note("C.md", "Alpha gamma", &[], "", 20),
                searchable_note("A.md", "Alpha apple", &[], "", 30),
            ],
            folders: Vec::new(),
            trash: Vec::new(),
            warnings: Vec::new(),
        };

        let results = search_snapshot(&snapshot, "alpha", SearchScope::Notes);

        assert_eq!(
            results
                .iter()
                .map(|result| result.note.path.as_str())
                .collect::<Vec<_>>(),
            ["A.md", "B.md", "C.md"]
        );
        assert!(results
            .windows(2)
            .all(|pair| pair[0].score == pair[1].score));
    }

    #[test]
    fn ranked_search_scope_separates_active_and_deleted_notes() {
        let snapshot = LibrarySnapshot {
            notes: vec![searchable_note("Active.md", "Alpha active", &[], "", 10)],
            folders: Vec::new(),
            trash: vec![searchable_note(
                ".markdown-notes/trash/Deleted.md",
                "Alpha deleted",
                &[],
                "",
                20,
            )],
            warnings: Vec::new(),
        };

        let active = search_snapshot(&snapshot, "alpha", SearchScope::Notes);
        let deleted = search_snapshot(&snapshot, "alpha", SearchScope::Trash);

        assert_eq!(active.len(), 1);
        assert_eq!(active[0].note.title, "Alpha active");
        assert_eq!(deleted.len(), 1);
        assert_eq!(deleted[0].note.title, "Alpha deleted");
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
    fn library_snapshot_reports_index_warnings() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("Unreadable.md"), [0xff, 0xfe, 0xfd]).unwrap();

        let snapshot = build_library_snapshot(&library);
        assert_eq!(snapshot.notes.len(), 0);
        assert_eq!(snapshot.warnings.len(), 1);
        assert_eq!(
            snapshot.warnings[0].kind,
            IndexWarningKind::UnreadableMarkdown
        );
        assert!(snapshot.warnings[0].path.ends_with("Unreadable.md"));

        let removed = library.join("Removed");
        let entry = WalkDir::new(&removed)
            .into_iter()
            .next()
            .expect("missing directory must produce a walk result");
        let mut notes = Vec::new();
        let mut folders = Vec::new();
        let mut warnings = Vec::new();
        collect_library_entry(&library, entry, &mut notes, &mut folders, &mut warnings);
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].kind, IndexWarningKind::Walk);
        assert!(warnings[0].path.ends_with("Removed"));

        fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn library_snapshot_keeps_notes_with_invalid_metadata_indexable() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        fs::write(
            library.join("Broken.md"),
            "---\ntags: [unclosed\n---\n\n# Fallback title\n\nBody text",
        )
        .unwrap();

        let snapshot = build_library_snapshot(&library);
        assert_eq!(snapshot.notes.len(), 1);
        assert_eq!(snapshot.notes[0].title, "Fallback title");
        assert_eq!(snapshot.warnings.len(), 1);
        assert_eq!(snapshot.warnings[0].kind, IndexWarningKind::InvalidMetadata);

        fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn library_snapshot_omits_note_asset_directories() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let result = (|| -> Result<(), String> {
            fs::create_dir_all(
                library
                    .join("Projects")
                    .join("Project.assets")
                    .join("nested"),
            )
            .map_err(|error| error.to_string())?;
            fs::write(library.join("Projects").join("Project.md"), "# Project\n")
                .map_err(|error| error.to_string())?;
            fs::write(
                library
                    .join("Projects")
                    .join("Project.assets")
                    .join("nested")
                    .join("photo.png"),
                b"image",
            )
            .map_err(|error| error.to_string())?;

            let snapshot = build_library_snapshot(&library);
            assert_eq!(snapshot.folders, ["Projects"]);
            assert_eq!(snapshot.notes.len(), 1);
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn example_library_indexes_realistic_portable_markdown() {
        let library = copy_example_library().unwrap();
        let result = (|| -> Result<(), String> {
            let snapshot = build_library_snapshot(&library);
            let notes = &snapshot.notes;
            assert_eq!(notes.len(), 8);
            assert!(!notes.iter().any(|note| note.title == "Deleted note"));

            let welcome = notes
                .iter()
                .find(|note| note.title == "Welcome to Margin")
                .ok_or("Welcome fixture was not indexed")?;
            assert_eq!(welcome.tags, ["welcome", "Demo"]);
            assert!(welcome
                .searchable_text
                .to_lowercase()
                .contains("localfirst = true"));

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

            assert_eq!(snapshot.trash.len(), 1);
            assert_eq!(
                snapshot.folders,
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
            .to_lowercase()
            .contains("changed outside margin"));

        fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn native_index_watches_changes_and_reconciles_on_demand() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let path = library.join("Watched.md");
        fs::write(&path, "# Before\n\nOriginal text").unwrap();
        let index = LibraryIndex::new();
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
            let search_results = search_snapshot(&snapshot, "alpine", SearchScope::Notes);
            assert_eq!(search_results.len(), 1);
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
            let search_payload =
                serde_json::to_value(&search_results).map_err(|error| error.to_string())?;
            assert!(!search_payload.to_string().contains("alpine architecture"));
            assert!(!search_payload.to_string().contains("searchable_text"));
            assert_eq!(search_payload[0]["score"], 100);
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn backlinks_include_resolved_markdown_and_wiki_links() {
        let snapshot = LibrarySnapshot {
            notes: vec![
                searchable_note("Work/Alpha.md", "Alpha", &[], "Target note", 10),
                searchable_note(
                    "Reference/Markdown.md",
                    "Markdown reference",
                    &[],
                    "See [Alpha](../Work/Alpha.md).",
                    20,
                ),
                searchable_note(
                    "Reference/Wiki.md",
                    "Wiki reference",
                    &[],
                    "See [[Alpha]].",
                    30,
                ),
                searchable_note(
                    "Reference/PlatformCase.md",
                    "Platform-case reference",
                    &[],
                    "See [Alpha](../work/alpha.md).",
                    35,
                ),
                searchable_note(
                    "Reference/Unsafe.md",
                    "Unsafe references",
                    &[],
                    "[external](https://example.com/Work/Alpha.md)\n\
                     [anchor](../Work/Alpha.md#part)\n\
                     [absolute](/Work/Alpha.md)\n\
                     [escaped](../../Work/Alpha.md)\n\
                     [missing](../Work/Missing.md)",
                    40,
                ),
                searchable_note("One/Duplicate.md", "Duplicate", &[], "Target one", 50),
                searchable_note("Two/Duplicate.md", "Duplicate", &[], "Target two", 60),
                searchable_note(
                    "Reference/Ambiguous.md",
                    "Ambiguous reference",
                    &[],
                    "See [[Duplicate]].",
                    70,
                ),
                searchable_note(
                    "Work/Alpha Note.md",
                    "Alpha Note",
                    &[],
                    "Encoded target",
                    80,
                ),
                searchable_note(
                    "Reference/Encoded.md",
                    "Encoded reference",
                    &[],
                    "See [Alpha Note](../Work/Alpha%20Note.md).",
                    90,
                ),
                searchable_note(
                    "Reference/DoubleEncoded.md",
                    "Double-encoded reference",
                    &[],
                    "See [Alpha Note](../Work/Alpha%2520Note.md).",
                    100,
                ),
                searchable_note(
                    "Reference/mailto:Alpha.md",
                    "Mail-shaped filename",
                    &[],
                    "Portable edge case",
                    110,
                ),
                searchable_note(
                    "Reference/Mail.md",
                    "Mail link",
                    &[],
                    "See [mail](mailto:Alpha.md).",
                    120,
                ),
            ],
            folders: Vec::new(),
            trash: Vec::new(),
            warnings: Vec::new(),
        };

        let backlinks = backlinks_for_snapshot(&snapshot, "Work/Alpha.md", "Alpha");
        let titles = backlinks
            .iter()
            .map(|note| note.title.as_str())
            .collect::<Vec<_>>();
        if cfg!(any(target_os = "windows", target_os = "macos")) {
            assert_eq!(
                titles,
                [
                    "Markdown reference",
                    "Wiki reference",
                    "Platform-case reference"
                ]
            );
        } else {
            assert_eq!(titles, ["Markdown reference", "Wiki reference"]);
        }

        assert!(backlinks_for_snapshot(&snapshot, "One/Duplicate.md", "Duplicate").is_empty());

        let encoded = backlinks_for_snapshot(&snapshot, "Work/Alpha Note.md", "Alpha Note");
        assert_eq!(
            encoded
                .iter()
                .map(|note| note.title.as_str())
                .collect::<Vec<_>>(),
            ["Encoded reference"]
        );

        assert!(backlinks_for_snapshot(
            &snapshot,
            "Reference/mailto:Alpha.md",
            "Mail-shaped filename"
        )
        .is_empty());
    }
}
