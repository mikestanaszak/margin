import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { NoteSummary } from "../app/types";
import { useLibrarySearch } from "../features/search/useLibrarySearch";
import "./navigation-qol.css";

export interface QuickSwitcherProps {
  library: string | null;
  onSelect: (note: NoteSummary) => void;
  onClose: () => void;
  placeholder?: string;
  emptyMessage?: string;
  maxResults?: number;
  initialQuery?: string;
  className?: string;
}

export function QuickSwitcher({
  library,
  onSelect,
  onClose,
  placeholder = "Jump to a note…",
  emptyMessage = "No matching notes",
  maxResults = 10,
  initialQuery = "",
  className = "",
}: QuickSwitcherProps) {
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const listboxId = `quick-switcher-${generatedId}`;
  const search = useLibrarySearch({ library, query, scope: "all" });
  const results = search.results.slice(0, Math.max(0, maxResults));

  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => inputRef.current?.focus(), []);

  const choose = (index: number) => {
    const result = results[index];
    if (result) onSelect(result);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => results.length ? (current + 1) % results.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => results.length ? (current - 1 + results.length) % results.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };
  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className="nr-switcher-backdrop" onMouseDown={onClose}>
      <section
        className={`nr-switcher ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        onMouseDown={stopPropagation}
      >
        <label className="nr-visually-hidden" htmlFor={`${listboxId}-input`}>Find a note</label>
        <input
          ref={inputRef}
          id={`${listboxId}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-activedescendant={results.length ? `${listboxId}-option-${activeIndex}` : undefined}
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div id={listboxId} role="listbox" aria-label="Matching notes" className="nr-switcher-results">
          {results.map((note, index) => (
            <button
              id={`${listboxId}-option-${index}`}
              key={note.path}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "nr-switcher-result nr-is-active" : "nr-switcher-result"}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onSelect(note)}
            >
              <strong>{note.title || "Untitled"}</strong>
              {note.tags.length > 0 && <small>{note.tags.map((tag) => `#${tag}`).join(" ")}</small>}
            </button>
          ))}
          {!results.length && !search.loading && (
            <p className="nr-switcher-empty" role="status">{emptyMessage}</p>
          )}
        </div>
      </section>
    </div>
  );
}

export interface NoteListItemData {
  path: string;
  title: string;
  tags: readonly string[];
  updated: number | string | Date;
  body?: string;
  searchableText?: string;
  searchable_text?: string;
}

export interface NoteListItemProps<T extends NoteListItemData = NoteListItemData> {
  note: T;
  active?: boolean;
  dirty?: boolean;
  pinned?: boolean;
  onOpen: (note: T) => void;
  onTogglePin?: (note: T) => void;
  onContextMenu?: (note: T, position: { x: number; y: number }) => void;
  className?: string;
  locale?: string;
  now?: number;
}

function timestamp(value: NoteListItemData["updated"]): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return new Date(value).getTime();
  return value < 1e12 ? value * 1000 : value;
}

export function formatRelativeDate(value: NoteListItemData["updated"], now = Date.now(), locale?: string) {
  const time = timestamp(value);
  if (!Number.isFinite(time)) return "Unknown date";
  const difference = time - now;
  const absolute = Math.abs(difference);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["week", 7 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];
  const [unit, duration] = units.find(([, duration]) => absolute >= duration) ?? ["second", 1000];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(difference / duration), unit);
}

function bodyExcerpt(note: NoteListItemData) {
  const source = note.body ?? note.searchableText ?? note.searchable_text ?? "";
  return source
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    // Wiki links are app navigation, not literal text. Their readable label is
    // what belongs in an All Notes preview card.
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/^[#>*_`~\-]+\s*/gm, "")
    .replace(/\[\s?[xX ]\s?\]\s*/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function NoteListItemImpl<T extends NoteListItemData>({
  note,
  active = false,
  dirty = false,
  pinned = false,
  onOpen,
  onTogglePin,
  onContextMenu,
  className = "",
  locale,
  now,
}: NoteListItemProps<T>) {
  const excerpt = bodyExcerpt(note);
  return (
    <article className={`nr-note-item${active ? " nr-is-active" : ""}${dirty ? " nr-has-unsaved" : ""} ${className}`.trim()} data-note-path={note.path} onContextMenu={event => { event.preventDefault(); onContextMenu?.(note, { x: event.clientX, y: event.clientY }); }}>
      {dirty && <span className="nr-note-unsaved" role="status" aria-label="Unsaved changes" />}
      <button
        type="button"
        className="nr-note-main"
        aria-current={active ? "page" : undefined}
        onClick={() => onOpen(note)}
      >
        <span className="nr-note-title">{note.title || "Untitled"}</span>
        {excerpt && <span className="nr-note-excerpt">{excerpt}</span>}
        <span className="nr-note-meta">
          <span className="nr-note-tags" aria-label={note.tags.length ? `Tags: ${note.tags.join(", ")}` : "No tags"}>
            {note.tags.map((tag) => <span key={tag}>#{tag}</span>)}
          </span>
          <time dateTime={new Date(timestamp(note.updated)).toISOString()}>{formatRelativeDate(note.updated, now, locale)}</time>
        </span>
      </button>
      {onTogglePin && <div className="nr-note-actions"><button type="button" className="nr-note-pin" aria-label={`${pinned ? "Unpin" : "Pin"} ${note.title || "Untitled"}`} aria-pressed={pinned} title={pinned ? "Unpin note" : "Pin note"} onClick={() => onTogglePin(note)}><span aria-hidden="true">{pinned ? "★" : "☆"}</span></button></div>}
    </article>
  );
}

// A note list can contain hundreds of cards. Keeping each card referentially
// stable lets typing in the active editor avoid repainting every row.
export const NoteListItem = memo(NoteListItemImpl) as typeof NoteListItemImpl;
