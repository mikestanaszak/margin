use tauri::Manager;

mod assets;
mod capture;
mod library;
mod model;
mod notes;
mod paths;
#[cfg(test)]
mod test_support;
mod windows;

use assets::{import_note_image_from_bytes, import_note_image_from_path};
use capture::{append_quick_note, import_daily_note, import_daily_note_to_new_note};
use library::{find_backlinks, load_library_snapshot, search_library, LibraryIndex};
use notes::{
    create_folder, create_note, delete_note_permanently, duplicate_note, import_markdown_file,
    move_folder_to_trash, move_note_to_folder, move_note_to_trash, read_note, rename_folder,
    restore_note_from_trash, reveal_note_in_file_manager, save_note,
};
use windows::{
    configure_quick_capture_shortcut, default_capture_shortcut, handle_global_shortcut,
    handle_run_event, handle_window_event, hide_quick_capture, load_selected_library,
    open_external_url, save_selected_library, setup as setup_windows, show_quick_capture,
    take_opened_markdown_files,
};

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
                    handle_global_shortcut(app, shortcut, event);
                })
                .build(),
        )
        .setup(move |app| {
            app.manage(LibraryIndex::new());
            setup_windows(app, default_capture).map_err(Into::into)
        })
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            load_library_snapshot,
            search_library,
            find_backlinks,
            read_note,
            create_note,
            create_folder,
            rename_folder,
            save_note,
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
            take_opened_markdown_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building Margin")
        .run(handle_run_event);
}
