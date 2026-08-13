import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type NoteTemplate = { id: string; name: string; body: string };

function todayTitle() {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function expandTemplate(template: NoteTemplate, date = todayTitle()) {
  return template.body.replace(/{{date}}/g, date).replace(/{{time}}/g, new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date()));
}

export function TemplateEditorDialog({
  templates,
  onChange,
  onClose,
  onUse,
}: {
  templates: NoteTemplate[];
  onChange: (templates: NoteTemplate[]) => void;
  onClose: () => void;
  onUse: (template: NoteTemplate) => void;
}) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id || "");
  const selected =
    templates.find((template) => template.id === selectedId) || templates[0];
  useEffect(() => {
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [onClose]);
  const update = (changes: Partial<NoteTemplate>) =>
    selected &&
    onChange(
      templates.map((template) =>
        template.id === selected.id ? { ...template, ...changes } : template,
      ),
    );
  const add = () => {
    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `template-${Date.now()}`;
    const template = { id, name: "Untitled template", body: "# Untitled\n\n" };
    onChange([...templates, template]);
    setSelectedId(id);
  };
  const duplicate = () => {
    if (!selected) return;
    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `template-${Date.now()}`;
    const copy = { ...selected, id, name: `${selected.name} copy` };
    onChange([...templates, copy]);
    setSelectedId(id);
  };
  const remove = () => {
    if (!selected || templates.length === 1) return;
    const next = templates.filter((template) => template.id !== selected.id);
    onChange(next);
    setSelectedId(next[0].id);
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal template-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Template editor"
      >
        <header>
          <div>
            <p className="eyebrow">Margin</p>
            <h2>Templates</h2>
          </div>
          <button aria-label="Close templates" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="template-editor-body">
          <nav aria-label="Templates">
            {templates.map((template) => (
              <button
                key={template.id}
                className={template.id === selected?.id ? "selected" : ""}
                onClick={() => setSelectedId(template.id)}
              >
                {template.name}
              </button>
            ))}
            <button className="template-add" onClick={add}>
              ＋ New template
            </button>
          </nav>
          {selected && (
            <div className="template-workspace">
              <div className="template-actions">
                <label>
                  Name
                  <input
                    value={selected.name}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </label>
                <div>
                  <button type="button" onClick={duplicate}>
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={templates.length === 1}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onUse(selected)}
                  >
                    Use as new note
                  </button>
                </div>
              </div>
              <div className="template-columns">
                <label>
                  Markdown
                  <textarea
                    value={selected.body}
                    onChange={(event) => update({ body: event.target.value })}
                    spellCheck
                  />
                </label>
                <article className="preview template-preview">
                  <p className="eyebrow">Preview</p>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {expandTemplate(selected)}
                  </ReactMarkdown>
                </article>
              </div>
              <p className="template-help">
                Variables: <code>{"{{date}}"}</code> and{" "}
                <code>{"{{time}}"}</code>. The template named “Daily note”
                powers Today and Quick Capture.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
