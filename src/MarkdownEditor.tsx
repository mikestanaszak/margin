import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  selectAll,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type KeyBinding,
  type ViewUpdate,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { all as highlightLanguages } from "lowlight";
import { scanFences } from "./note-utils";
import { isMac } from "./platform";
import { search, searchKeymap } from "@codemirror/search";

export type MarkdownEditorProps = {
  /** Stable filesystem path (or another stable note ID) used for view restoration. */
  notePath: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onImageFile?: (file: File, source: "drop" | "paste") => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
  readOnly?: boolean;
  /** Note titles offered after typing `[[`. */
  linkTargets?: readonly string[];
  /** Called for Cmd/Ctrl+click on a link. */
  onFollowLink?: (link: EditorLink) => void;
};

export type EditorLink =
  | { kind: "wiki"; title: string }
  | { kind: "href"; href: string };

export type MarkdownEditorHandle = {
  focus: () => void;
  getView: () => EditorView | null;
  insertTable: (rows?: number, columns?: number) => void;
};

export type ImportedImage = { markdownPath: string; alt: string };

type SavedViewState = {
  ranges: Array<{ anchor: number; head: number }>;
  mainIndex: number;
  scrollTop: number;
};

// This is intentionally module-scoped. A parent may use `key={note.path}`, which
// remounts the component; the new instance can still restore the note's view.
const savedViewStates = new Map<string, SavedViewState>();

const commonHighlightAliases = [
  "bash",
  "bat",
  "cjs",
  "cmd",
  "cpp",
  "cs",
  "csharp",
  "cxx",
  "docker",
  "fs",
  "h",
  "hpp",
  "html",
  "ini",
  "js",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "make",
  "md",
  "mjs",
  "objc",
  "patch",
  "plaintext",
  "pm",
  "ps",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "shell",
  "svg",
  "text",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vb",
  "xml",
  "yaml",
  "yml",
  "zsh",
];

const codeFenceLanguageOptions = [
  ...new Set([...Object.keys(highlightLanguages), ...commonHighlightAliases]),
]
  .sort()
  .map((label) => ({ label, type: "keyword" }));

export const codeFenceLanguageCompletions: CompletionSource = (context) => {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);
  const match = /^(?: {0,3})```([^\s`]*)$/.exec(beforeCursor);
  if (!match) return null;

  return {
    from: context.pos - match[1].length,
    options: codeFenceLanguageOptions,
  };
};

function isImageFile(file: File) {
  return (
    file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name)
  );
}

function imageFileFromDataTransfer(data: DataTransfer | null) {
  const file = Array.from(data?.files ?? []).find(isImageFile);
  if (file) return file;

  for (const item of Array.from(data?.items ?? [])) {
    if (item.kind !== "file") continue;
    const itemFile = item.getAsFile();
    if (!itemFile) continue;
    if (
      item.type.startsWith("image/") ||
      isImageFile(itemFile) ||
      (!item.type && !itemFile.type && !itemFile.name)
    ) {
      return itemFile;
    }
  }
}

function hasImageDataTransfer(data: DataTransfer | null) {
  return (
    Boolean(imageFileFromDataTransfer(data)) ||
    Array.from(data?.items ?? []).some(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    )
  );
}

// Colors come from the active palette so highlighting follows every theme.
const markdownHighlightStyle = HighlightStyle.define([
  {
    tag: tags.heading1,
    fontWeight: "750",
    fontSize: "1.25em",
    color: "var(--text)",
  },
  {
    tag: tags.heading2,
    fontWeight: "720",
    fontSize: "1.12em",
    color: "var(--text)",
  },
  {
    tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    fontWeight: "700",
    color: "var(--text)",
  },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  {
    tag: tags.strikethrough,
    textDecoration: "line-through",
    color: "var(--muted)",
  },
  { tag: [tags.link, tags.url], color: "var(--accent)" },
  {
    tag: tags.monospace,
    color: "var(--accent-strong)",
    fontFamily: "var(--mono-font)",
  },
  { tag: tags.quote, color: "var(--muted)", fontStyle: "italic" },
  {
    tag: [tags.processingInstruction, tags.meta, tags.contentSeparator],
    color: "var(--faint)",
  },
]);

const codeLine = Decoration.line({ class: "cm-code-line" });

/** Shades the lines of code blocks so they stand apart from prose. */
function codeBlockLines(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
        const first = view.state.doc.lineAt(node.from).number;
        const last = view.state.doc.lineAt(node.to).number;
        for (
          let number = Math.max(first, lastLine + 1);
          number <= last;
          number++
        )
          builder.add(
            view.state.doc.line(number).from,
            view.state.doc.line(number).from,
            codeLine,
          );
        lastLine = Math.max(lastLine, last);
        return false;
      },
    });
  }
  return builder.finish();
}

const codeBlockShading = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = codeBlockLines(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = codeBlockLines(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "0",
    color: "inherit",
    backgroundColor: "transparent",
    fontSize: "inherit",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    // Chosen in Settings; code always stays monospace.
    fontFamily: "var(--editor-font)",
    lineHeight: "1.7",
    fontSize: "var(--editor-font-size)",
  },
  ".cm-content": {
    minHeight: "100%",
    maxWidth: "820px",
    padding: "28px clamp(20px, 4vw, 48px) 64px",
    caretColor: "var(--accent)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor:
      "color-mix(in srgb, var(--accent) 22%, transparent) !important",
  },
  ".cm-placeholder": { color: "var(--faint)" },
  ".cm-line": { padding: "0" },
  ".cm-line.cm-code-line": {
    fontFamily: "var(--mono-font)",
    padding: "0 10px",
    margin: "0 -10px",
    backgroundColor: "var(--surface-soft)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
  },
  ".cm-tooltip-autocomplete > ul > li": { color: "var(--text)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--text)",
  },
  ".cm-completionDetail": { color: "var(--muted)" },
  ".cm-panels": {
    backgroundColor: "var(--surface-soft)",
    color: "var(--text)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    padding: "8px 12px",
    fontFamily: "inherit",
    fontSize: "12px",
  },
  ".cm-search br": { flexBasis: "100%", height: "0" },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    color: "var(--muted)",
  },
  ".cm-textfield": {
    minWidth: "180px",
    padding: "5px 8px",
    color: "var(--text)",
    backgroundColor: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    fontSize: "12px",
  },
  ".cm-button": {
    padding: "4px 9px",
    color: "var(--text)",
    backgroundImage: "none",
    backgroundColor: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    fontSize: "12px",
  },
  ".cm-search button[name=close]": {
    marginLeft: "auto",
    color: "var(--muted)",
    fontSize: "16px",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--accent) 38%, transparent)",
  },
});

export function captureViewState(view: EditorView): SavedViewState {
  const { selection } = view.state;
  return {
    ranges: selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
    mainIndex: selection.mainIndex,
    scrollTop: view.scrollDOM.scrollTop,
  };
}

export function selectionFromSaved(
  saved: SavedViewState | undefined,
  docLength: number,
): EditorSelection {
  if (!saved?.ranges.length) {
    return EditorSelection.create([EditorSelection.cursor(0)]);
  }
  const clamp = (position: number) =>
    Math.max(0, Math.min(position, docLength));
  return EditorSelection.create(
    saved.ranges.map(({ anchor, head }) =>
      EditorSelection.range(clamp(anchor), clamp(head)),
    ),
    Math.min(saved.mainIndex, saved.ranges.length - 1),
  );
}

function selectedRange(
  from: number,
  to: number,
  backwards: boolean,
): ReturnType<typeof EditorSelection.range> {
  return backwards
    ? EditorSelection.range(to, from)
    : EditorSelection.range(from, to);
}

/**
 * Whether a run of `*` delimiters around text already applies `marker`.
 * Single `*` is italic and `**` bold, so `**bold**` is not italic while
 * `***both***` is.
 */
function asteriskRunHasMarker(run: number, marker: string) {
  return marker === "*" ? run % 2 === 1 : run >= 2;
}

function asteriskRun(text: string, fromEnd: boolean) {
  const match = fromEnd ? /\**$/.exec(text) : /^\**/.exec(text);
  return Math.min(3, match?.[0].length ?? 0);
}

export function wrapSelection(
  view: EditorView,
  left: string,
  right = left,
): boolean {
  const { state } = view;
  const asterisks = left === right && /^\*{1,2}$/.test(left);
  const transaction = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const backwards = range.anchor > range.head;
    const selectionHasMarker = asterisks
      ? asteriskRunHasMarker(
          Math.min(asteriskRun(selected, false), asteriskRun(selected, true)),
          left,
        ) && selected.length > 2 * asteriskRun(selected, false)
      : true;
    const surroundingHasMarker = asterisks
      ? asteriskRunHasMarker(
          Math.min(
            asteriskRun(
              state.sliceDoc(Math.max(0, range.from - 3), range.from),
              true,
            ),
            asteriskRun(state.sliceDoc(range.to, range.to + 3), false),
          ),
          left,
        )
      : true;

    if (
      !range.empty &&
      selectionHasMarker &&
      selected.startsWith(left) &&
      selected.endsWith(right) &&
      selected.length >= left.length + right.length
    ) {
      const inner = selected.slice(left.length, selected.length - right.length);
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: selectedRange(range.from, range.from + inner.length, backwards),
      };
    }

    const hasSurroundingMarkers =
      surroundingHasMarker &&
      range.from >= left.length &&
      range.to + right.length <= state.doc.length &&
      state.sliceDoc(range.from - left.length, range.from) === left &&
      state.sliceDoc(range.to, range.to + right.length) === right;

    if (!range.empty && hasSurroundingMarkers) {
      return {
        changes: [
          { from: range.from - left.length, to: range.from },
          { from: range.to, to: range.to + right.length },
        ],
        range: selectedRange(
          range.from - left.length,
          range.to - left.length,
          backwards,
        ),
      };
    }

    const insert = `${left}${selected}${right}`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: range.empty
        ? EditorSelection.cursor(range.from + left.length)
        : selectedRange(
            range.from + left.length,
            range.from + left.length + selected.length,
            backwards,
          ),
    };
  });

  view.dispatch({
    changes: transaction.changes,
    selection: transaction.selection,
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const transaction = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const insert = `[${selected}]()`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(
        selected.length ? range.from + selected.length + 3 : range.from + 1,
      ),
    };
  });

  view.dispatch({
    changes: transaction.changes,
    selection: transaction.selection,
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

export function insertImage(view: EditorView, image: ImportedImage): boolean {
  const { state } = view;
  const transaction = state.changeByRange((range) => {
    const alt = image.alt.replace(/[\[\]\r\n]/g, " ").trim() || "image";
    const insert = `![${alt}](<${image.markdownPath}>)`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });
  view.dispatch({
    changes: transaction.changes,
    selection: transaction.selection,
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

export function applyHeading(view: EditorView, level: number): boolean {
  const range = view.state.selection.main;
  const start = view.state.doc.lineAt(range.from);
  const end = view.state.doc.lineAt(range.to);
  const source = view.state.sliceDoc(start.from, end.to);
  const prefix = `${"#".repeat(level)} `;
  const replacement = source
    .split("\n")
    .map((line) => `${prefix}${line.replace(/^#{1,6}\s+/, "")}`)
    .join("\n");

  view.dispatch({
    changes: { from: start.from, to: end.to, insert: replacement },
    selection: EditorSelection.range(
      start.from,
      start.from + replacement.length,
    ),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

export function insertTable(
  view: EditorView,
  requestedRows = 3,
  requestedColumns = 3,
): boolean {
  const rows = Math.min(12, Math.max(1, Math.floor(requestedRows)));
  const columns = Math.min(8, Math.max(1, Math.floor(requestedColumns)));
  // Insert after any selected text rather than replacing it.
  const at = view.state.selection.main.to;
  const range = { from: at, to: at };
  const header = Array.from(
    { length: columns },
    (_, index) => ` Column ${index + 1} `,
  );
  const divider = Array.from({ length: columns }, () => " --- ");
  const body = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => "   "),
  );
  const table = [header, divider, ...body]
    .map((cells) => `|${cells.join("|")}|`)
    .join("\n");
  const before =
    range.from > 0 && view.state.sliceDoc(range.from - 1, range.from) !== "\n"
      ? "\n\n"
      : "";
  const after =
    range.to < view.state.doc.length &&
    view.state.sliceDoc(range.to, range.to + 1) !== "\n"
      ? "\n\n"
      : "";
  const replacement = `${before}${table}${after}`;
  const cellStart = range.from + before.length + 2;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: replacement },
    selection: EditorSelection.cursor(cellStart),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

// CodeMirror's search panel labels, in the app's sentence case.
const searchPhrases = {
  Find: "Find",
  Replace: "Replace",
  next: "Next",
  previous: "Previous",
  all: "All",
  "match case": "Match case",
  regexp: "Regex",
  "by word": "Whole word",
  replace: "Replace",
  "replace all": "Replace all",
  close: "Close",
};

function linkMatchAt(
  text: string,
  offset: number,
  pattern: RegExp,
): RegExpMatchArray | null {
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (offset >= start && offset <= start + match[0].length) return match;
  }
  return null;
}

/** The wiki link, Markdown link, or bare URL at `offset` within a line. */
export function linkAt(text: string, offset: number): EditorLink | null {
  const wiki = linkMatchAt(text, offset, /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g);
  if (wiki) return { kind: "wiki", title: wiki[1].trim() };
  const markdown = linkMatchAt(
    text,
    offset,
    /(!?)\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g,
  );
  // Images are not links to follow.
  if (markdown && !markdown[1])
    return { kind: "href", href: markdown[2].replace(/^<|>$/g, "") };
  const url = linkMatchAt(text, offset, /\b(?:https?:\/\/|www\.)[^\s<>()\]]+/g);
  // Sentence punctuation after a bare URL is not part of it.
  return url ? { kind: "href", href: url[0].replace(/[.,;:!?]+$/, "") } : null;
}

const wikiLinkStart = /\[\[[^[\]|\n]*$/;

/** Suggests note titles inside `[[...]]`, completing the closing brackets. */
export function wikiLinkCompletions(
  titles: () => readonly string[],
): CompletionSource {
  return (context) => {
    const match = context.matchBefore(wikiLinkStart);
    if (!match) return null;
    const from = match.from + 2;
    return {
      from,
      validFor: /^[^[\]|\n]*$/,
      options: titles().map((title) => ({
        label: title,
        type: "text",
        apply: (view, _completion, start, end) => {
          const closed = view.state.sliceDoc(end, end + 2) === "]]";
          const insert = closed ? title : `${title}]]`;
          view.dispatch({
            changes: { from: start, to: end, insert },
            selection: { anchor: start + title.length + 2 },
            userEvent: "input.complete",
          });
        },
      })),
    };
  };
}

const taskLine = /^(\s*(?:>\s*)*)(?:([-+*]|\d+[.)])(\s+))?(?:\[([ xX])\]\s?)?/;

/**
 * Toggles the checkbox on each selected line. A list item without a
 * checkbox gains one, and a plain line becomes a task.
 */
export function toggleTaskAtCursor(view: EditorView): boolean {
  const { state } = view;
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number++) lines.add(number);
  }
  const changes = [...lines].flatMap((number) => {
    const line = state.doc.line(number);
    if (!line.text.trim()) return [];
    const [whole, quote, marker, gap, box] = taskLine.exec(line.text)!;
    if (box !== undefined) {
      const at = line.from + whole.indexOf("[") + 1;
      return [{ from: at, to: at + 1, insert: box === " " ? "x" : " " }];
    }
    const at =
      line.from + quote.length + (marker ? marker.length + gap.length : 0);
    return [{ from: at, insert: marker ? "[ ] " : "- [ ] " }];
  });
  if (!changes.length) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent: "input" });
  return true;
}

/** True when the cursor is a single caret at the end of its line. */
function caretAtLineEnd(view: EditorView) {
  const { selection } = view.state;
  const range = selection.main;
  if (selection.ranges.length > 1 || !range.empty) return null;
  const line = view.state.doc.lineAt(range.head);
  return range.head === line.to ? line : null;
}

/**
 * Enter after an opening code fence that is never closed adds the closing
 * fence, so the rest of the note does not turn into code while typing.
 */
export function closeCodeFence(view: EditorView): boolean {
  const line = caretAtLineEnd(view);
  if (!line || completionStatus(view.state) === "active") return false;
  const fence = /^( {0,3})(`{3,}|~{3,})/.exec(line.text);
  if (!fence) return false;
  const kinds = scanFences(view.state.doc.toString().split("\n"));
  const index = line.number - 1;
  if (kinds[index] !== "open" || kinds.slice(index + 1).includes("close"))
    return false;
  const [, indent, marker] = fence;
  view.dispatch({
    changes: { from: line.to, insert: `\n${indent}\n${indent}${marker}` },
    selection: { anchor: line.to + 1 + indent.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

const emptyListItem = /^(?:[-*+]|\d+[.)])(?: \[[ xX]\])?[ \t]*$/;
const listLine = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)|^\s+\S/;

/**
 * Enter on an empty top-level list item ends the list and leaves a blank
 * line, so the next paragraph is not absorbed into the last item.
 */
export function exitEmptyListItem(view: EditorView): boolean {
  const line = caretAtLineEnd(view);
  if (!line || line.number === 1 || !emptyListItem.test(line.text))
    return false;
  if (!listLine.test(view.state.doc.line(line.number - 1).text)) return false;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: "\n" },
    selection: { anchor: line.from + 1 },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

function formattingKeys(readOnly: boolean): KeyBinding[] {
  if (readOnly) return [];
  const binding = (key: string, run: (view: EditorView) => boolean) => ({
    key,
    run,
    preventDefault: true,
    stopPropagation: true,
  });
  return [
    binding("Mod-b", (view) => wrapSelection(view, "**")),
    // `*` also works inside words, where CommonMark ignores `_`.
    binding("Mod-i", (view) => wrapSelection(view, "*")),
    binding("Mod-k", insertLink),
    binding("Mod-Enter", toggleTaskAtCursor),
  ];
}

function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left: string, right: string, prefix: number) {
  const limit = Math.min(left.length, right.length) - prefix;
  let length = 0;
  while (
    length < limit &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  )
    length += 1;
  return length;
}

function saveViewState(notePath: string, view: EditorView): void {
  savedViewStates.set(notePath, captureViewState(view));
}

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    notePath,
    value,
    onChange,
    onBlur,
    onImageFile,
    className,
    style,
    placeholder = "# Start writing",
    ariaLabel = "Markdown note",
    autoFocus = false,
    spellCheck = true,
    readOnly = false,
    linkTargets = [],
    onFollowLink,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const notePathRef = useRef(notePath);
  const extensionsRef = useRef<Extension[]>([]);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const onImageFileRef = useRef(onImageFile);
  const linkTargetsRef = useRef(linkTargets);
  const onFollowLinkRef = useRef(onFollowLink);
  const applyingControlledValueRef = useRef(false);
  const restoreFrameRef = useRef<number | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;
  onImageFileRef.current = onImageFile;
  linkTargetsRef.current = linkTargets;
  onFollowLinkRef.current = onFollowLink;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      getView: () => viewRef.current,
      insertTable: (rows, columns) => {
        if (viewRef.current) insertTable(viewRef.current, rows, columns);
      },
    }),
    [],
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const toolbarWidth = 200;
    const updateToolbarPosition = (view: EditorView) => {
      const selection = view.state.selection.main;
      // Search and other panels also move the selection; the toolbar is
      // only for text the writer selected in the editor itself.
      if (selection.empty || readOnly || !view.hasFocus)
        return setToolbarPosition(null);
      const coordinates = view.coordsAtPos(selection.to);
      const bounds = host.getBoundingClientRect();
      const top = coordinates ? coordinates.top - bounds.top : -1;
      // Hide rather than float over unrelated text once the selection
      // scrolls out of view.
      if (!coordinates || !bounds.width || top < 0 || top > bounds.height)
        return setToolbarPosition(null);
      setToolbarPosition({
        left: Math.max(
          8,
          Math.min(
            bounds.width - toolbarWidth - 8,
            coordinates.left - bounds.left - 82,
          ),
        ),
        top: Math.max(8, top - 46),
      });
    };

    const extensions: Extension[] = [
      markdown(),
      syntaxHighlighting(markdownHighlightStyle),
      codeBlockShading,
      autocompletion({
        override: [
          codeFenceLanguageCompletions,
          wikiLinkCompletions(() => linkTargetsRef.current),
        ],
      }),
      search({ top: true }),
      EditorState.phrases.of(searchPhrases),
      history({ minDepth: 500, newGroupDelay: 300 }),
      closeBrackets(),
      EditorView.lineWrapping,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      editorTheme,
      placeholderExtension(placeholder),
      EditorView.contentAttributes.of({
        "aria-label": ariaLabel,
        "aria-readonly": readOnly ? "true" : "false",
        spellcheck: !readOnly && spellCheck ? "true" : "false",
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingControlledValueRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged)
          updateToolbarPosition(update.view);
      }),
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          const follow = onFollowLinkRef.current;
          if (!follow || !(isMac ? event.metaKey : event.ctrlKey)) return false;
          const position = view.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          });
          if (position === null) return false;
          const line = view.state.doc.lineAt(position);
          const link = linkAt(line.text, position - line.from);
          if (!link) return false;
          event.preventDefault();
          follow(link);
          return true;
        },
        focus: (_event, view) => {
          updateToolbarPosition(view);
          return false;
        },
        blur: () => {
          setToolbarPosition(null);
          onBlurRef.current?.();
          return false;
        },
        paste: (event) => {
          const image = imageFileFromDataTransfer(event.clipboardData);
          if (!image || !onImageFileRef.current) return false;
          event.preventDefault();
          onImageFileRef.current(image, "paste");
          return true;
        },
        dragover: (event) => {
          if (
            !onImageFileRef.current ||
            !hasImageDataTransfer(event.dataTransfer)
          )
            return false;
          event.preventDefault();
          return true;
        },
        drop: (event) => {
          const image = imageFileFromDataTransfer(event.dataTransfer);
          if (!image || !onImageFileRef.current) return false;
          event.preventDefault();
          onImageFileRef.current(image, "drop");
          return true;
        },
      }),
      // Ahead of the Markdown keymap's own Enter (list continuation).
      Prec.highest(
        keymap.of(
          readOnly
            ? []
            : [
                {
                  key: "Enter",
                  run: (view) =>
                    closeCodeFence(view) || exitEmptyListItem(view),
                },
              ],
        ),
      ),
      keymap.of([
        // Formatting precedes the default keymap, which binds Mod-i to
        // syntax selection. stopPropagation keeps app shortcuts (notably
        // Mod-k for search) from also firing.
        ...formattingKeys(readOnly),
        {
          key: "Mod-a",
          run: selectAll,
          preventDefault: true,
          stopPropagation: true,
        },
        indentWithTab,
        ...completionKeymap,
        ...closeBracketsKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...defaultKeymap,
      ]),
    ];
    extensionsRef.current = extensions;

    const saved = savedViewStates.get(notePathRef.current);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        selection: selectionFromSaved(saved, value.length),
        extensions,
      }),
    });
    viewRef.current = view;
    let scrollFrame = 0;
    const followScroll = () => {
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(() =>
        updateToolbarPosition(view),
      );
    };
    view.scrollDOM.addEventListener("scroll", followScroll, { passive: true });

    restoreFrameRef.current = window.requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = saved?.scrollTop ?? 0;
      if (autoFocus) view.focus();
    });

    return () => {
      if (restoreFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreFrameRef.current);
      }
      window.cancelAnimationFrame(scrollFrame);
      view.scrollDOM.removeEventListener("scroll", followScroll);
      saveViewState(notePathRef.current, view);
      view.destroy();
      viewRef.current = null;
    };
    // Editor configuration is fixed for this instance. Mutable callbacks use refs;
    // note and value updates are synchronized by the effect below.
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // The parent remounts the editor for a different note, so a new path on
    // a mounted editor is the same document renamed (for example after its
    // title changed). Keep the selection, scroll, and undo history.
    if (notePathRef.current !== notePath) {
      savedViewStates.delete(notePathRef.current);
      notePathRef.current = notePath;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      // Apply only the changed span so the cursor and history map through it.
      const prefix = commonPrefixLength(currentValue, value);
      const suffix = commonSuffixLength(currentValue, value, prefix);
      applyingControlledValueRef.current = true;
      try {
        view.dispatch({
          changes: {
            from: prefix,
            to: currentValue.length - suffix,
            insert: value.slice(prefix, value.length - suffix),
          },
          annotations: Transaction.addToHistory.of(false),
        });
      } finally {
        applyingControlledValueRef.current = false;
      }
    }
  }, [notePath, value]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ minHeight: 0, ...style }}
      data-note-path={notePath}
    >
      {!readOnly && toolbarPosition && (
        <div
          className="markdown-editor-toolbar"
          style={toolbarPosition}
          role="toolbar"
          aria-label="Format selected text"
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            title="Heading 2"
            onClick={() => viewRef.current && applyHeading(viewRef.current, 2)}
          >
            H2
          </button>
          <button
            type="button"
            title="Heading 3"
            onClick={() => viewRef.current && applyHeading(viewRef.current, 3)}
          >
            H3
          </button>
          <span aria-hidden="true" />
          <button
            type="button"
            title="Bold"
            onClick={() =>
              viewRef.current && wrapSelection(viewRef.current, "**")
            }
          >
            B
          </button>
          <button
            type="button"
            title="Italic"
            onClick={() =>
              viewRef.current && wrapSelection(viewRef.current, "*")
            }
          >
            I
          </button>
          <button
            type="button"
            title="Link"
            onClick={() => viewRef.current && insertLink(viewRef.current)}
          >
            ↗
          </button>
        </div>
      )}
    </div>
  );
});

MarkdownEditor.displayName = "MarkdownEditor";
