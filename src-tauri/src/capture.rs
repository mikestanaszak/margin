use crate::model::NoteDocument;
use crate::notes::{
    body_with_title, managed_note, now_rfc3339, read_note_file, save_note_document,
};
use crate::paths::{canonical_library_root, existing_library_path, library_folder, unique_path};
use chrono::Local;
use std::fs;

#[tauri::command]
pub(crate) fn append_quick_note(
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
pub(crate) fn import_daily_note(
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
pub(crate) fn import_daily_note_to_new_note(
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

#[cfg(test)]
mod tests {
    use super::{append_quick_note, import_daily_note, import_daily_note_to_new_note};
    use crate::{
        notes::{create_note, save_note_document},
        test_support::temporary_library,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
    };

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
}
