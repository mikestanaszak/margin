import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from "react";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
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

export type MarkdownEditorProps = {
  /** Stable filesystem path (or another stable note ID) used for view restoration. */
  notePath: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
};

export type MarkdownEditorHandle = {
  focus: () => void;
  getView: () => EditorView | null;
};

type SavedViewState = {
  ranges: Array<{ anchor: number; head: number }>;
  mainIndex: number;
  scrollTop: number;
};

// This is intentionally module-scoped. A parent may use `key={note.path}`, which
// remounts the component; the new instance can still restore the note's view.
const savedViewStates = new Map<string, SavedViewState>();

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

function captureViewState(view: EditorView): SavedViewState {
  const { selection } = view.state;
  return {
    ranges: selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
    mainIndex: selection.mainIndex,
    scrollTop: view.scrollDOM.scrollTop,
  };
}

function selectionFromSaved(
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

function wrapSelection(view: EditorView, left: string, right = left): boolean {
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

function insertLink(view: EditorView): boolean {
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
    className,
    style,
    placeholder = "# Start writing",
    ariaLabel = "Markdown note",
    autoFocus = false,
    spellCheck = true,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const notePathRef = useRef(notePath);
  const extensionsRef = useRef<Extension[]>([]);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const applyingControlledValueRef = useRef(false);
  const restoreFrameRef = useRef<number | null>(null);

  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      getView: () => viewRef.current,
    }),
    [],
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const extensions: Extension[] = [
      markdown(),
      history(),
      closeBrackets(),
      EditorView.lineWrapping,
      editorTheme,
      placeholderExtension(placeholder),
      EditorView.contentAttributes.of({
        "aria-label": ariaLabel,
        spellcheck: spellCheck ? "true" : "false",
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingControlledValueRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      EditorView.domEventHandlers({
        blur: () => {
          onBlurRef.current?.();
          return false;
        },
        keydown: (event, editorView) => {
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
          const key = event.key.toLowerCase();
          if (key !== "b" && key !== "i" && key !== "k") return false;

          // Keep app-level shortcuts (notably Cmd/Ctrl+K) from also firing.
          event.preventDefault();
          event.stopPropagation();
          if (key === "b") return wrapSelection(editorView, "**");
          if (key === "i") return wrapSelection(editorView, "_");
          return insertLink(editorView);
        },
      }),
      keymap.of([
        indentWithTab,
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
      const saved = savedViewStates.get(notePath);

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
    />
  );
});

MarkdownEditor.displayName = "MarkdownEditor";

export default MarkdownEditor;
