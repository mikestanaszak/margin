# Markdown Notes — Product Specification (Draft)

## 1. Product summary

A fast, local-first Markdown note-taking application for macOS, Windows, and Linux. Every note is a normal Markdown file that remains useful outside the app. The interface makes writing feel as simple as a text editor while providing a clean, readable rendered view when it is time to review notes.

The central interaction is **Edit / Preview**: `Cmd+E` on macOS and `Ctrl+E` elsewhere toggles a note between its raw Markdown editor and its formatted rendering.

## 2. Goals

- Keep notes portable: one note equals one `.md` file, owned by the user.
- Make Markdown easy to write and pleasant to read.
- Organize notes with lightweight, multi-tag metadata.
- Make navigation, searching, and switching views feel instantaneous.
- Work offline with no account required for the core product.

## 3. Non-goals for the first release

- Collaborative real-time editing.
- A proprietary cloud-only data format.
- A complex database the user needs to manage or export from.
- Full project-management or task-management functionality.

## 4. Core concepts

| Concept | Definition |
| --- | --- |
| Library | A user-selected folder containing Markdown notes and app configuration. |
| Note | One UTF-8 `.md` file. The filename is its durable file identity. |
| Tag | A case-insensitive named label associated with zero or more notes. A note may have many tags. |
| Untagged note | A note with no tags in its metadata. |
| Edit mode | A focused plain-text Markdown editor. |
| Preview mode | A styled, read-only rendering of the same Markdown document. |

## 5. Note format and storage

### 5.1 File layout

Each library is an ordinary directory. Notes may live in subfolders; the app treats folders as optional secondary organization, not a replacement for tags.

```text
My Notes/
  ideas/
    offline-first.md
  meetings/
    2026-07-23-planning.md
  .markdown-notes/
    settings.json
```

### 5.2 Metadata

Tags and optional note metadata use YAML front matter, preserving compatibility with common Markdown tools.

```markdown
---
title: Offline-first notes
tags:
  - product
  - ideas
created: 2026-07-23T09:30:00-05:00
updated: 2026-07-23T10:05:00-05:00
---

# Offline-first notes

The body of the note starts here.
```

Rules:

- `tags` is optional; if missing or empty, the note appears under **Untagged**.
- Tags are trimmed, compared case-insensitively, and displayed using the spelling most recently saved by the user.
- Existing `.md` files without front matter open normally. Adding a tag creates front matter without altering the body.
- The app writes `updated` on save; it sets `created` only when it creates a new note. These fields may be disabled in settings in a later release.

### 5.3 File changes and safety

- Save automatically after a short pause and whenever a note loses focus; expose a visible saved/saving/error state.
- Watch the library for external changes and refresh the note index.
- If the current file changes outside the app while it has unsaved edits, show a conflict resolution screen: keep mine, use disk version, or compare/merge.
- Never silently overwrite an external change.

## 6. Primary user experience

### 6.1 App layout

```text
+----------------------+---------------------------------------------+
| Sidebar              | Note workspace                              |
|                      |                                             |
| [+ New note]         | [Title / filename]        [Edit | Preview] |
| [Search notes...]    |                                             |
|                      | Markdown editor OR rendered Markdown        |
| All notes       (42) |                                             |
| Untagged         (5) |                                             |
|                      |                                             |
| TAGS                 |                                             |
|   ideas          (9) |                                             |
|   meetings       (7) |                                             |
|   product       (12) |                                             |
|                      |                                             |
| Selected notes list  |                                             |
+----------------------+---------------------------------------------+
```

The sidebar has three regions:

1. **Library controls** — create note and search.
2. **Navigation** — All notes, Untagged, then a sorted list of named tags with note counts.
3. **Note list** — notes matching the selected navigation item, sorted by last updated by default.

On narrow windows, the sidebar and note list can collapse into a single navigable panel.

### 6.2 Creating a note

1. User selects **New note** (`Cmd/Ctrl+N`).
2. The app creates a new Markdown file in the library's configured default folder.
3. The cursor is placed in edit mode. A title is inferred from the first level-one heading when present; otherwise the app initially uses `Untitled`.
4. On first save, the filename is generated from the title plus a disambiguating suffix if necessary. Users can rename it explicitly.

Open question: whether filename renames should follow later title changes. Default recommendation: do not rename automatically after the first save, to avoid breaking external links.

### 6.3 Editing and previewing

- **Edit mode** is the default when creating or opening a note. It uses a monospace font, soft wrap, line numbers optional, and standard undo/redo.
- **Preview mode** renders headings, emphasis, lists, blockquotes, tables, task lists, code blocks, links, and images.
- `Cmd+E` / `Ctrl+E` toggles between modes. The toolbar control also shows the current mode and shortcut.
- Switching to Preview preserves the editor selection/scroll position where practical. Switching back restores the editing caret and scroll location.
- In Preview, clicking an internal Markdown link opens the target note in the app; external links open in the system browser after normal confirmation/settings rules.
- Preview is intentionally not WYSIWYG in v1. Users always know whether they are editing Markdown or reading its rendering.

### 6.4 Tags

- A tag picker above the note body displays assigned tags as removable chips and supports typing to find or create a tag.
- Enter, comma, or choosing a suggested tag commits it.
- The sidebar lists only tags currently used by at least one note.
- Selecting a tag filters the note list to notes with that tag. Selecting **Untagged** filters to notes without any tags.
- Tags may include spaces; leading/trailing whitespace is removed. A maximum length of 64 characters prevents accidental malformed metadata.

### 6.5 Search

- Search matches title, filename, tag names, and note body text.
- Results update as the user types and display a short contextual excerpt.
- Search uses local indexing and works offline.
- Initial scope: simple full-text matching. Advanced query syntax can follow after the core experience is solid.

## 7. Functional requirements (v1)

| ID | Requirement |
| --- | --- |
| FR-1 | User can choose or create a library folder and reopen it later. |
| FR-2 | App discovers Markdown files recursively and indexes title, metadata, body, path, and modification time. |
| FR-3 | User can create, edit, rename, duplicate, and move a note to trash from the app. |
| FR-4 | User can add, remove, and view multiple tags per note. |
| FR-5 | Sidebar supports All notes, Untagged, and named tag views with live counts. |
| FR-6 | User can search all indexed notes locally. |
| FR-7 | `Cmd+E` / `Ctrl+E` toggles Edit and Preview for the active note. |
| FR-8 | Preview safely renders common Markdown and supports image paths relative to the note file. |
| FR-9 | App autosaves edits and clearly reports write errors. |
| FR-10 | App handles file changes made by other applications without data loss. |
| FR-11 | Keyboard shortcuts work consistently on supported desktop platforms. |

## 8. Keyboard shortcuts

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| New note | `Cmd+N` | `Ctrl+N` |
| Toggle Edit / Preview | `Cmd+E` | `Ctrl+E` |
| Search notes | `Cmd+K` | `Ctrl+K` |
| Save now | `Cmd+S` | `Ctrl+S` |
| Focus sidebar | `Cmd+1` | `Ctrl+1` |
| Focus note list | `Cmd+2` | `Ctrl+2` |
| Focus editor / preview | `Cmd+3` | `Ctrl+3` |
| Toggle sidebar | `Cmd+\\` | `Ctrl+\\` |

## 9. Quality requirements

- **Performance:** opening a library of 5,000 typical notes should show usable navigation within two seconds after the initial index; subsequent launches should feel near-instant.
- **Reliability:** atomic writes or equivalent safe-save behavior; no intentional content loss from autosave.
- **Accessibility:** keyboard-complete navigation, focus indicators, semantic controls, scalable typography, and light/dark themes.
- **Privacy:** no network access is required to create, index, search, or read notes. Telemetry is off by default if introduced.
- **Security:** sanitize rendered Markdown; do not execute embedded HTML/scripts by default.

## 10. Recommended additional features

### High-value additions for an early release

- **Quick switcher** — `Cmd/Ctrl+P` opens a fuzzy finder for jumping to a note without leaving the keyboard.
- **Recent notes and pinned notes** — a compact way back to active work, without forcing more tagging.
- **Backlinks** — recognize `[[Note title]]` links and show notes that link to the current note. This turns individual files into a useful knowledge network.
- **Templates** — create a note from reusable Markdown templates for meetings, daily notes, recipes, or project briefs.
- **Daily note command** — opens or creates today's dated note from a template.
- **Tag rename/merge** — rename a tag across the library or merge duplicates such as `todo` and `To Do` safely.
- **Drag-and-drop attachments** — copy dropped images/files into a predictable library attachments folder and insert portable relative links.
- **Markdown formatting shortcuts** — toolbar plus familiar shortcuts for bold, italic, links, headings, and lists while still keeping the raw Markdown model.

### Strong follow-on features

- **Saved searches / smart collections**, for queries such as `tag:meeting updated:7d`.
- **Split view**, showing editor and preview side by side for long or technical notes.
- **Version history**, using file snapshots so users can recover an earlier edit.
- **Import/export**, starting with common Markdown folders and Notion/Evernote-compatible import paths.
- **Git-aware library status**, optional and unobtrusive, for users who already store notes in Git.
- **Multiple libraries**, with a simple library switcher.

## 11. Suggested release slices

### Milestone 1 — Usable local notebook

- Open a library, index `.md` files, create/edit/save notes.
- Front-matter tags, All notes/Untagged/tag sidebar filters.
- Edit/Preview toggle and Markdown rendering.
- Basic local search and keyboard navigation.

### Milestone 2 — Polished daily use

- Safe external-change handling, reliable attachment support, settings, themes, and accessibility pass.
- Quick switcher, pinned/recent notes, templates, daily note.

### Milestone 3 — Connected knowledge

- Wiki links/backlinks, tag management, saved searches, split view, version history.

## 12. Decisions to validate with prototype testing

- Whether users prefer a title field separate from Markdown versus deriving title exclusively from the first `#` heading.
- Whether the note list belongs permanently in the sidebar or as a separate collapsible column for large libraries.
- The best Preview toggle label: **Preview**, **Read**, or an icon paired with tooltip and shortcut.
- Whether tags should live solely in front matter (recommended) or also support inline `#tags` as an opt-in convention.
- Whether folders should appear as sidebar navigation in v1 or remain visible only through the system file picker.

## 13. Success signals

- A new user can create a tagged note, find it from the sidebar, and toggle Preview without help in under two minutes.
- Users can use their existing Markdown files with no migration.
- The Edit/Preview shortcut becomes a natural part of the writing/review flow.
- No reported content loss during ordinary editing, autosave, or externally modified file flows.

## 14. Technical direction

The first implementation will use **Tauri 2**, with a **React + TypeScript** interface and a Rust application layer for filesystem access, indexing, file watching, and safe note writes.

- The frontend owns the application layout, editor, Markdown preview, keyboard interactions, and local UI state.
- The Rust layer exposes a narrow command API scoped to the selected library folder; it reads, indexes, watches, and safely writes note files.
- The app uses the operating system WebView, keeping the installed application relatively small compared with a bundled-browser approach.
- This boundary also keeps direct filesystem access out of the renderer, which is important for a local-files application.
