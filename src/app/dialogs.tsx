import React, { useLayoutEffect, useRef, useState } from "react";
import { Modal, useModalLayer } from "../components/Modal";
import { CaptureComposer } from "../features/capture/CaptureComposer";
import {
  CascadingFolderOptions,
  CascadingNoteOptions,
} from "../features/library/LibraryNavigation";
import type {
  UpdateCandidate,
  UpdatePhase,
} from "../features/updater/update-controller";
import type { NoteSessionConflict } from "../features/note-session/note-session";
import { fileStem } from "../note-utils";
import { isMac } from "../platform";
import type { NoteDocument, NoteSummary } from "./types";

type NoteAction = (note: NoteSummary) => void;

export function NoteContextMenu({
  note,
  x,
  y,
  isTrashed,
  isDaily,
  folders,
  onClose,
  onDuplicate,
  onMove,
  onReveal,
  onTrash,
  onRestore,
  onDeletePermanently,
  onImport,
}: {
  note: NoteSummary;
  x: number;
  y: number;
  isTrashed: boolean;
  isDaily: boolean;
  folders: string[];
  onClose: () => void;
  onDuplicate: NoteAction;
  onMove: (note: NoteSummary, folder: string) => void;
  onReveal: NoteAction;
  onTrash: NoteAction;
  onRestore: NoteAction;
  onDeletePermanently: NoteAction;
  onImport: NoteAction;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  // Keep the whole menu on screen, whatever its rendered size.
  useLayoutEffect(() => {
    const bounds = menu.current?.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(
        margin,
        Math.min(x, window.innerWidth - (bounds?.width ?? 0) - margin),
      ),
      top: Math.max(
        margin,
        Math.min(y, window.innerHeight - (bounds?.height ?? 0) - margin),
      ),
    });
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [x, y]);
  const item = (label: string, action: NoteAction, className?: string) => (
    <button
      type="button"
      role="menuitem"
      className={className}
      onClick={() => {
        onClose();
        action(note);
      }}
    >
      {label}
    </button>
  );
  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>(
        "[role=menuitem], select",
      ) ?? []),
    ];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(current + step + items.length) % items.length].focus();
  };
  return (
    <div
      ref={menu}
      className="note-context-menu"
      role="menu"
      aria-label={`Actions for ${note.title}`}
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={moveFocus}
    >
      <p>{note.title}</p>
      {isTrashed ? (
        <>
          {item("Restore", onRestore)}
          {item("Delete permanently", onDeletePermanently, "danger")}
        </>
      ) : (
        <>
          {item("Duplicate", onDuplicate)}
          <label className="note-context-move">
            Move to folder
            <select
              aria-label="Move note to folder"
              defaultValue=""
              onChange={(event) => {
                const folder = event.target.value;
                if (!folder) return;
                onClose();
                onMove(note, folder === "__top_level__" ? "" : folder);
              }}
            >
              <option value="" disabled>
                Choose folder…
              </option>
              <option value="__top_level__">Top level</option>
              <CascadingFolderOptions folders={folders} />
            </select>
          </label>
          {item(`Show in ${isMac ? "Finder" : "File Explorer"}`, onReveal)}
          {isDaily && item("Import captures", onImport)}
          {item("Move to Trash", onTrash, "danger")}
        </>
      )}
    </div>
  );
}

export function ColumnResizeHandle({
  className,
  value,
  min,
  max,
  onChange,
  label,
  direction = 1,
}: {
  className: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  direction?: 1 | -1;
}) {
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = value;
    const resize = (move: PointerEvent) =>
      onChange(startWidth + (move.clientX - startX) * direction);
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("is-resizing");
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  return (
    <div
      className={`sidebar-resizer ${className}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
        if (!step) return;
        event.preventDefault();
        onChange(value + step * direction);
      }}
    />
  );
}

export function UpdateDialog({
  update,
  state,
  error,
  onClose,
  onInstall,
  onRestart,
  onSkip,
}: {
  update: UpdateCandidate;
  state: UpdatePhase;
  error: string;
  onClose: () => void;
  onInstall: () => void;
  onRestart: () => void;
  onSkip: () => void;
}) {
  const ready = state === "ready";
  const restarting = state === "restarting";
  const installing = state === "downloading";
  const busy = installing || restarting;
  const failed = state === "error";
  const eyebrow = restarting
    ? "Restarting Margin"
    : ready
      ? "Update installed"
      : installing
        ? "Installing update"
        : "Update available";
  const heading = restarting
    ? `Margin ${update.version} is restarting`
    : ready
      ? `Margin ${update.version} is ready`
      : `Margin ${update.version}`;
  const progress = installing
    ? "Downloading and verifying the update…"
    : ready
      ? "Update installed. Restart Margin when you’re ready."
      : restarting
        ? "Restarting Margin…"
        : null;
  return (
    <Modal
      className="update-dialog"
      label="Margin update"
      busy={busy}
      onClose={busy ? undefined : onClose}
    >
      <header>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{heading}</h2>
        </div>
        <button aria-label="Close update" onClick={onClose}>
          ×
        </button>
      </header>
      <p>{update.body || "A newer version of Margin is ready to install."}</p>
      {error && (
        <p className="update-status" role="alert">
          {error}
        </p>
      )}
      {progress && (
        <p className="update-status" role="status" aria-live="polite">
          {progress}
        </p>
      )}
      <div>
        {ready || restarting ? (
          <button
            className="primary"
            type="button"
            onClick={onRestart}
            disabled={restarting}
          >
            {restarting ? "Restarting Margin…" : "Restart Margin"}
          </button>
        ) : (
          <>
            <button type="button" onClick={onSkip} disabled={busy}>
              Skip this version
            </button>
            <button
              className="primary"
              type="button"
              onClick={onInstall}
              disabled={busy}
            >
              {busy ? "Updating…" : failed ? "Try again" : "Update now"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

export function FolderDialog({
  onClose,
  onSubmit,
  title,
  description,
  placeholder,
  submitLabel,
  initialValue = "",
}: {
  onClose: () => void;
  onSubmit: (name: string) => void;
  title: string;
  description: string;
  placeholder: string;
  submitLabel: string;
  initialValue?: string;
}) {
  const [name, setName] = useState(initialValue);
  return (
    <Modal
      className="table-dialog"
      label={title}
      onClose={onClose}
      onSubmit={() => {
        if (name.trim()) onSubmit(name.trim());
      }}
    >
      <h2>{title}</h2>
      <p>{description}</p>
      <label>
        Name
        <input
          autoFocus
          placeholder={placeholder}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <div>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" disabled={!name.trim()}>
          {submitLabel}
        </button>
      </div>
    </Modal>
  );
}

export function QuickCaptureDialog({
  session = 0,
  shortcut,
  status,
  onClose,
  onSave,
}: {
  session?: number;
  shortcut: string;
  status: string;
  onClose: () => void;
  onSave: (text: string) => boolean | Promise<boolean>;
}) {
  // The composer owns its own Escape handling and frame.
  useModalLayer();
  return (
    <div className="modal-backdrop quick-capture-backdrop">
      <CaptureComposer
        session={session}
        shortcut={shortcut}
        status={status}
        disabled={false}
        onClose={onClose}
        onSave={onSave}
      />
    </div>
  );
}

export function ImportDailyNoteDialog({
  source,
  targets,
  folders,
  defaultTargetPath,
  onClose,
  onImport,
  onImportNew,
}: {
  source: NoteDocument;
  targets: NoteSummary[];
  folders: string[];
  defaultTargetPath: string;
  onClose: () => void;
  onImport: (target: NoteSummary) => void;
  onImportNew: (folder: string, title: string) => void;
}) {
  const initialTarget = targets.some((item) => item.path === defaultTargetPath)
    ? defaultTargetPath
    : targets[0]?.path || "";
  const [destination, setDestination] = useState<"note" | "new">(
    targets.length ? "note" : "new",
  );
  const [targetPath, setTargetPath] = useState(initialTarget);
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState(`${source.title} captures`);
  const target = targets.find((item) => item.path === targetPath);
  return (
    <Modal
      className="import-dialog"
      label="Import captures"
      onClose={onClose}
      onSubmit={() => {
        if (destination === "note" && target) onImport(target);
        if (destination === "new" && title.trim())
          onImportNew(folder, title.trim());
      }}
    >
      <h2>Import captures</h2>
      <p>
        Keep your Daily note intact and choose where this capture set should go.
      </p>
      <fieldset className="import-destination">
        <legend>Destination</legend>
        <label>
          <input
            type="radio"
            name="import-destination"
            checked={destination === "note"}
            onChange={() => setDestination("note")}
          />{" "}
          Append to an existing note
        </label>
        <label>
          <input
            type="radio"
            name="import-destination"
            checked={destination === "new"}
            onChange={() => setDestination("new")}
          />{" "}
          Create a separate note in a folder
        </label>
      </fieldset>
      {destination === "note" ? (
        <label>
          Note
          <select
            value={targetPath}
            onChange={(event) => setTargetPath(event.target.value)}
          >
            <CascadingNoteOptions targets={targets} folders={folders} />
          </select>
        </label>
      ) : (
        <>
          <label>
            Folder
            <select
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
            >
              <option value="">Top level</option>
              <CascadingFolderOptions folders={folders} />
            </select>
          </label>
          <label>
            New note title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        </>
      )}
      {destination === "note" &&
        defaultTargetPath &&
        targetPath === defaultTargetPath && (
          <p className="default-import-note">Using your default import note.</p>
        )}
      {destination === "note" && !targets.length && (
        <p>
          No non-Daily notes are available yet. Create a separate note instead.
        </p>
      )}
      <div>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={destination === "note" ? !target : !title.trim()}
        >
          Import captures
        </button>
      </div>
    </Modal>
  );
}

export function OpenedMarkdownDialog({
  path,
  library,
  folders,
  onClose,
  onOpenOriginal,
  onImport,
  onChooseLibrary,
}: {
  path: string;
  library: string | null;
  folders: string[];
  onClose: () => void;
  onOpenOriginal: () => void;
  onImport: (folder: string) => void;
  onChooseLibrary: () => void;
}) {
  const [folder, setFolder] = useState("");
  return (
    <Modal
      className="import-dialog"
      label="Opened Markdown file"
      onClose={onClose}
    >
      <h2>Open Markdown file</h2>
      <p title={path}>
        {fileStem(path)}.md is outside your current library. Margin will never
        change it unless you choose to open and edit the original.
      </p>
      {library ? (
        <label>
          Import a copy to
          <select
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          >
            <option value="">Top level</option>
            <CascadingFolderOptions folders={folders} />
          </select>
        </label>
      ) : (
        <p>
          Choose a notes folder to import a copy. You can still open the
          original file without one.
        </p>
      )}
      <div>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" onClick={onOpenOriginal}>
          Open original
        </button>
        {library ? (
          <button
            className="primary"
            type="button"
            onClick={() => onImport(folder)}
          >
            Import copy
          </button>
        ) : (
          <button className="primary" type="button" onClick={onChooseLibrary}>
            Choose library
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Requires an explicit choice, so Escape does not dismiss it. */
export function ConflictDialog({
  conflict,
  onChoose,
}: {
  conflict: NoteSessionConflict;
  onChoose: (choice: "mine" | "disk") => void;
}) {
  return (
    <Modal className="conflict" label="Note changed outside Margin">
      <h2>This note changed outside the app</h2>
      <p>
        Your unsaved edits have not been overwritten. Choose which version to
        keep.
      </p>
      <details>
        <summary>Compare versions</summary>
        <div className="compare">
          <pre aria-label="Your version">{conflict.mine.body}</pre>
          <pre aria-label="Disk version">{conflict.disk.body}</pre>
        </div>
      </details>
      <div>
        <button onClick={() => onChoose("disk")}>Use disk version</button>
        <button className="primary" onClick={() => onChoose("mine")}>
          Keep my edits
        </button>
      </div>
    </Modal>
  );
}

/** Shown when an autosave failed; the draft stays until a retry succeeds. */
export function FailedSaveDialog({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Modal className="conflict" label={`Unsaved draft for ${title}`}>
      <h2>Unsaved draft needs attention</h2>
      <p>
        {title} could not be saved: {message}
      </p>
      <p>Margin is keeping this draft available until saving succeeds.</p>
      <div>
        <button
          className="primary"
          type="button"
          aria-label={`Retry saving ${title}`}
          onClick={onRetry}
        >
          Retry save
        </button>
      </div>
    </Modal>
  );
}
