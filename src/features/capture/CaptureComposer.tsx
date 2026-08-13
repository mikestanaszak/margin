import { useCallback, useEffect, useRef, useState } from "react";
import { isMac } from "../../platform";
import { captureMarkdownEdit } from "./capture-markdown";
import "./capture.css";

export type CaptureComposerProps = {
  shortcut: string;
  status: string;
  disabled: boolean;
  session?: number;
  onClose: () => void;
  onSave: (text: string) => boolean | Promise<boolean>;
};

export const captureSuccessDelayMs = 1000;

export function useCancelableDelay() {
  const timer = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const schedule = useCallback(
    (action: () => void, delayMs: number) => {
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        action();
      }, delayMs);
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  return { cancel, schedule };
}

export function CaptureComposer({
  shortcut,
  status,
  disabled,
  session = 0,
  onClose,
  onSave,
}: CaptureComposerProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const saveOperation = useRef(0);

  const invalidateSave = useCallback(() => {
    saveOperation.current += 1;
    setSaving(false);
  }, []);

  const close = useCallback(() => {
    invalidateSave();
    onClose();
  }, [invalidateSave, onClose]);

  useEffect(() => invalidateSave(), [invalidateSave, session]);
  useEffect(
    () => () => {
      saveOperation.current += 1;
    },
    [],
  );

  useEffect(() => {
    const focus = () => window.setTimeout(() => input.current?.focus(), 40);
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    focus();
    window.addEventListener("focus", focus);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [close]);

  const save = async () => {
    if (!text.trim() || disabled || saving) return;
    const operation = ++saveOperation.current;
    setSaving(true);
    try {
      if ((await onSave(text)) && saveOperation.current === operation)
        setText("");
    } catch {
      // The caller owns the user-facing error status. Keep the draft available
      // even if an unexpected rejection escapes that boundary.
    } finally {
      if (saveOperation.current === operation) setSaving(false);
    }
  };

  return (
    <form
      className="capture-card"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="capture-header">
        <div>
          <p className="eyebrow">Margin</p>
          <h1>Quick capture</h1>
        </div>
        <button
          type="button"
          className="capture-close"
          aria-label="Close quick capture"
          onClick={close}
        >
          ×
        </button>
      </header>
      <div className="capture-composer">
        <textarea
          ref={input}
          autoFocus
          placeholder="Start typing…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
              return;
            }
            const textarea = event.currentTarget;
            const next = captureMarkdownEdit(
              text,
              textarea.selectionStart,
              textarea.selectionEnd,
              event.key,
              event.shiftKey,
            );
            if (next) {
              event.preventDefault();
              setText(next.value);
              window.requestAnimationFrame(() =>
                textarea.setSelectionRange(
                  next.selectionStart,
                  next.selectionEnd,
                ),
              );
            }
          }}
        />
      </div>
      <footer>
        <span className="capture-status" role="status">
          {saving ? "Saving…" : status}
        </span>
        <span className="capture-hint">
          <kbd>{shortcut}</kbd>
          <span>opens</span>
          <kbd>{isMac ? "⌘↵" : "Ctrl+Enter"}</kbd>
          <span>saves</span>
        </span>
      </footer>
      <div className="capture-actions">
        <button type="button" className="capture-cancel" onClick={close}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={!text.trim() || disabled || saving}
        >
          Save capture
        </button>
      </div>
    </form>
  );
}
