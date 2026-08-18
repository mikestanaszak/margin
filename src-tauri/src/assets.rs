use crate::model::ImportedImage;
use crate::notes::{scan_markdown_links, LinkTarget};
use crate::paths::{
    canonical_library_root, existing_library_path, is_markdown_path, reject_symlink_components,
    safe_file_stem,
};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};

fn markdown_asset_directory(path: &Path) -> Option<PathBuf> {
    let canonical = fs::canonicalize(path).ok()?;
    if canonical.is_file() && is_markdown_path(&canonical) {
        canonical.parent().map(Path::to_path_buf)
    } else {
        None
    }
}

pub(crate) fn allow_asset_directory(app: &AppHandle, directory: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(directory, true)
        .map_err(|error| format!("Could not allow note images: {error}"))
}

pub(crate) fn allow_opened_markdown_assets(
    app: &AppHandle,
    paths: &[String],
) -> Result<(), String> {
    for path in paths {
        if let Some(directory) = markdown_asset_directory(Path::new(path)) {
            allow_asset_directory(app, &directory)?;
        }
    }
    Ok(())
}

pub(crate) fn is_managed_note_asset_directory(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(stem) = name.strip_suffix(".assets").filter(|stem| !stem.is_empty()) else {
        return false;
    };
    let Some(parent) = path.parent() else {
        return false;
    };

    fs::read_dir(parent)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .any(|entry| {
            entry.file_type().is_ok_and(|file_type| file_type.is_file())
                && is_markdown_path(&entry.path())
                && entry
                    .path()
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .is_some_and(|note_stem| note_stem == stem)
        })
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

pub(crate) fn asset_directory_for_note(note: &Path) -> Result<PathBuf, String> {
    let parent = note.parent().ok_or("Note has no parent folder")?;
    let stem = note
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Note filename is invalid")?;
    Ok(parent.join(format!("{}.assets", stem)))
}

pub(crate) fn rewrite_note_asset_references(
    body: &str,
    source: &Path,
    destination: &Path,
) -> String {
    let source_folder = asset_directory_for_note(source)
        .ok()
        .and_then(|path| path.file_name()?.to_str().map(str::to_owned));
    let destination_folder = asset_directory_for_note(destination)
        .ok()
        .and_then(|path| path.file_name()?.to_str().map(str::to_owned));
    let (Some(source_folder), Some(destination_folder)) = (source_folder, destination_folder)
    else {
        return body.to_string();
    };
    if source_folder == destination_folder {
        return body.to_string();
    }
    body.replace(
        &format!("{source_folder}/"),
        &format!("{destination_folder}/"),
    )
    .replace(
        &format!("{source_folder}\\"),
        &format!("{destination_folder}\\"),
    )
}

fn percent_decode_path(value: &str) -> Result<String, ()> {
    fn hex_value(value: u8) -> Option<u8> {
        match value {
            b'0'..=b'9' => Some(value - b'0'),
            b'a'..=b'f' => Some(value - b'a' + 10),
            b'A'..=b'F' => Some(value - b'A' + 10),
            _ => None,
        }
    }

    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] != b'%' {
            decoded.push(bytes[cursor]);
            cursor += 1;
            continue;
        }
        if cursor + 2 >= bytes.len() {
            return Err(());
        }
        let high = hex_value(bytes[cursor + 1]).ok_or(())?;
        let low = hex_value(bytes[cursor + 2]).ok_or(())?;
        decoded.push(high * 16 + low);
        cursor += 3;
    }
    String::from_utf8(decoded).map_err(|_| ())
}

fn has_unambiguous_inline_destination(
    markdown: &str,
    target_start: usize,
    scanned_target_end: usize,
    target: &str,
) -> bool {
    if target.starts_with('<') {
        return target.len() >= 2
            && target.ends_with('>')
            && !target[1..target.len() - 1].contains(['\n', '\r']);
    }
    if target.bytes().any(|value| value.is_ascii_whitespace()) {
        return false;
    }

    let bytes = markdown.as_bytes();
    let mut cursor = target_start;
    let mut nested_parentheses = 0usize;
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'\\' => cursor = cursor.saturating_add(2),
            b'(' => {
                nested_parentheses += 1;
                cursor += 1;
            }
            b')' if nested_parentheses > 0 => {
                nested_parentheses -= 1;
                cursor += 1;
            }
            b')' => return cursor == scanned_target_end,
            b'\n' | b'\r' => return false,
            _ => cursor += 1,
        }
    }
    false
}

fn referenced_note_assets(note: &Path, markdown: &str) -> Result<Option<HashSet<PathBuf>>, String> {
    let directory = asset_directory_for_note(note)?;
    let folder_name = directory
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Image folder name is invalid")?;
    let links = scan_markdown_links(markdown);
    let markdown_target_ranges: Vec<_> = links
        .iter()
        .filter_map(|link| {
            matches!(link.target, LinkTarget::Markdown(_))
                .then_some(link.target_start..link.target_end)
        })
        .collect();
    let mut referenced = HashSet::new();

    for link in links {
        let target_start = link.target_start;
        let target_end = link.target_end;
        let LinkTarget::Markdown(raw_target) = link.target else {
            continue;
        };
        if !has_unambiguous_inline_destination(markdown, target_start, target_end, &raw_target) {
            let decoded = percent_decode_path(raw_target.trim()).ok();
            if raw_target.contains(folder_name)
                || raw_target.contains(".assets")
                || decoded.as_deref().is_some_and(|target| {
                    target.contains(folder_name) || target.contains(".assets")
                })
            {
                return Ok(None);
            }
            continue;
        }
        let mut target = raw_target.trim();
        if target.starts_with('<') {
            let Some(inner) = target
                .strip_prefix('<')
                .and_then(|value| value.strip_suffix('>'))
            else {
                if target.contains(folder_name) || target.contains(".assets") {
                    return Ok(None);
                }
                continue;
            };
            target = inner;
        }
        let suffix = target.find(['?', '#']).unwrap_or(target.len());
        target = &target[..suffix];
        let decoded = match percent_decode_path(target) {
            Ok(decoded) => decoded.replace('\\', "/"),
            Err(()) => {
                if target.contains(folder_name) || target.contains(".assets") {
                    return Ok(None);
                }
                continue;
            }
        };
        let path = Path::new(&decoded);
        let components: Vec<_> = path.components().collect();
        let is_local_asset = components.first().is_some_and(
            |component| matches!(component, Component::Normal(name) if *name == folder_name),
        );
        if !is_local_asset {
            continue;
        }
        if components.len() != 2
            || !matches!(components[1], Component::Normal(_))
            || components
                .iter()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Ok(None);
        }
        let Component::Normal(file_name) = components[1] else {
            return Ok(None);
        };
        let candidate = directory.join(file_name);
        referenced.insert(fs::canonicalize(&candidate).unwrap_or(candidate));
    }

    for (start, _) in markdown.match_indices(".assets") {
        if !markdown_target_ranges
            .iter()
            .any(|range| range.contains(&start))
        {
            return Ok(None);
        }
    }

    Ok(Some(referenced))
}

pub(crate) fn cleanup_unreferenced_note_assets(
    library: &Path,
    note: &Path,
    markdown: &str,
) -> Result<(), String> {
    let directory = asset_directory_for_note(note)?;
    if !directory.exists() {
        return Ok(());
    }
    reject_symlink_components(library, &directory)?;
    if !directory.is_dir() {
        return Err("The note's asset path is not a folder".into());
    }
    let Some(referenced) = referenced_note_assets(note, markdown)? else {
        return Ok(());
    };
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_file() {
            continue;
        }
        let entry_path = fs::canonicalize(entry.path()).map_err(|error| error.to_string())?;
        if !referenced.contains(&entry_path) {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    if fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
        .next()
        .is_none()
    {
        fs::remove_dir(&directory).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn move_note_assets(
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

fn copy_asset_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            return Err("Symlinks inside a Margin library are not supported".into());
        }
        if file_type.is_dir() {
            copy_asset_directory(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn copy_note_assets(
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
    copy_asset_directory(&source_assets, &destination_assets)
}

pub(crate) fn move_note_and_assets(
    library: &Path,
    source: &Path,
    destination: &Path,
) -> Result<(), String> {
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
pub(crate) fn import_note_image_from_path(
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
pub(crate) fn import_note_image_from_bytes(
    note_path: String,
    filename: String,
    bytes: Vec<u8>,
    library_path: String,
) -> Result<ImportedImage, String> {
    let library = canonical_library_root(library_path)?;
    store_note_image(&library, Path::new(&note_path), &filename, bytes)
}

#[cfg(test)]
mod tests {
    use super::{cleanup_unreferenced_note_assets, markdown_asset_directory};
    use crate::{
        model::SaveNoteResult,
        notes::{duplicate_note, read_note_file, save_note},
        test_support::temporary_library,
    };
    use std::fs;

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
    fn saving_a_note_removes_only_unreferenced_direct_image_assets() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let note_path = library.join("Images.md");
        let assets = library.join("Images.assets");
        let result = (|| -> Result<(), String> {
            fs::write(&note_path, "# Images\n\n![Keep](Images.assets/keep.png)\n")
                .map_err(|error| error.to_string())?;
            fs::create_dir_all(&assets).map_err(|error| error.to_string())?;
            fs::write(assets.join("keep.png"), b"keep").map_err(|error| error.to_string())?;
            fs::write(assets.join("removed.png"), b"remove").map_err(|error| error.to_string())?;

            let note =
                read_note_file(&fs::canonicalize(&note_path).map_err(|error| error.to_string())?)?;
            let saved = match save_note(note, library_path.clone()) {
                SaveNoteResult::Saved { note } => note,
                SaveNoteResult::Conflict { .. } => return Err("unexpected save conflict".into()),
                SaveNoteResult::Error { message } => return Err(message),
            };
            assert!(assets.join("keep.png").exists());
            assert!(!assets.join("removed.png").exists());

            let mut without_image = saved;
            without_image.body = "# Images\n".into();
            match save_note(without_image, library_path) {
                SaveNoteResult::Saved { .. } => {}
                SaveNoteResult::Conflict { .. } => return Err("unexpected save conflict".into()),
                SaveNoteResult::Error { message } => return Err(message),
            }
            assert!(!assets.exists());
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn cleanup_preserves_percent_encoded_direct_image_assets() {
        let cases = [
            ("Images.assets/My%20image.png", "My image.png"),
            ("Images.assets/caf%C3%A9.png", "café.png"),
            ("<Images.assets/My%20image.png>", "My image.png"),
            ("Images.assets/My%20image.png?raw=1#preview", "My image.png"),
            ("Images.assets/100%2525.png", "100%25.png"),
        ];

        for (target, referenced_name) in cases {
            let library = temporary_library();
            fs::create_dir_all(&library).unwrap();
            let note = library.join("Images.md");
            let assets = library.join("Images.assets");
            fs::write(&note, "# Images\n").unwrap();
            fs::create_dir_all(&assets).unwrap();
            fs::write(assets.join(referenced_name), b"keep").unwrap();
            fs::write(assets.join("remove.png"), b"remove").unwrap();

            cleanup_unreferenced_note_assets(&library, &note, &format!("![Keep]({target})\n"))
                .unwrap();

            assert!(
                assets.join(referenced_name).exists(),
                "expected {target} to preserve {referenced_name}"
            );
            assert!(!assets.join("remove.png").exists());
            fs::remove_dir_all(&library).ok();
        }
    }

    #[test]
    fn ambiguous_local_image_references_skip_cleanup() {
        let cases = [
            "![Keep](Images.assets/keep%ZZ.png)",
            "![Keep](Images.assets/../outside.png)",
            "![Keep](Images.assets/keep.png",
        ];

        for markdown in cases {
            let library = temporary_library();
            fs::create_dir_all(&library).unwrap();
            let note = library.join("Images.md");
            let assets = library.join("Images.assets");
            fs::write(&note, "# Images\n").unwrap();
            fs::create_dir_all(&assets).unwrap();
            fs::write(assets.join("keep.png"), b"keep").unwrap();
            fs::write(assets.join("also-keep.png"), b"keep").unwrap();

            cleanup_unreferenced_note_assets(&library, &note, markdown).unwrap();

            assert!(
                assets.join("keep.png").exists(),
                "cleanup should be skipped for {markdown}"
            );
            assert!(assets.join("also-keep.png").exists());
            fs::remove_dir_all(&library).ok();
        }
    }

    #[test]
    fn cleanup_preserves_assets_for_complex_valid_markdown_images() {
        let cases = [
            ("![Keep](Images.assets/a(b).png)", "a(b).png"),
            (
                "![Keep](Images.assets/keep.png \"optional title\")",
                "keep.png",
            ),
            ("![Keep](Images.assets/a\\(b\\).png)", "a(b).png"),
            (
                "![Keep][image]\n\n[image]: Images.assets/keep.png",
                "keep.png",
            ),
            ("![Keep](Images%2Eassets/keep.png)", "keep.png"),
        ];

        for (markdown, referenced_name) in cases {
            let library = temporary_library();
            fs::create_dir_all(&library).unwrap();
            let note = library.join("Images.md");
            let assets = library.join("Images.assets");
            fs::write(&note, "# Images\n").unwrap();
            fs::create_dir_all(&assets).unwrap();
            fs::write(assets.join(referenced_name), b"keep").unwrap();
            fs::write(assets.join("unrelated.png"), b"also keep on ambiguity").unwrap();

            cleanup_unreferenced_note_assets(&library, &note, markdown).unwrap();

            assert!(
                assets.join(referenced_name).exists(),
                "cleanup removed the referenced asset for {markdown}"
            );
            fs::remove_dir_all(&library).ok();
        }
    }

    #[test]
    fn saving_a_renamed_note_updates_its_image_asset_references() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let old_path = library.join("Old title.md");
        let old_assets = library.join("Old title.assets");
        let result = (|| -> Result<(), String> {
            fs::write(
                &old_path,
                "# Old title\n\n![Photo](Old title.assets/photo.png)\n",
            )
            .map_err(|error| error.to_string())?;
            fs::create_dir_all(&old_assets).map_err(|error| error.to_string())?;
            fs::write(old_assets.join("photo.png"), b"photo").map_err(|error| error.to_string())?;

            let mut note =
                read_note_file(&fs::canonicalize(&old_path).map_err(|error| error.to_string())?)?;
            note.body = "# New title\n\n![Photo](Old title.assets/photo.png)\n".into();
            let saved = match save_note(note, library_path) {
                SaveNoteResult::Saved { note } => note,
                SaveNoteResult::Conflict { .. } => return Err("unexpected save conflict".into()),
                SaveNoteResult::Error { message } => return Err(message),
            };

            assert!(saved.path.ends_with("New title.md"));
            assert!(saved.body.contains("New title.assets/photo.png"));
            assert!(!old_assets.exists());
            assert!(library.join("New title.assets").join("photo.png").exists());
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }

    #[test]
    fn duplicating_a_note_copies_its_images_with_rewritten_paths() {
        let library = temporary_library();
        fs::create_dir_all(&library).unwrap();
        let library_path = library.to_string_lossy().to_string();
        let source = library.join("Original.md");
        let source_assets = library.join("Original.assets");
        let result = (|| -> Result<(), String> {
            fs::write(
                &source,
                "# Original\n\n![Photo](Original.assets/photo.png)\n",
            )
            .map_err(|error| error.to_string())?;
            fs::create_dir_all(&source_assets).map_err(|error| error.to_string())?;
            fs::write(source_assets.join("photo.png"), b"photo")
                .map_err(|error| error.to_string())?;

            let duplicate = duplicate_note(
                fs::canonicalize(&source)
                    .map_err(|error| error.to_string())?
                    .to_string_lossy()
                    .to_string(),
                library_path,
            )?;

            assert!(duplicate.path.ends_with("Original copy.md"));
            assert!(duplicate.body.contains("Original copy.assets/photo.png"));
            assert!(library
                .join("Original copy.assets")
                .join("photo.png")
                .exists());
            assert!(source_assets.join("photo.png").exists());
            Ok(())
        })();
        fs::remove_dir_all(&library).ok();
        result.unwrap();
    }
}
