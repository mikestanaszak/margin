import type { NoteDocument } from "../../app/types";
import { rebaseServerRewrite } from "../../note-utils";

export type NoteSessionPhase =
  | "empty"
  | "loading"
  | "clean"
  | "dirty"
  | "saving"
  | "conflict"
  | "error";

export type NoteSessionConflict = {
  disk: NoteDocument;
  mine: NoteDocument;
  path: string;
  libraryPath?: string;
};

export type NoteSessionState = {
  phase: NoteSessionPhase;
  draft: NoteDocument | null;
  conflict: NoteSessionConflict | null;
  error: string | null;
  /**
   * Changes only when a different note is shown. A title rename keeps the
   * same editor session so the cursor, scroll, and undo history survive.
   */
  editorSession: number;
};

export type NoteSessionAction =
  | { type: "cleared" }
  | { type: "loadRequested" }
  | { type: "loadSucceeded"; note: NoteDocument }
  | { type: "loadFailed"; message: string }
  | { type: "edited"; draft: NoteDocument }
  | { type: "saveRequested" }
  | {
      type: "saveSucceeded";
      note: NoteDocument;
      previousPath?: string;
      savedDraft?: NoteDocument;
    }
  | {
      type: "saveConflicted";
      disk: NoteDocument;
      path: string;
      mine?: NoteDocument;
      libraryPath?: string;
    }
  | { type: "saveFailed"; message: string }
  | { type: "conflictDismissed"; phase?: NoteSessionPhase };

export const initialNoteSessionState: NoteSessionState = {
  phase: "empty",
  draft: null,
  conflict: null,
  error: null,
  editorSession: 0,
};

export function noteSessionReducer(
  state: NoteSessionState,
  action: NoteSessionAction,
): NoteSessionState {
  switch (action.type) {
    case "cleared":
      return {
        ...initialNoteSessionState,
        editorSession: state.editorSession + 1,
      };
    case "loadRequested":
      return { ...state, phase: "loading", error: null };
    case "loadSucceeded":
      return {
        phase: "clean",
        draft: action.note,
        conflict: null,
        error: null,
        editorSession:
          state.draft?.path === action.note.path
            ? state.editorSession
            : state.editorSession + 1,
      };
    case "loadFailed":
      return { ...state, phase: "error", error: action.message };
    case "edited":
      return {
        ...state,
        phase: "dirty",
        draft: action.draft,
        conflict: null,
        error: null,
      };
    case "saveRequested":
      return { ...state, phase: "saving", error: null };
    case "saveSucceeded": {
      if (action.previousPath && state.draft?.path !== action.previousPath)
        return state;
      const savedDraft = action.savedDraft;
      const draft = state.draft
        ? {
            ...state.draft,
            // A rename can rewrite the saved body (companion image paths,
            // self links). Carry those rewrites into the live draft.
            body: savedDraft
              ? rebaseServerRewrite(
                  savedDraft.body,
                  action.note.body,
                  state.draft.body,
                )
              : state.draft.body,
            path: action.note.path,
            updated: action.note.updated,
            revision: action.note.revision,
            created: action.note.created,
            updated_at: action.note.updated_at,
          }
        : action.note;
      const changedDuringSave = Boolean(
        savedDraft &&
        state.draft &&
        (state.draft.body !== savedDraft.body ||
          state.draft.title !== savedDraft.title ||
          state.draft.tags.join("\u0000") !== savedDraft.tags.join("\u0000")),
      );
      return {
        ...state,
        phase: changedDuringSave ? "dirty" : "clean",
        draft,
        conflict: null,
        error: null,
      };
    }
    case "saveConflicted":
      return {
        ...state,
        phase: "conflict",
        conflict:
          (action.mine ?? state.draft)
            ? {
                disk: action.disk,
                mine: action.mine ?? state.draft!,
                path: action.path,
                libraryPath: action.libraryPath,
              }
            : null,
        error: null,
      };
    case "saveFailed":
      return { ...state, phase: "error", error: action.message };
    case "conflictDismissed":
      return {
        ...state,
        phase: action.phase ?? (state.draft ? "dirty" : "empty"),
        conflict: null,
      };
  }
}
