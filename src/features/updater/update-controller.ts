export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "error";

export type UpdateCandidate = {
  version: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
};

export type UpdateControllerState = {
  phase: UpdatePhase;
  update: UpdateCandidate | null;
  dialogOpen: boolean;
  message: string;
};

type UpdateControllerDependencies = {
  checkForUpdate: () => Promise<UpdateCandidate | null>;
  relaunchApp: () => Promise<void>;
  getStoredValue: (key: string) => string | null;
  setStoredValue: (key: string, value: string) => void;
  now: () => number;
};

export const updateLastCheckedKey = "margin.update-last-checked";
const updateSkippedVersionKey = "margin.update-skipped-version";

export function shouldRunAutomaticUpdateCheck(
  lastChecked: string | null,
  now: number,
) {
  if (lastChecked === null || lastChecked.trim() === "") return true;

  const checkedAt = Number(lastChecked);
  return (
    !Number.isFinite(checkedAt) ||
    checkedAt < 0 ||
    checkedAt > now ||
    now - checkedAt >= 24 * 60 * 60 * 1000
  );
}

export function createUpdateController(
  dependencies: UpdateControllerDependencies,
) {
  let state: UpdateControllerState = {
    phase: "idle",
    update: null,
    dialogOpen: false,
    message: "",
  };
  const listeners = new Set<(state: UpdateControllerState) => void>();
  const publish = (nextState: UpdateControllerState) => {
    state = nextState;
    listeners.forEach((listener) => listener(state));
  };

  return {
    getState: () => state,
    subscribe(listener: (state: UpdateControllerState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openDialog() {
      if (state.update) publish({ ...state, dialogOpen: true });
    },
    closeDialog() {
      publish({ ...state, dialogOpen: false });
    },
    skip() {
      if (
        !state.update ||
        (state.phase !== "available" && state.phase !== "error")
      )
        return;
      dependencies.setStoredValue(
        updateSkippedVersionKey,
        state.update.version,
      );
      publish({
        phase: "idle",
        update: null,
        dialogOpen: false,
        message: "",
      });
    },
    async restart() {
      if (state.phase !== "ready") return;
      publish({ ...state, phase: "restarting", message: "" });
      try {
        await dependencies.relaunchApp();
      } catch (error) {
        publish({
          ...state,
          phase: "ready",
          message: `Could not restart Margin: ${String(error)}`,
        });
      }
    },
    async install() {
      if (
        !state.update ||
        (state.phase !== "available" && state.phase !== "error")
      )
        return;
      publish({ ...state, phase: "downloading", message: "" });
      try {
        await state.update.downloadAndInstall();
        publish({ ...state, phase: "ready" });
      } catch (error) {
        publish({
          ...state,
          phase: "error",
          message: `Could not install the update: ${String(error)}`,
        });
      }
    },
    async check(kind: "automatic" | "manual") {
      if (
        state.phase === "checking" ||
        state.phase === "downloading" ||
        state.phase === "ready" ||
        state.phase === "restarting"
      )
        return;
      publish({
        phase: "checking",
        update: null,
        dialogOpen: false,
        message: "",
      });
      try {
        const update = await dependencies.checkForUpdate();
        dependencies.setStoredValue(
          updateLastCheckedKey,
          String(dependencies.now()),
        );
        if (
          !update ||
          (kind === "automatic" &&
            dependencies.getStoredValue(updateSkippedVersionKey) ===
              update.version)
        ) {
          publish({
            phase: "idle",
            update: null,
            dialogOpen: false,
            message:
              !update && kind === "manual" ? "Margin is up to date." : "",
          });
        } else {
          publish({
            phase: "available",
            update,
            dialogOpen: kind === "manual",
            message: "",
          });
        }
      } catch {
        publish({
          phase: "idle",
          update: null,
          dialogOpen: false,
          message:
            kind === "manual" ? "Could not check for updates right now." : "",
        });
      }
    },
  };
}
