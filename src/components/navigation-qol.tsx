import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import "./navigation-qol.css";

export interface TagComboboxProps {
  /** Every tag available in the library. */
  options: readonly string[];
  /** Tags already assigned to the current note. */
  selectedTags: readonly string[];
  /** The current text in the input. */
  inputValue: string;
  onInputValueChange: (value: string) => void;
  /** Called with a trimmed, canonical existing tag or a newly created tag. */
  onAdd: (tag: string) => void;
  id?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  maxSuggestions?: number;
}

type TagChoice = { value: string; isCreate: boolean };

const normalize = (value: string) => value.trim().replace(/,$/, "").toLocaleLowerCase();

export function TagCombobox({
  options,
  selectedTags,
  inputValue,
  onInputValueChange,
  onAdd,
  id,
  label = "Add a tag",
  placeholder = "Find or create a tag…",
  disabled = false,
  autoFocus = false,
  className = "",
  maxSuggestions = 8,
}: TagComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? `tag-combobox-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const choices = useMemo<TagChoice[]>(() => {
    const selected = new Set(selectedTags.map(normalize));
    const query = normalize(inputValue);
    const seen = new Set<string>();
    const matching = options
      .filter((tag) => {
        const key = normalize(tag);
        if (!key || seen.has(key) || selected.has(key)) return false;
        seen.add(key);
        return !query || key.includes(query);
      })
      .slice(0, Math.max(0, maxSuggestions))
      .map((value) => ({ value, isCreate: false }));

    const typed = inputValue.trim().replace(/,$/, "");
    const exactOption = options.find((tag) => normalize(tag) === normalize(typed));
    const alreadySelected = selected.has(normalize(typed));
    if (typed && !exactOption && !alreadySelected) {
      matching.push({ value: typed, isCreate: true });
    }
    return matching;
  }, [inputValue, maxSuggestions, options, selectedTags]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(choices.length - 1, 0)));
  }, [choices.length]);

  const commit = (choice?: TagChoice) => {
    const typed = inputValue.trim().replace(/,$/, "");
    const exactOption = options.find((tag) => normalize(tag) === normalize(typed));
    const value = choice?.value ?? exactOption ?? typed;
    if (!value || selectedTags.some((tag) => normalize(tag) === normalize(value))) return;
    onAdd(value);
    onInputValueChange("");
    setOpen(false);
    setActiveIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => choices.length ? (current + 1) % choices.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => choices.length ? (current - 1 + choices.length) % choices.length : 0);
    } else if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(open ? choices[activeIndex] : undefined);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const visible = open && choices.length > 0;
  return (
    <div className={`nr-tag-combobox ${className}`.trim()}>
      <label className="nr-visually-hidden" htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={visible}
        aria-activedescendant={visible ? `${inputId}-option-${activeIndex}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        value={inputValue}
        onChange={(event) => {
          onInputValueChange(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      <div id={listboxId} role="listbox" className="nr-tag-options" hidden={!visible}>
        {choices.map((choice, index) => (
          <button
            id={`${inputId}-option-${index}`}
            key={`${choice.isCreate ? "create" : "tag"}-${normalize(choice.value)}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? "nr-tag-option nr-is-active" : "nr-tag-option"}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => commit(choice)}
          >
            {choice.isCreate ? <><span aria-hidden="true">＋</span> Create <strong>{choice.value}</strong></> : <>#{choice.value}</>}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface QuickSwitcherNote {
  path: string;
  title: string;
  tags: readonly string[];
  body?: string;
  searchableText?: string;
  searchable_text?: string;
}

export interface QuickSwitcherProps<T extends QuickSwitcherNote = QuickSwitcherNote> {
  notes: readonly T[];
  onSelect: (note: T) => void;
  onClose: () => void;
  placeholder?: string;
  emptyMessage?: string;
  maxResults?: number;
  initialQuery?: string;
  className?: string;
}

/** A compact fuzzy score: consecutive and word-start matches are preferred. */
export function fuzzyScore(query: string, candidate: string): number | null {
  const needle = query.trim().toLocaleLowerCase();
  const haystack = candidate.toLocaleLowerCase();
  if (!needle) return 0;
  let score = 0;
  let cursor = -1;
  let previous = -2;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor + 1);
    if (found < 0) return null;
    score += found === previous + 1 ? 8 : 2;
    if (found === 0 || /[\s_\-/#]/.test(haystack[found - 1] ?? "")) score += 5;
    score -= Math.min(found - cursor - 1, 6);
    previous = found;
    cursor = found;
  }
  return score - haystack.length * 0.002;
}

export function scoreNote(query: string, note: QuickSwitcherNote): number | null {
  const title = fuzzyScore(query, note.title);
  const tags = fuzzyScore(query, note.tags.join(" "));
  const body = fuzzyScore(query, note.body ?? note.searchableText ?? note.searchable_text ?? "");
  const scores = [title == null ? null : title + 40, tags == null ? null : tags + 18, body];
  const matches = scores.filter((score): score is number => score != null);
  return matches.length ? Math.max(...matches) : null;
}

export function QuickSwitcher<T extends QuickSwitcherNote>({
  notes,
  onSelect,
  onClose,
  placeholder = "Jump to a note…",
  emptyMessage = "No matching notes",
  maxResults = 10,
  initialQuery = "",
  className = "",
}: QuickSwitcherProps<T>) {
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const listboxId = `quick-switcher-${generatedId}`;
  const results = useMemo(() => notes
    .map((note, order) => ({ note, order, score: scoreNote(query, note) }))
    .filter((result): result is { note: T; order: number; score: number } => result.score != null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, maxResults)), [maxResults, notes, query]);

  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => inputRef.current?.focus(), []);

  const choose = (index: number) => {
    const result = results[index];
    if (result) onSelect(result.note);
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
          {results.map(({ note }, index) => (
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
          {!results.length && <p className="nr-switcher-empty" role="status">{emptyMessage}</p>}
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

export function NoteListItem<T extends NoteListItemData>({
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
