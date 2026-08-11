import React, { useEffect, useRef, useState } from "react";
import type { NoteSummary } from "../../app/types";
import { FolderNoteTree } from "./LibraryNavigation";

export const noteListVirtualizationThreshold = 120;
export const virtualNoteRowHeight = 92;

export function shouldVirtualizeNoteList(count: number, isHierarchicalFolderView: boolean) {
  return !isHierarchicalFolderView && count >= noteListVirtualizationThreshold;
}

export type NoteListProps = {
  title: string;
  notes: NoteSummary[];
  activePath: string | null;
  folders: string[];
  rootFolder: string;
  hierarchical: boolean;
  librarySelected: boolean;
  emptyMessage?: string;
  renderNote: (note: NoteSummary) => React.ReactNode;
};

export function NoteList({
  title,
  notes,
  activePath,
  folders,
  rootFolder,
  hierarchical,
  librarySelected,
  emptyMessage = "No notes here yet.",
  renderNote,
}: NoteListProps) {
  return (
    <section className="note-list">
      <header>
        <h1>{title}</h1>
        <span>{notes.length}</span>
      </header>
      {shouldVirtualizeNoteList(notes.length, hierarchical) ? (
        <VirtualNoteList
          notes={notes}
          activePath={activePath}
          renderNote={renderNote}
        />
      ) : (
        <div className="notes">
          {hierarchical ? (
            <FolderNoteTree
              root={rootFolder}
              folders={folders}
              notes={notes}
              renderNote={renderNote}
            />
          ) : (
            notes.map(renderNote)
          )}
          {librarySelected && !notes.length && (
            <p className="empty-list" role="status">{emptyMessage}</p>
          )}
        </div>
      )}
    </section>
  );
}

export function VirtualNoteList({
  notes,
  activePath,
  renderNote,
}: {
  notes: NoteSummary[];
  activePath: string | null;
  renderNote: (note: NoteSummary) => React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const start = Math.max(0, Math.floor(scrollTop / virtualNoteRowHeight) - 6);
  const visibleRows = Math.ceil(viewportHeight / virtualNoteRowHeight) + 12;
  const end = Math.min(notes.length, start + visibleRows);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const updateViewport = () => setViewportHeight(element.clientHeight || 640);
    updateViewport();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateViewport);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const element = scroller.current;
    const index = notes.findIndex((item) => item.path === activePath);
    if (!element || index < 0) return;
    const rowTop = index * virtualNoteRowHeight;
    const rowBottom = rowTop + virtualNoteRowHeight;
    if (
      rowTop < element.scrollTop ||
      rowBottom > element.scrollTop + element.clientHeight
    ) {
      element.scrollTop = Math.max(0, rowTop - virtualNoteRowHeight * 2);
      setScrollTop(element.scrollTop);
    }
  }, [activePath, notes]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const maxScrollTop = Math.max(
      0,
      notes.length * virtualNoteRowHeight - element.clientHeight,
    );
    if (element.scrollTop > maxScrollTop) {
      element.scrollTop = maxScrollTop;
      setScrollTop(maxScrollTop);
    }
  }, [notes.length]);

  return (
    <div
      ref={scroller}
      className="notes virtual-note-list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className="virtual-note-list-spacer"
        style={{ height: notes.length * virtualNoteRowHeight }}
      >
        <div
          className="virtual-note-list-items"
          style={{ transform: `translateY(${start * virtualNoteRowHeight}px)` }}
        >
          {notes.slice(start, end).map((item) => (
            <div className="virtual-note-row" key={item.path}>
              {renderNote(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
