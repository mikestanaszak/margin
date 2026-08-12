use crate::assets::{allow_asset_directory, allow_opened_markdown_assets};
use crate::paths::{canonical_library_root, is_markdown_path};
use serde::Serialize;
use std::{fs, path::PathBuf, sync::Mutex, thread, time::Duration};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    window::Color,
    App, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};
use tauri_plugin_opener::OpenerExt;

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

const QUIT_TIMEOUT: Duration = Duration::from_secs(8);
const SHOW_MENU_ID: &str = "margin-show";
const CAPTURE_MENU_ID: &str = "margin-capture";
const QUIT_MENU_ID: &str = "margin-quit";
const QUIT_ANYWAY_LABEL: &str = "Quit anyway";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QuitAction {
    None,
    Exit,
    ShowMain,
    RequestSave { request_id: u64 },
    ConfirmForceQuit { request_id: u64 },
}

#[derive(Debug, Clone, Copy)]
struct PendingQuit {
    request_id: u64,
    confirmation_open: bool,
}

#[derive(Debug, Default)]
struct QuitCoordinator {
    dirty: bool,
    next_request_id: u64,
    pending: Option<PendingQuit>,
}

impl QuitCoordinator {
    fn set_dirty(&mut self, dirty: bool) {
        self.dirty = dirty;
    }

    fn request_quit(&mut self) -> QuitAction {
        if self.pending.is_some() {
            return QuitAction::None;
        }
        if !self.dirty {
            return QuitAction::Exit;
        }
        self.next_request_id = self.next_request_id.saturating_add(1).max(1);
        let request_id = self.next_request_id;
        self.pending = Some(PendingQuit {
            request_id,
            confirmation_open: false,
        });
        QuitAction::RequestSave { request_id }
    }

    fn complete(&mut self, request_id: u64, saved: bool) -> QuitAction {
        if self
            .pending
            .is_none_or(|pending| pending.request_id != request_id)
        {
            return QuitAction::None;
        }
        self.pending = None;
        if saved {
            self.dirty = false;
            QuitAction::Exit
        } else {
            self.dirty = true;
            QuitAction::ShowMain
        }
    }

    fn timeout(&mut self, request_id: u64) -> QuitAction {
        let Some(pending) = self.pending.as_mut() else {
            return QuitAction::None;
        };
        if pending.request_id != request_id || pending.confirmation_open {
            return QuitAction::None;
        }
        pending.confirmation_open = true;
        QuitAction::ConfirmForceQuit { request_id }
    }

    fn confirm_timeout(&mut self, request_id: u64, quit_anyway: bool) -> QuitAction {
        if self
            .pending
            .is_none_or(|pending| pending.request_id != request_id || !pending.confirmation_open)
        {
            return QuitAction::None;
        }
        self.pending = None;
        if quit_anyway {
            self.dirty = false;
            QuitAction::Exit
        } else {
            QuitAction::ShowMain
        }
    }

    #[cfg(test)]
    fn pending_request_id(&self) -> Option<u64> {
        self.pending.map(|pending| pending.request_id)
    }

    #[cfg(test)]
    fn is_dirty(&self) -> bool {
        self.dirty
    }
}

struct QuitState(Mutex<QuitCoordinator>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuitRequestPayload {
    request_id: u64,
}

fn dialog_result_forces_quit(result: &MessageDialogResult) -> bool {
    matches!(result, MessageDialogResult::No)
        || matches!(result, MessageDialogResult::Custom(label) if label == QUIT_ANYWAY_LABEL)
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
pub(crate) fn take_opened_markdown_files(app: AppHandle) -> Result<Vec<String>, String> {
    let opened = app.state::<OpenedMarkdownFiles>();
    let mut pending = opened
        .0
        .lock()
        .map_err(|_| "Opened Markdown queue is unavailable")?;
    Ok(std::mem::take(&mut *pending))
}

pub(crate) fn default_capture_shortcut() -> Shortcut {
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

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Margin window is unavailable")?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())
}

fn quit_action(app: &AppHandle, action: QuitAction) -> Result<(), String> {
    match action {
        QuitAction::None => Ok(()),
        QuitAction::Exit => {
            app.exit(0);
            Ok(())
        }
        QuitAction::ShowMain => show_main_window(app),
        QuitAction::RequestSave { request_id } => {
            let timeout_app = app.clone();
            thread::spawn(move || {
                thread::sleep(QUIT_TIMEOUT);
                let callback_app = timeout_app.clone();
                let _ = timeout_app.run_on_main_thread(move || {
                    let action = callback_app
                        .state::<QuitState>()
                        .0
                        .lock()
                        .map(|mut coordinator| coordinator.timeout(request_id))
                        .unwrap_or(QuitAction::ShowMain);
                    let _ = quit_action(&callback_app, action);
                });
            });
            app.get_webview_window("main")
                .ok_or("Margin window is unavailable")?
                .emit("margin://request-quit", QuitRequestPayload { request_id })
                .map_err(|error| error.to_string())
        }
        QuitAction::ConfirmForceQuit { request_id } => {
            let _ = show_main_window(app);
            let dialog_app = app.clone();
            app.dialog()
                .message(
                    "Margin could not confirm that your draft finished saving. Cancel to return to your draft, or quit anyway and discard any unsaved changes.",
                )
                .title("Saving did not finish")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::YesNoCancelCustom(
                    "Cancel".into(),
                    QUIT_ANYWAY_LABEL.into(),
                    "Keep editing".into(),
                ))
                // The first button is the platform default and is deliberately safe.
                // Dismissal and both safe choices map to false; only the separately
                // labelled destructive choice may exit.
                .show_with_result(move |result| {
                    let quit_anyway = dialog_result_forces_quit(&result);
                    let action = dialog_app
                        .state::<QuitState>()
                        .0
                        .lock()
                        .map(|mut coordinator| {
                            coordinator.confirm_timeout(request_id, quit_anyway)
                        })
                        .unwrap_or(QuitAction::ShowMain);
                    let _ = quit_action(&dialog_app, action);
                });
            Ok(())
        }
    }
}

fn request_application_quit(app: &AppHandle) -> Result<(), String> {
    let action = app
        .state::<QuitState>()
        .0
        .lock()
        .map_err(|_| "Quit state is unavailable")?
        .request_quit();
    quit_action(app, action)
}

#[tauri::command]
pub(crate) fn set_dirty_state(app: AppHandle, dirty: bool) -> Result<(), String> {
    app.state::<QuitState>()
        .0
        .lock()
        .map_err(|_| "Quit state is unavailable")?
        .set_dirty(dirty);
    Ok(())
}

#[tauri::command]
pub(crate) fn complete_quit_request(
    app: AppHandle,
    request_id: u64,
    saved: bool,
) -> Result<(), String> {
    let action = app
        .state::<QuitState>()
        .0
        .lock()
        .map_err(|_| "Quit state is unavailable")?
        .complete(request_id, saved);
    quit_action(&app, action)
}

fn setup_tray(app: &App) -> Result<(), String> {
    let show = MenuItem::with_id(app, SHOW_MENU_ID, "Show Margin", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let capture = MenuItem::with_id(app, CAPTURE_MENU_ID, "Quick Capture", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&show, &capture, &separator, &quit])
        .map_err(|error| error.to_string())?;

    let mut builder = TrayIconBuilder::with_id("margin-tray")
        .menu(&menu)
        .tooltip("Margin")
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_MENU_ID => {
                let _ = show_main_window(app);
            }
            CAPTURE_MENU_ID => {
                let _ = show_capture_window(app);
            }
            QUIT_MENU_ID => {
                let _ = request_application_quit(app);
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app).map_err(|error| error.to_string())?;
    Ok(())
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
pub(crate) fn show_quick_capture(app: AppHandle) -> Result<(), String> {
    show_capture_window(&app)
}

#[tauri::command]
pub(crate) async fn hide_quick_capture(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("capture")
        .ok_or("Quick capture window is unavailable")?
        .hide()
        .map_err(|error| error.to_string())
}

/// Opens a user-authored web or communication link with the operating
/// system's default handler. Keeping this native avoids WebView-specific
/// navigation behavior and works the same way on macOS and Windows.
#[tauri::command]
pub(crate) fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
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
pub(crate) fn save_selected_library(app: AppHandle, library_path: String) -> Result<(), String> {
    let library = canonical_library_root(library_path.trim())?;
    allow_asset_directory(&app, &library)?;
    fs::write(
        selected_library_file(&app)?,
        library.to_string_lossy().as_bytes(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn load_selected_library(app: AppHandle) -> Result<Option<String>, String> {
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
pub(crate) async fn configure_quick_capture_shortcut(
    app: AppHandle,
    shortcut: String,
) -> Result<(), String> {
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

pub(crate) fn setup(app: &mut App, default_capture: Shortcut) -> Result<(), String> {
    let opened_markdown_files = markdown_file_paths(std::env::args_os().skip(1).map(PathBuf::from));
    allow_opened_markdown_assets(app.handle(), &opened_markdown_files)?;
    app.manage(OpenedMarkdownFiles(Mutex::new(opened_markdown_files)));
    let registered = app.global_shortcut().register(default_capture).is_ok();
    app.manage(CaptureShortcut(Mutex::new(CaptureShortcutState {
        shortcut: default_capture,
        registered,
    })));
    app.manage(QuitState(Mutex::new(QuitCoordinator::default())));
    setup_tray(app)?;
    WebviewWindowBuilder::new(app, "capture", WebviewUrl::App("capture.html".into()))
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
}

pub(crate) fn handle_global_shortcut(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    let is_capture_shortcut = app.try_state::<CaptureShortcut>().is_some_and(|state| {
        state
            .0
            .lock()
            .is_ok_and(|active| active.registered && active.shortcut == *shortcut)
    });
    if is_capture_shortcut && event.state() == ShortcutState::Pressed {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = show_capture_window(&handle);
        });
    }
}

pub(crate) fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() == "main" {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

pub(crate) fn handle_run_event(app: &AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::ExitRequested {
        code: None, api, ..
    } = &event
    {
        let action = app
            .state::<QuitState>()
            .0
            .lock()
            .map(|mut coordinator| coordinator.request_quit())
            .unwrap_or(QuitAction::ShowMain);
        if action != QuitAction::Exit {
            api.prevent_exit();
            let _ = quit_action(app, action);
        }
        return;
    }
    #[cfg(target_os = "macos")]
    match event {
        tauri::RunEvent::Reopen { .. } => {
            let _ = show_main_window(app);
        }
        tauri::RunEvent::Opened { urls } => {
            let paths =
                markdown_file_paths(urls.into_iter().filter_map(|url| url.to_file_path().ok()));
            queue_opened_markdown_files(app, paths);
            let _ = show_main_window(app);
        }
        _ => {}
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

#[cfg(test)]
mod tests {
    use super::{dialog_result_forces_quit, QuitAction, QuitCoordinator};
    use tauri_plugin_dialog::MessageDialogResult;

    #[test]
    fn quit_coordinator_exits_immediately_when_clean() {
        let mut coordinator = QuitCoordinator::default();

        assert_eq!(coordinator.request_quit(), QuitAction::Exit);
        assert_eq!(coordinator.pending_request_id(), None);
    }

    #[test]
    fn quit_coordinator_requests_a_save_when_dirty() {
        let mut coordinator = QuitCoordinator::default();
        coordinator.set_dirty(true);

        assert_eq!(
            coordinator.request_quit(),
            QuitAction::RequestSave { request_id: 1 }
        );
        assert_eq!(coordinator.pending_request_id(), Some(1));
        assert_eq!(coordinator.request_quit(), QuitAction::None);
    }

    #[test]
    fn quit_coordinator_exits_after_a_saved_acknowledgement() {
        let mut coordinator = QuitCoordinator::default();
        coordinator.set_dirty(true);
        coordinator.request_quit();

        assert_eq!(coordinator.complete(1, true), QuitAction::Exit);
        assert!(!coordinator.is_dirty());
        assert_eq!(coordinator.pending_request_id(), None);
    }

    #[test]
    fn quit_coordinator_shows_main_after_a_failed_acknowledgement() {
        let mut coordinator = QuitCoordinator::default();
        coordinator.set_dirty(true);
        coordinator.request_quit();

        assert_eq!(coordinator.complete(1, false), QuitAction::ShowMain);
        assert!(coordinator.is_dirty());
        assert_eq!(coordinator.pending_request_id(), None);
        assert_eq!(coordinator.complete(1, true), QuitAction::None);
    }

    #[test]
    fn quit_coordinator_timeout_requires_explicit_force_exit() {
        let mut coordinator = QuitCoordinator::default();
        coordinator.set_dirty(true);
        coordinator.request_quit();

        assert_eq!(coordinator.timeout(7), QuitAction::None);
        assert_eq!(
            coordinator.timeout(1),
            QuitAction::ConfirmForceQuit { request_id: 1 }
        );
        assert_eq!(coordinator.confirm_timeout(1, false), QuitAction::ShowMain);
        assert!(coordinator.is_dirty());

        assert_eq!(
            coordinator.request_quit(),
            QuitAction::RequestSave { request_id: 2 }
        );
        assert_eq!(
            coordinator.timeout(2),
            QuitAction::ConfirmForceQuit { request_id: 2 }
        );
        assert_eq!(coordinator.confirm_timeout(2, true), QuitAction::Exit);
        assert!(!coordinator.is_dirty());
    }

    #[test]
    fn timeout_dialog_requires_the_explicit_quit_anyway_result() {
        for safe_result in [
            MessageDialogResult::Ok,
            MessageDialogResult::Yes,
            MessageDialogResult::Cancel,
            MessageDialogResult::Custom("Cancel".into()),
            MessageDialogResult::Custom("Keep editing".into()),
        ] {
            assert!(!dialog_result_forces_quit(&safe_result));
        }
        assert!(dialog_result_forces_quit(&MessageDialogResult::No));
        assert!(dialog_result_forces_quit(&MessageDialogResult::Custom(
            "Quit anyway".into()
        )));
    }
}
