import { invoke } from "@tauri-apps/api/core";
import type {
  FolderRenameResult,
  ImportedImageResponse,
  LibrarySnapshot,
  NoteDocument,
  NoteSummary,
  SaveNoteResult,
} from "../app/types";

export const native = {
  loadLibrarySnapshot: (libraryPath: string, force = false) =>
    invoke<LibrarySnapshot>("load_library_snapshot", { libraryPath, force }),
  searchLibrary: (libraryPath: string, query: string) =>
    invoke<NoteSummary[]>("search_library", { libraryPath, query }),
  findBacklinks: (libraryPath: string, notePath: string, title: string) =>
    invoke<NoteSummary[]>("find_backlinks", { libraryPath, notePath, title }),
  showQuickCapture: () => invoke<void>("show_quick_capture"),
  configureQuickCaptureShortcut: (shortcut: string) =>
    invoke<void>("configure_quick_capture_shortcut", { shortcut }),
  loadSelectedLibrary: () => invoke<string | null>("load_selected_library"),
  saveSelectedLibrary: (libraryPath: string) =>
    invoke<void>("save_selected_library", { libraryPath }),
  takeOpenedMarkdownFiles: () =>
    invoke<string[]>("take_opened_markdown_files"),
  readNote: (path: string) => invoke<NoteDocument>("read_note", { path }),
  importMarkdownFile: (
    sourcePath: string,
    libraryPath: string,
    folder: string | null,
  ) =>
    invoke<NoteDocument>("import_markdown_file", {
      sourcePath,
      libraryPath,
      folder,
    }),
  createNote: (libraryPath: string, folder: string | null | undefined) =>
    invoke<NoteDocument>("create_note", { libraryPath, folder }),
  saveNote: (note: NoteDocument, libraryPath: string) =>
    invoke<SaveNoteResult>("save_note", { note, libraryPath }),
  createFolder: (libraryPath: string, folder: string) =>
    invoke<string>("create_folder", { libraryPath, folder }),
  renameFolder: (folder: string, name: string, libraryPath: string) =>
    invoke<FolderRenameResult>("rename_folder", { folder, name, libraryPath }),
  duplicateNote: (path: string, libraryPath: string) =>
    invoke<NoteDocument>("duplicate_note", { path, libraryPath }),
  moveNoteToFolder: (
    path: string,
    folder: string | null,
    libraryPath: string,
  ) => invoke<NoteDocument>("move_note_to_folder", { path, folder, libraryPath }),
  revealNoteInFileManager: (path: string, libraryPath: string) =>
    invoke<void>("reveal_note_in_file_manager", { path, libraryPath }),
  moveNoteToTrash: (path: string, libraryPath: string) =>
    invoke<void>("move_note_to_trash", { path, libraryPath }),
  moveFolderToTrash: (folder: string, libraryPath: string) =>
    invoke<void>("move_folder_to_trash", { folder, libraryPath }),
  restoreNoteFromTrash: (path: string, libraryPath: string) =>
    invoke<NoteDocument>("restore_note_from_trash", { path, libraryPath }),
  deleteNotePermanently: (path: string, libraryPath: string) =>
    invoke<void>("delete_note_permanently", { path, libraryPath }),
  appendQuickNote: (
    libraryPath: string,
    text: string,
    dailyTemplate?: string,
  ) => invoke<NoteDocument>("append_quick_note", { libraryPath, text, dailyTemplate }),
  importDailyNote: (sourcePath: string, targetPath: string, libraryPath: string) =>
    invoke<NoteDocument>("import_daily_note", { sourcePath, targetPath, libraryPath }),
  importDailyNoteToNewNote: (
    sourcePath: string,
    folder: string | null,
    title: string,
    libraryPath: string,
  ) =>
    invoke<NoteDocument>("import_daily_note_to_new_note", {
      sourcePath,
      folder,
      title,
      libraryPath,
    }),
  importNoteImageFromBytes: (
    notePath: string,
    filename: string,
    bytes: number[],
    libraryPath: string,
  ) =>
    invoke<ImportedImageResponse>("import_note_image_from_bytes", {
      notePath,
      filename,
      bytes,
      libraryPath,
    }),
  importNoteImageFromPath: (
    notePath: string,
    sourcePath: string,
    libraryPath: string,
  ) =>
    invoke<ImportedImageResponse>("import_note_image_from_path", {
      notePath,
      sourcePath,
      libraryPath,
    }),
  hideQuickCapture: () => invoke<void>("hide_quick_capture"),
  openExternalUrl: (url: string) => invoke<void>("open_external_url", { url }),
};
