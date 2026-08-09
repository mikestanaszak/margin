import React from "react";
import type { NoteSummary } from "../../app/types";

export type LibraryFilter =
  | "all"
  | "today"
  | "favorites"
  | "trash"
  | "folder";

export type LibraryNavigationProps = {
  filter: LibraryFilter;
  selectedFolder?: string;
  noteCount: number;
  favoriteCount: number;
  trashCount: number;
  folders: string[];
  folderCounts: Record<string, number>;
  collapsedFolders: string[];
  library: string | null;
  indexWarningCount: number;
  newNoteShortcut: string;
  onNewNote: () => void;
  onShowAll: () => void;
  onOpenToday: () => void;
  onShowFavorites: () => void;
  onShowTrash: () => void;
  onCreateFolder: () => void;
  onSelectFolder: (folder: string) => void;
  onToggleFolder: (folder: string) => void;
  onAddSubfolder: (folder: string) => void;
  onRenameFolder: (folder: string) => void;
  onDeleteFolder: (folder: string) => void;
  onChangeLibrary: () => void;
};

export function LibraryNavigation({
  filter,
  selectedFolder,
  noteCount,
  favoriteCount,
  trashCount,
  folders,
  folderCounts,
  collapsedFolders,
  library,
  indexWarningCount,
  newNoteShortcut,
  onNewNote,
  onShowAll,
  onOpenToday,
  onShowFavorites,
  onShowTrash,
  onCreateFolder,
  onSelectFolder,
  onToggleFolder,
  onAddSubfolder,
  onRenameFolder,
  onDeleteFolder,
  onChangeLibrary,
}: LibraryNavigationProps) {
  return (
    <aside className="sidebar" aria-label="Library navigation">
      <button className="new-note" onClick={onNewNote}>
        ＋ New note <kbd>{newNoteShortcut}</kbd>
      </button>
      <nav>
        <button
          className={filter === "all" ? "nav-item selected" : "nav-item"}
          onClick={onShowAll}
        >
          <span>All notes</span>
          <small>{noteCount}</small>
        </button>
        <button
          className={filter === "today" ? "nav-item selected" : "nav-item"}
          onClick={onOpenToday}
        >
          <span>Today</span>
          <small>↗</small>
        </button>
        <button
          className={
            filter === "favorites" ? "nav-item selected" : "nav-item"
          }
          onClick={onShowFavorites}
        >
          <span>Favorites</span>
          <small>{favoriteCount}</small>
        </button>
        <button
          className={filter === "trash" ? "nav-item selected" : "nav-item"}
          onClick={onShowTrash}
        >
          <span>Trash</span>
          <small>{trashCount}</small>
        </button>
        <div className="section-heading">
          <p className="section-label">Folders</p>
          <button
            type="button"
            aria-label="Create folder"
            title="New folder"
            onClick={onCreateFolder}
          >
            ＋
          </button>
        </div>
        <FolderTree
          folders={folders}
          counts={folderCounts}
          selected={selectedFolder}
          collapsed={collapsedFolders}
          onSelect={onSelectFolder}
          onToggle={onToggleFolder}
          onAddSubfolder={onAddSubfolder}
          onRename={onRenameFolder}
          onDelete={onDeleteFolder}
        />
      </nav>
      <div className="library-control">
        <button onClick={onChangeLibrary}>Change library</button>
        <p title={library ?? undefined}>
          {library ? library.split(/[\\/]/).pop() : "No library selected"}
        </p>
        {indexWarningCount > 0 && (
          <p className="index-warning" role="status">
            {indexWarningCount} {indexWarningCount === 1 ? "file could" : "files could"} not be indexed
          </p>
        )}
      </div>
    </aside>
  );
}

export function FolderTree({
  folders,
  counts,
  selected,
  collapsed,
  onSelect,
  onToggle,
  onAddSubfolder,
  onRename,
  onDelete,
}: {
  folders: string[];
  counts: Record<string, number>;
  selected?: string;
  collapsed: string[];
  onSelect: (folder: string) => void;
  onToggle: (folder: string) => void;
  onAddSubfolder: (folder: string) => void;
  onRename: (folder: string) => void;
  onDelete: (folder: string) => void;
}) {
  const children = (parent: string) =>
    folders.filter(
      (folder) =>
        (folder.includes("/")
          ? folder.slice(0, folder.lastIndexOf("/"))
          : "") === parent,
    );
  const render = (parent: string, depth: number): React.ReactNode =>
    children(parent).map((folder) => {
      const nested = children(folder);
      const isCollapsed = collapsed.includes(folder);
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      return (
        <React.Fragment key={folder}>
          <div
            className={`folder-row ${selected === folder ? "selected" : ""}`}
            style={{ "--folder-depth": depth } as React.CSSProperties}
          >
            {nested.length ? (
              <button
                type="button"
                className={`folder-disclosure ${isCollapsed ? "collapsed" : ""}`}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${name}`}
                aria-expanded={!isCollapsed}
                onClick={() => onToggle(folder)}
              >
                <span>▾</span>
              </button>
            ) : (
              <span className="folder-spacer" />
            )}
            <button
              type="button"
              className="folder-button"
              onClick={() => onSelect(folder)}
              onDoubleClick={() => onRename(folder)}
              title="Double-click to rename"
            >
              <FolderIcon />
              <span className="folder-name">{name}</span>
              <small>{counts[folder] || 0}</small>
            </button>
            <button
              type="button"
              className="folder-add"
              title={`Add subfolder to ${name}`}
              aria-label={`Add subfolder to ${name}`}
              onClick={() => onAddSubfolder(folder)}
            >
              ＋
            </button>
            <button
              type="button"
              className="folder-delete"
              title={`Delete ${name} (moves it to Trash)`}
              aria-label={`Delete ${name}`}
              onClick={() => onDelete(folder)}
            >
              ×
            </button>
          </div>
          {nested.length > 0 && !isCollapsed && render(folder, depth + 1)}
        </React.Fragment>
      );
    });
  return <div className="folder-tree">{render("", 0)}</div>;
}
export function FolderNoteTree({
  root,
  folders,
  notes,
  renderNote,
}: {
  root: string;
  folders: string[];
  notes: NoteSummary[];
  renderNote: (note: NoteSummary) => React.ReactNode;
}) {
  const directNotes = (folder: string) =>
    notes.filter((note) => note.folder === folder);
  const children = (parent: string) =>
    folders
      .filter(
        (folder) =>
          (folder.includes("/")
            ? folder.slice(0, folder.lastIndexOf("/"))
            : "") === parent,
      )
      .filter((folder) =>
        notes.some(
          (note) =>
            note.folder === folder || note.folder.startsWith(`${folder}/`),
        ),
      );
  const renderFolder = (folder: string, depth: number): React.ReactNode => (
    <section
      key={folder}
      className="folder-note-group"
      style={{ "--folder-note-depth": depth } as React.CSSProperties}
    >
      <div className="folder-note-heading">
        <FolderIcon />
        <span>{folder.slice(folder.lastIndexOf("/") + 1)}</span>
        <small>
          {
            notes.filter(
              (note) =>
                note.folder === folder || note.folder.startsWith(`${folder}/`),
            ).length
          }
        </small>
      </div>
      {directNotes(folder).map(renderNote)}
      {children(folder).map((child) => renderFolder(child, depth + 1))}
    </section>
  );
  return (
    <div className="folder-note-tree">
      {directNotes(root).map(renderNote)}
      {children(root).map((folder) => renderFolder(folder, 0))}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg className="folder-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.5 5.75c0-.97.78-1.75 1.75-1.75h3.84l1.72 2.05h6.44c.97 0 1.75.78 1.75 1.75v6.45c0 1.1-.9 2-2 2H4.5c-1.1 0-2-.9-2-2V5.75Z" />
    </svg>
  );
}

function folderOptionLabel(folder: string) {
  const parts = folder.split("/");
  return `${"—".repeat(parts.length - 1)}▾ ${parts[parts.length - 1]}`;
}
export function CascadingFolderOptions({ folders }: { folders: string[] }) {
  return (
    <>
      {[...folders]
        .sort((left, right) => left.localeCompare(right))
        .map((folder) => (
          <option key={folder} value={folder}>
            {folderOptionLabel(folder)}
          </option>
        ))}
    </>
  );
}
export function CascadingNoteOptions({
  targets,
  folders = [],
}: {
  targets: NoteSummary[];
  folders?: string[];
}) {
  const allFolders = [
    ...new Set([
      ...folders,
      ...targets.map((target) => target.folder).filter(Boolean),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const directNotes = (folder: string) =>
    targets
      .filter((target) => target.folder === folder)
      .sort((left, right) => left.title.localeCompare(right.title));
  const children = (folder: string) =>
    allFolders.filter(
      (candidate) =>
        (candidate.includes("/")
          ? candidate.slice(0, candidate.lastIndexOf("/"))
          : "") === folder,
    );
  const render = (folder: string, depth: number): React.ReactNode[] =>
    children(folder).flatMap((child) => {
      const name = child.slice(child.lastIndexOf("/") + 1);
      return [
        <option key={`folder-${child}`} value={`folder-${child}`} disabled>
          {"—".repeat(depth)}▾ {name}
        </option>,
        ...directNotes(child).map((note) => (
          <option key={note.path} value={note.path}>
            {"—".repeat(depth + 1)}• {note.title}
          </option>
        )),
        ...render(child, depth + 1),
      ];
    });
  return (
    <>
      {directNotes("").map((note) => (
        <option key={note.path} value={note.path}>
          • {note.title}
        </option>
      ))}
      {render("", 0)}
    </>
  );
}
