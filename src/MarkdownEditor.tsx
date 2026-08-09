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
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { all as highlightLanguages } from "lowlight";
import { primaryShortcutPressed } from "./platform";

export type MarkdownEditorProps = {
  /** Stable filesystem path (or another stable note ID) used for view restoration. */
  notePath: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onInsertImage?: () => void;
  onImageFile?: (file: File, source: "drop" | "paste") => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
  readOnly?: boolean;
};

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

const codeFenceLanguageOptions = [...new Set([
  ...Object.keys(highlightLanguages),
  ...commonHighlightAliases,
])]
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
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    lineHeight: "1.7",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "24px 32px",
    caretColor: "currentColor",
  },
  ".cm-line": { padding: "0" },
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
  const clamp = (position: number) => Math.max(0, Math.min(position, docLength));
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

export function wrapSelection(view: EditorView, left: string, right = left): boolean {
  const { state } = view;
  const transaction = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const backwards = range.anchor > range.head;

    if (
      !range.empty &&
      selected.startsWith(left) &&
      selected.endsWith(right) &&
      selected.length >= left.length + right.length
    ) {
      const inner = selected.slice(left.length, selected.length - right.length);
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: selectedRange(
          range.from,
          range.from + inner.length,
          backwards,
        ),
      };
    }

    const hasSurroundingMarkers =
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
  view.dispatch({ changes: transaction.changes, selection: transaction.selection, scrollIntoView: true, userEvent: "input" });
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
    selection: EditorSelection.range(start.from, start.from + replacement.length),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

export function insertTable(view: EditorView, requestedRows = 3, requestedColumns = 3): boolean {
  const rows = Math.min(12, Math.max(1, Math.floor(requestedRows)));
  const columns = Math.min(8, Math.max(1, Math.floor(requestedColumns)));
  const range = view.state.selection.main;
  const header = Array.from({ length: columns }, (_, index) => ` Column ${index + 1} `);
  const divider = Array.from({ length: columns }, () => " --- ");
  const body = Array.from({ length: rows }, () => Array.from({ length: columns }, () => "   "));
  const table = [header, divider, ...body].map((cells) => `|${cells.join("|")}|`).join("\n");
  const before = range.from > 0 && view.state.sliceDoc(range.from - 1, range.from) !== "\n" ? "\n\n" : "";
  const after = range.to < view.state.doc.length && view.state.sliceDoc(range.to, range.to + 1) !== "\n" ? "\n\n" : "";
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
    onInsertImage,
    onImageFile,
    className,
    style,
    placeholder = "# Start writing",
    ariaLabel = "Markdown note",
    autoFocus = false,
    spellCheck = true,
    readOnly = false,
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
  const applyingControlledValueRef = useRef(false);
  const restoreFrameRef = useRef<number | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number } | null>(null);

  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;
  onImageFileRef.current = onImageFile;

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
    const updateToolbarPosition = (view: EditorView) => {
      const selection = view.state.selection.main;
      if (selection.empty) return setToolbarPosition(null);
      const coordinates = view.coordsAtPos(selection.to);
      const bounds = host.getBoundingClientRect();
      if (!coordinates || !bounds.width) return setToolbarPosition(null);
      setToolbarPosition({
        left: Math.min(bounds.width - 236, Math.max(8, coordinates.left - bounds.left - 82)),
        top: Math.max(8, coordinates.top - bounds.top - 46),
      });
    };

    const extensions: Extension[] = [
      markdown(),
      autocompletion({ override: [codeFenceLanguageCompletions] }),
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
        if (update.selectionSet || update.docChanged) updateToolbarPosition(update.view);
      }),
      EditorView.domEventHandlers({
        blur: () => {
          onBlurRef.current?.();
          return false;
        },
        keydown: (event, editorView) => {
          if (readOnly) return false;
          if (!primaryShortcutPressed(event) || event.altKey) return false;
          const key = event.key.toLowerCase();
          if (key !== "b" && key !== "i" && key !== "k") return false;

          // Keep app-level shortcuts (notably Cmd/Ctrl+K) from also firing.
          event.preventDefault();
          event.stopPropagation();
          if (key === "b") return wrapSelection(editorView, "**");
          if (key === "i") return wrapSelection(editorView, "_");
          return insertLink(editorView);
        },
        paste: (event) => {
          const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
          if (!image || !onImageFileRef.current) return false;
          event.preventDefault();
          onImageFileRef.current(image, "paste");
          return true;
        },
        dragover: (event) => {
          if (!onImageFileRef.current || !Array.from(event.dataTransfer?.files ?? []).some((file) => file.type.startsWith("image/"))) return false;
          event.preventDefault();
          return true;
        },
        drop: (event) => {
          const image = Array.from(event.dataTransfer?.files ?? []).find((file) => file.type.startsWith("image/"));
          if (!image || !onImageFileRef.current) return false;
          event.preventDefault();
          onImageFileRef.current(image, "drop");
          return true;
        },
      }),
      keymap.of([
        indentWithTab,
        ...completionKeymap,
        ...closeBracketsKeymap,
        ...historyKeymap,
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

    restoreFrameRef.current = window.requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = saved?.scrollTop ?? 0;
      if (autoFocus) view.focus();
    });

    return () => {
      if (restoreFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreFrameRef.current);
      }
      saveViewState(notePathRef.current, view);
      view.destroy();
      viewRef.current = null;
    };
    // Editor configuration is fixed for this instance. Mutable callbacks use refs;
    // note and value updates are synchronized by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (notePathRef.current !== notePath) {
      saveViewState(notePathRef.current, view);
      notePathRef.current = notePath;
      // A title edit can rename the current file. When its document is
      // unchanged, carry the active view state to the new path rather than
      // treating it as a different note and jumping back to the top.
      const currentViewState = captureViewState(view);
      const renamedInPlace = view.state.doc.toString() === value;
      const saved = savedViewStates.get(notePath) ?? (renamedInPlace ? currentViewState : undefined);

      // A fresh EditorState prevents undo history from crossing note boundaries.
      view.setState(
        EditorState.create({
          doc: value,
          selection: selectionFromSaved(saved, value.length),
          extensions: extensionsRef.current,
        }),
      );

      if (restoreFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreFrameRef.current);
      }
      restoreFrameRef.current = window.requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = saved?.scrollTop ?? 0;
      });
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      const currentViewState = captureViewState(view);
      applyingControlledValueRef.current = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
          selection: selectionFromSaved(currentViewState, value.length),
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
      {!readOnly && onInsertImage && <button type="button" className="markdown-editor-image-button" title="Insert image" aria-label="Insert image" onClick={onInsertImage}>Image</button>}
      {!readOnly && toolbarPosition && <div className="markdown-editor-toolbar" style={toolbarPosition} role="toolbar" aria-label="Format selected text" onMouseDown={event => event.preventDefault()}>
        <button type="button" title="Heading 2" onClick={() => viewRef.current && applyHeading(viewRef.current, 2)}>H2</button>
        <button type="button" title="Heading 3" onClick={() => viewRef.current && applyHeading(viewRef.current, 3)}>H3</button>
        <span aria-hidden="true" />
        <button type="button" title="Bold" onClick={() => viewRef.current && wrapSelection(viewRef.current, "**")}>B</button>
        <button type="button" title="Italic" onClick={() => viewRef.current && wrapSelection(viewRef.current, "_")}>I</button>
        <button type="button" title="Link" onClick={() => viewRef.current && insertLink(viewRef.current)}>↗</button>
        <button type="button" title="Insert 3 by 3 table" onClick={() => viewRef.current && insertTable(viewRef.current)}>▦</button>
      </div>}
    </div>
  );
});

MarkdownEditor.displayName = "MarkdownEditor";
