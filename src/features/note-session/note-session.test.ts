import { describe, expect, it } from "vitest";
import type { NoteDocument } from "../../app/types";
import {
  initialNoteSessionState,
  noteSessionReducer,
} from "./note-session";

const note = (body: string, revision = "revision-1"): NoteDocument => ({
  path: "C:/Notes/Example.md",
  title: "Example",
  tags: ["sample"],
  body,
  updated: 1,
  revision,
});

describe("noteSessionReducer", () => {
  it("tracks loading and a successful load", () => {
    const loading = noteSessionReducer(initialNoteSessionState, {
      type: "loadRequested",
    });
    expect(loading).toMatchObject({ phase: "loading", draft: null });

    const loaded = noteSessionReducer(loading, {
      type: "loadSucceeded",
      note: note("Loaded"),
    });
    expect(loaded).toMatchObject({ phase: "clean", draft: note("Loaded") });
  });

  it("tracks edits and a successful save", () => {
    const editedDraft = note("Edited");
    const dirty = noteSessionReducer(
      { ...initialNoteSessionState, phase: "clean", draft: note("Loaded") },
      { type: "edited", draft: editedDraft },
    );
    expect(dirty).toMatchObject({ phase: "dirty", draft: editedDraft });

    const saving = noteSessionReducer(dirty, { type: "saveRequested" });
    expect(saving).toMatchObject({ phase: "saving", draft: editedDraft });

    const savedNote = note("Edited", "revision-2");
    const saved = noteSessionReducer(saving, {
      type: "saveSucceeded",
      note: savedNote,
    });
    expect(saved).toMatchObject({ phase: "clean", draft: savedNote });
  });

  it("preserves the draft when a save conflicts", () => {
    const draft = note("Mine");
    const disk = note("Theirs", "revision-2");
    const conflicted = noteSessionReducer(
      { ...initialNoteSessionState, phase: "saving", draft },
      { type: "saveConflicted", disk, path: draft.path },
    );

    expect(conflicted).toMatchObject({
      phase: "conflict",
      draft,
      conflict: { disk, mine: draft, path: draft.path },
    });
  });

  it("preserves the draft when a save fails", () => {
    const draft = note("Unsaved");
    const failed = noteSessionReducer(
      { ...initialNoteSessionState, phase: "saving", draft },
      { type: "saveFailed", message: "Disk full" },
    );

    expect(failed).toMatchObject({
      phase: "error",
      draft,
      error: "Disk full",
    });
  });

  it("dismisses a background conflict without dirtying a clean draft", () => {
    const draft = note("Current note");
    const conflicted = {
      ...initialNoteSessionState,
      phase: "conflict" as const,
      draft,
      conflict: {
        disk: note("Background disk"),
        mine: { ...note("Background mine"), path: "C:/Notes/Other.md" },
        path: "C:/Notes/Other.md",
      },
    };

    expect(
      noteSessionReducer(conflicted, {
        type: "conflictDismissed",
        phase: "clean",
      }),
    ).toMatchObject({ phase: "clean", draft, conflict: null });
  });

  it("ignores a queued save completion after the active note is cleared", () => {
    expect(
      noteSessionReducer(initialNoteSessionState, {
        type: "saveSucceeded",
        note: note("Saved in background", "revision-2"),
        previousPath: "C:/Notes/Example.md",
      }),
    ).toEqual(initialNoteSessionState);
  });
});
