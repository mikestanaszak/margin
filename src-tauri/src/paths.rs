use std::{
    fs,
    path::{Path, PathBuf},
};
use unicode_normalization::UnicodeNormalization;

pub(crate) fn is_markdown_path(path: &Path) -> bool {
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
pub(crate) fn canonical_library_root(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let root = fs::canonicalize(path.as_ref())
        .map_err(|error| format!("Choose an existing notes folder: {error}"))?;
    if !root.is_dir() {
        return Err("Choose an existing notes folder".into());
    }
    Ok(root)
}

pub(crate) fn relative_note_id(library: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(library)
        .map_err(|_| "Note is outside the selected library")?;
    if relative.as_os_str().is_empty() || !is_markdown_path(relative) {
        return Err("Choose a Markdown note inside the selected library".into());
    }
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

pub(crate) fn reject_symlink_components(library: &Path, candidate: &Path) -> Result<(), String> {
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

pub(crate) fn existing_library_path(
    library: &Path,
    raw: impl AsRef<Path>,
) -> Result<PathBuf, String> {
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

pub(crate) fn library_path_for_relative(library: &Path, relative: &str) -> Result<PathBuf, String> {
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

pub(crate) fn folder_for_path(library: &Path, path: &Path) -> String {
    path.parent()
        .and_then(|parent| parent.strip_prefix(library).ok())
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// Returns the path of a directory itself relative to the selected library.
/// `folder_for_path` intentionally returns a note's parent, so it must not be
/// used for a folder: doing so turns `Work/Planning` into just `Work` and makes
/// a top-level folder look like the library root.
pub(crate) fn relative_folder_path(library: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(library)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "Folder is outside the selected library".into())
}

/// Converts an app-provided folder name into a path that is guaranteed to stay
/// inside the selected library. Notes stay ordinary files in these folders.
pub(crate) fn library_folder(library: &Path, folder: Option<String>) -> Result<PathBuf, String> {
    library_path_for_relative(library, folder.as_deref().unwrap_or_default())
}

pub(crate) fn unique_path(parent: &Path, stem: &str) -> PathBuf {
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

pub(crate) const MAX_FILE_STEM_BYTES: usize = 240;

pub(crate) fn truncate_utf8(value: &str, max_bytes: usize) -> String {
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
pub(crate) fn safe_file_stem(title: &str) -> String {
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

pub(crate) fn path_for_title(source: &Path, title: &str) -> Result<PathBuf, String> {
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

pub(crate) fn unique_directory_path(requested: &Path) -> Result<PathBuf, String> {
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

#[cfg(test)]
mod tests {
    #![allow(unused_imports)]

    use crate::{
        assets::*,
        capture::*,
        library::*,
        model::*,
        notes::*,
        paths::*,
        test_support::{copy_example_library, temporary_library},
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        thread,
        time::Duration,
    };
    use walkdir::WalkDir;

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
}
