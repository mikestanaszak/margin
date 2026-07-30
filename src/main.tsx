import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "./styles.css";

type NoteSummary = { path: string; title: string; tags: string[]; updated: number };
type NoteDocument = NoteSummary & { body: string; created?: string; updated_at?: string };
type Filter = { type: "all" | "untagged" | "tag"; tag?: string };
type MarkdownNode = { type?: string; lang?: string | null; children?: MarkdownNode[] };

const libraryKey = "markdown-notes.library-path";

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp * 1000);
}

function App() {
  const [library, setLibrary] = useState<string | null>(localStorage.getItem(libraryKey));
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDocument | null>(null);
  const [filter, setFilter] = useState<Filter>({ type: "all" });
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [status, setStatus] = useState("Choose a notes folder to begin");
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const transformSelectedLines = (transform: (line: string) => string) => {
    const editor = editorRef.current;
    if (!note || !editor) return;

    const original = note.body;
    const selectionStart = editor.selectionStart;
    const selectionEnd = editor.selectionEnd;
    const lineStart = original.lastIndexOf("\n", selectionStart - 1) + 1;
    const selectedLineEnd = original.indexOf("\n", Math.max(selectionEnd - 1, lineStart));
    const lineEnd = selectedLineEnd === -1 ? original.length : selectedLineEnd;
    const selectedLines = original.slice(lineStart, lineEnd);
    const transformedLines = selectedLines.split("\n").map(transform).join("\n");
    const nextBody = `${original.slice(0, lineStart)}${transformedLines}${original.slice(lineEnd)}`;
    const firstLineDelta = transform(selectedLines.split("\n")[0]).length - selectedLines.split("\n")[0].length;
    const totalDelta = transformedLines.length - selectedLines.length;

    setNote({ ...note, body: nextBody });
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(selectionStart + firstLineDelta, selectionEnd + totalDelta);
    });
  };

  const refresh = async (path = library) => {
    if (!path) return;
    try {
      const result = await invoke<NoteSummary[]>("load_library", { libraryPath: path });
      setNotes(result);
      setStatus(`${result.length} ${result.length === 1 ? "note" : "notes"}`);
    } catch (error) {
      setStatus(`Could not read library: ${String(error)}`);
    }
  };

  useEffect(() => { void refresh(); }, [library]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        if (note) setMode(value => value === "edit" ? "preview" : "edit");
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("#note-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [note, library]);

  useEffect(() => {
    if (!activePath) { setNote(null); return; }
    void (async () => {
      try { setNote(await invoke<NoteDocument>("read_note", { path: activePath })); setMode("edit"); }
      catch (error) { setStatus(`Could not open note: ${String(error)}`); }
    })();
  }, [activePath]);

  useEffect(() => {
    if (!note || mode !== "edit") return;
    const timer = window.setTimeout(() => void saveNote(note), 700);
    return () => window.clearTimeout(timer);
  }, [note?.body, note?.tags.join("\u0000")]);

  const selectLibrary = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Choose your notes folder" });
    if (typeof selected === "string") {
      localStorage.setItem(libraryKey, selected);
      setLibrary(selected); setActivePath(null); setFilter({ type: "all" });
    }
  };

  const createNote = async () => {
    if (!library) { await selectLibrary(); return; }
    try {
      const created = await invoke<NoteDocument>("create_note", { libraryPath: library });
      await refresh(); setActivePath(created.path); setStatus("New note created");
    } catch (error) { setStatus(`Could not create note: ${String(error)}`); }
  };

  const saveNote = async (draft: NoteDocument) => {
    try {
      setStatus("Saving…");
      const saved = await invoke<NoteDocument>("save_note", { note: draft });
      setNote(saved); await refresh(); setStatus("Saved");
    } catch (error) { setStatus(`Save failed: ${String(error)}`); }
  };

  const addTag = (value: string) => {
    if (!note) return;
    const tag = value.trim().replace(/,$/, "");
    if (!tag || note.tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) return;
    setNote({ ...note, tags: [...note.tags, tag] });
  };

  const tagCounts = useMemo(() => notes.reduce<Record<string, number>>((counts, current) => {
    current.tags.forEach(tag => { counts[tag] = (counts[tag] ?? 0) + 1; }); return counts;
  }, {}), [notes]);
  const visibleNotes = useMemo(() => notes.filter(item => {
    const matchFilter = filter.type === "all" || (filter.type === "untagged" ? item.tags.length === 0 : item.tags.some(tag => tag.toLocaleLowerCase() === filter.tag?.toLocaleLowerCase()));
    const haystack = `${item.title} ${item.tags.join(" ")}`.toLocaleLowerCase();
    return matchFilter && haystack.includes(query.toLocaleLowerCase());
  }), [notes, filter, query]);
  const untaggedCount = notes.filter(item => item.tags.length === 0).length;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">✦</span><span>Markdown Notes</span></div>
      <button className="new-note" onClick={() => void createNote()}>＋ New note <kbd>⌘N</kbd></button>
      <label className="search"><span>⌕</span><input id="note-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search notes" /></label>
      <nav>
        <button className={filter.type === "all" ? "nav-item selected" : "nav-item"} onClick={() => setFilter({ type: "all" })}><span>All notes</span><small>{notes.length}</small></button>
        <button className={filter.type === "untagged" ? "nav-item selected" : "nav-item"} onClick={() => setFilter({ type: "untagged" })}><span>Untagged</span><small>{untaggedCount}</small></button>
        <p className="section-label">Tags</p>
        {Object.entries(tagCounts).sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => <button key={tag} className={filter.type === "tag" && filter.tag === tag ? "nav-item selected" : "nav-item"} onClick={() => setFilter({ type: "tag", tag })}><span># {tag}</span><small>{count}</small></button>)}
      </nav>
      <div className="library-control"><button onClick={() => void selectLibrary()}>⌘ Open library</button><p title={library ?? undefined}>{library ? library.split(/[\\/]/).pop() : "No library selected"}</p></div>
    </aside>
    <section className="note-list">
      <header><h1>{filter.type === "tag" ? `# ${filter.tag}` : filter.type === "untagged" ? "Untagged" : "All notes"}</h1><span>{visibleNotes.length}</span></header>
      <div className="notes">{visibleNotes.map(item => <button key={item.path} onClick={() => setActivePath(item.path)} className={item.path === activePath ? "note-card active" : "note-card"}><strong>{item.title || "Untitled"}</strong><div>{item.tags.map(tag => <em key={tag}>#{tag}</em>)}</div><small>{formatDate(item.updated)}</small></button>)}{library && visibleNotes.length === 0 && <p className="empty-list">No matching notes yet.</p>}</div>
    </section>
    <section className="workspace">{note ? <>
      <header className="workspace-header"><div><h2>{note.title || "Untitled"}</h2><span>{status}</span></div><div className="view-switch"><button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>Edit</button><button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>Preview <kbd>⌘E</kbd></button></div></header>
      <div className="tag-editor">{note.tags.map(tag => <button key={tag} onClick={() => setNote({ ...note, tags: note.tags.filter(value => value !== tag) })}>#{tag} ×</button>)}<input aria-label="Add a tag" placeholder="Add tag · Enter" onBlur={event => { addTag(event.currentTarget.value); event.currentTarget.value = ""; }} onKeyDown={event => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTag(event.currentTarget.value); event.currentTarget.value = ""; } }} /></div>
      {mode === "edit" ? <>
        <div className="editor-toolbar" role="toolbar" aria-label="Markdown formatting">
          <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => transformSelectedLines(line => line ? `> ${line}` : ">")}>Quote selected lines</button>
          <span>Select one or more lines, then quote them. Tab indents by two spaces.</span>
        </div>
        <textarea ref={editorRef} aria-label="Markdown note" value={note.body} onChange={event => setNote({ ...note, body: event.target.value })} onKeyDown={event => {
          if (event.key !== "Tab") return;
          event.preventDefault();
          transformSelectedLines(line => event.shiftKey ? line.replace(/^ {1,2}/, "") : `  ${line}`);
        }} placeholder="# Start writing" autoFocus />
      </> : <MarkdownPreview markdown={note.body} />}
    </> : <div className="welcome"><div className="welcome-icon">✦</div><h1>{library ? "Choose a note or create one" : "Your notes, in plain Markdown"}</h1><p>{library ? "Select a note from the list, or make a fresh one." : "Choose a folder. Your notes stay as files you can use anywhere."}</p><button className="primary" onClick={() => void (library ? createNote() : selectLibrary())}>{library ? "New note" : "Choose notes folder"}</button></div>}</section>
  </main>;
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  return <article className="preview"><ReactMarkdown remarkPlugins={[remarkGfm, normalizeCodeLanguages]} rehypePlugins={[rehypeHighlight]}>{markdown}</ReactMarkdown></article>;
}

function normalizeCodeLanguages() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "code" && node.lang) node.lang = node.lang.toLowerCase();
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
