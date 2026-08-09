import { useEffect, useRef, useState } from "react";
import { isMac } from "../../platform";
import { captureMarkdownEdit } from "./capture-markdown";
import "./capture.css";

export type CaptureComposerProps = {
  shortcut: string;
  status: string;
  disabled: boolean;
  onClose: () => void;
  onSave: (text: string) => boolean | void | Promise<boolean | void>;
};

export function CaptureComposer({
  shortcut,
  status,
  disabled,
  onClose,
  onSave,
}: CaptureComposerProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const focus = () => window.setTimeout(() => input.current?.focus(), 40);
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    focus();
    window.addEventListener("focus", focus);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [onClose]);

  const save = async () => {
    if (!text.trim() || disabled || saving) return;
    setSaving(true);
    try {
      const result = await onSave(text);
      if (result !== false) setText("");
    } finally {
      setSaving(false);
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
          onClick={onClose}
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
        <span className="capture-status">{status}</span>
        <span className="capture-hint">
          <kbd>{shortcut}</kbd>
          <span>opens</span>
          <kbd>{isMac ? "⌘↵" : "Ctrl+Enter"}</kbd>
          <span>saves</span>
        </span>
      </footer>
      <div className="capture-actions">
        <button type="button" className="capture-cancel" onClick={onClose}>
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
