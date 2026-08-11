import type { NoteDocument } from "../../app/types";

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
};

export type NoteSessionState = {
  phase: NoteSessionPhase;
  draft: NoteDocument | null;
  conflict: NoteSessionConflict | null;
  error: string | null;
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
    }
  | { type: "saveFailed"; message: string }
  | { type: "conflictDismissed"; phase?: NoteSessionPhase };

export const initialNoteSessionState: NoteSessionState = {
  phase: "empty",
  draft: null,
  conflict: null,
  error: null,
};

export function noteSessionReducer(
  state: NoteSessionState,
  action: NoteSessionAction,
): NoteSessionState {
  switch (action.type) {
    case "cleared":
      return initialNoteSessionState;
    case "loadRequested":
      return { ...state, phase: "loading", error: null };
    case "loadSucceeded":
      return {
        phase: "clean",
        draft: action.note,
        conflict: null,
        error: null,
      };
    case "loadFailed":
      return { ...state, phase: "error", error: action.message };
    case "edited":
      return {
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
      const draft = state.draft
        ? {
            ...state.draft,
            path: action.note.path,
            updated: action.note.updated,
            revision: action.note.revision,
            created: action.note.created,
            updated_at: action.note.updated_at,
          }
        : action.note;
      const savedDraft = action.savedDraft;
      const changedDuringSave = Boolean(
        savedDraft &&
          state.draft &&
          (state.draft.body !== savedDraft.body ||
            state.draft.title !== savedDraft.title ||
            state.draft.tags.join("\u0000") !== savedDraft.tags.join("\u0000")),
      );
      return {
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
        conflict: action.mine ?? state.draft
          ? {
              disk: action.disk,
              mine: action.mine ?? state.draft!,
              path: action.path,
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
