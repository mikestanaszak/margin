import { describe, expect, it, vi } from "vitest";
import {
  createUpdateController,
  shouldRunAutomaticUpdateCheck,
} from "./update-controller";

describe("update controller", () => {
  it("runs automatic checks no more than once per day", () => {
    const day = 24 * 60 * 60 * 1000;

    expect(shouldRunAutomaticUpdateCheck("1000", 1000 + day - 1)).toBe(false);
    expect(shouldRunAutomaticUpdateCheck("1000", 1000 + day)).toBe(true);
    expect(shouldRunAutomaticUpdateCheck(null, 1000)).toBe(true);
  });

  it("treats invalid or future stored check times as stale", () => {
    for (const stored of ["", "not-a-number", "Infinity", "-1", "2000"])
      expect(shouldRunAutomaticUpdateCheck(stored, 1000)).toBe(true);
  });

  it("reports a completed manual check when Margin is up to date", async () => {
    const storage = new Map<string, string>();
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(null),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: (key) => storage.get(key) ?? null,
      setStoredValue: (key, value) => storage.set(key, value),
      now: () => 1234,
    });

    await controller.check("manual");

    expect(controller.getState()).toEqual({
      phase: "idle",
      update: null,
      dialogOpen: false,
      message: "Margin is up to date.",
    });
    expect(storage.get("margin.update-last-checked")).toBe("1234");
  });

  it("keeps an automatically discovered update available without interrupting the user", async () => {
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: () => null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });

    await controller.check("automatic");

    expect(controller.getState()).toEqual({
      phase: "available",
      update,
      dialogOpen: false,
      message: "",
    });
  });

  it("suppresses an automatically discovered version the user skipped", async () => {
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: (key) =>
        key === "margin.update-skipped-version" ? "0.6.0" : null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });

    await controller.check("automatic");

    expect(controller.getState()).toEqual({
      phase: "idle",
      update: null,
      dialogOpen: false,
      message: "",
    });
  });

  it("surfaces a skipped version during a manual check", async () => {
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: (key) =>
        key === "margin.update-skipped-version" ? "0.6.0" : null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });

    await controller.check("manual");

    expect(controller.getState()).toEqual({
      phase: "available",
      update,
      dialogOpen: true,
      message: "",
    });
  });

  it("reports a manual check failure without recording a successful check", async () => {
    const setStoredValue = vi.fn();
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockRejectedValue(new Error("offline")),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: () => null,
      setStoredValue,
      now: () => 1234,
    });

    await controller.check("manual");

    expect(controller.getState()).toEqual({
      phase: "idle",
      update: null,
      dialogOpen: false,
      message: "Could not check for updates right now.",
    });
    expect(setStoredValue).not.toHaveBeenCalled();
  });

  it("keeps the update in a downloading state until installation settles", async () => {
    let finishInstall: () => void = () => undefined;
    const install = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: () => install,
    };
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: () => null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });
    await controller.check("manual");

    const installing = controller.install();

    expect(controller.getState()).toEqual({
      phase: "downloading",
      update,
      dialogOpen: true,
      message: "",
    });
    finishInstall();
    await installing;
  });

  it("offers restart after installation succeeds without restarting automatically", async () => {
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
    const relaunchApp = vi.fn().mockResolvedValue(undefined);
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp,
      getStoredValue: () => null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });
    await controller.check("manual");

    await controller.install();

    expect(controller.getState()).toEqual({
      phase: "ready",
      update,
      dialogOpen: true,
      message: "",
    });
    expect(relaunchApp).not.toHaveBeenCalled();
  });

  it("keeps a failed installation available to retry or close", async () => {
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: vi
        .fn()
        .mockRejectedValue(new Error("signature mismatch")),
    };
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: () => null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });
    await controller.check("manual");

    await controller.install();

    expect(controller.getState()).toEqual({
      phase: "error",
      update,
      dialogOpen: true,
      message: "Could not install the update: Error: signature mismatch",
    });
  });

  it("enters restarting only when the user restarts an installed update", async () => {
    let finishRestart: () => void = () => undefined;
    const restart = new Promise<void>((resolve) => {
      finishRestart = resolve;
    });
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp: () => restart,
      getStoredValue: () => null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });
    await controller.check("manual");
    await controller.install();

    const restarting = controller.restart();

    expect(controller.getState()).toEqual({
      phase: "restarting",
      update,
      dialogOpen: true,
      message: "",
    });
    finishRestart();
    await restarting;
  });

  it("returns to ready when restarting fails so the user can retry or close", async () => {
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp: vi.fn().mockRejectedValue(new Error("permission denied")),
      getStoredValue: () => null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });
    await controller.check("manual");
    await controller.install();

    await controller.restart();

    expect(controller.getState()).toEqual({
      phase: "ready",
      update,
      dialogOpen: true,
      message: "Could not restart Margin: Error: permission denied",
    });
  });

  it("records a skipped version and clears the available update", async () => {
    const storage = new Map<string, string>();
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: (key) => storage.get(key) ?? null,
      setStoredValue: (key, value) => storage.set(key, value),
      now: () => 1234,
    });
    await controller.check("manual");

    controller.skip();

    expect(storage.get("margin.update-skipped-version")).toBe("0.6.0");
    expect(controller.getState()).toEqual({
      phase: "idle",
      update: null,
      dialogOpen: false,
      message: "",
    });
  });

  it("publishes each lifecycle state for the UI", async () => {
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(null),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: () => null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });
    const phases: string[] = [];
    controller.subscribe((state) => phases.push(state.phase));

    await controller.check("manual");

    expect(phases).toEqual(["checking", "idle"]);
  });

  it("allows an installation error to be closed and reopened for retry", async () => {
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("offline")),
    };
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: () => null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });
    await controller.check("manual");
    await controller.install();

    controller.closeDialog();
    expect(controller.getState().dialogOpen).toBe(false);

    controller.openDialog();
    expect(controller.getState()).toEqual({
      phase: "error",
      update,
      dialogOpen: true,
      message: "Could not install the update: Error: offline",
    });
  });

  it("does not let a new check replace an installation in progress", async () => {
    let finishInstall: () => void = () => undefined;
    const install = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: () => install,
    };
    const checkForUpdate = vi
      .fn()
      .mockResolvedValueOnce(update)
      .mockResolvedValueOnce(null);
    const controller = createUpdateController({
      checkForUpdate,
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: () => null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });
    await controller.check("manual");
    const installing = controller.install();

    await controller.check("manual");

    expect(controller.getState().phase).toBe("downloading");
    finishInstall();
    await installing;
  });

  it("does not start a duplicate installation while one is in progress", async () => {
    let finishInstall: () => void = () => undefined;
    const install = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    let installAttempts = 0;
    const update = {
      version: "0.6.0",
      body: "Updater improvements",
      downloadAndInstall: () => {
        installAttempts += 1;
        return install;
      },
    };
    const controller = createUpdateController({
      checkForUpdate: vi.fn().mockResolvedValue(update),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: () => null,
      setStoredValue: vi.fn(),
      now: () => 1234,
    });
    await controller.check("manual");

    const firstInstall = controller.install();
    const duplicateInstall = controller.install();

    expect(installAttempts).toBe(1);
    finishInstall();
    await Promise.all([firstInstall, duplicateInstall]);
  });

  it("removes stale update actions while a manual re-check resolves", async () => {
    let finishCheck: (update: {
      version: string;
      body: string;
      downloadAndInstall: () => Promise<void>;
    }) => void = () => undefined;
    const nextCheck = new Promise<{
      version: string;
      body: string;
      downloadAndInstall: () => Promise<void>;
    }>((resolve) => {
      finishCheck = resolve;
    });
    let staleInstallAttempts = 0;
    const staleUpdate = {
      version: "0.6.0",
      body: "Old update",
      downloadAndInstall: () => {
        staleInstallAttempts += 1;
        return Promise.resolve();
      },
    };
    const replacementUpdate = {
      version: "0.6.1",
      body: "Replacement update",
      downloadAndInstall: () => Promise.resolve(),
    };
    const storage = new Map<string, string>();
    const controller = createUpdateController({
      checkForUpdate: vi
        .fn()
        .mockResolvedValueOnce(staleUpdate)
        .mockReturnValueOnce(nextCheck),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: (key) => storage.get(key) ?? null,
      setStoredValue: (key, value) => storage.set(key, value),
      now: () => 1234,
    });
    await controller.check("manual");

    const checking = controller.check("manual");

    expect(controller.getState()).toEqual({
      phase: "checking",
      update: null,
      dialogOpen: false,
      message: "",
    });
    await controller.install();
    controller.skip();
    expect(staleInstallAttempts).toBe(0);
    expect(storage.has("margin.update-skipped-version")).toBe(false);
    expect(controller.getState().phase).toBe("checking");

    finishCheck(replacementUpdate);
    await checking;
    expect(controller.getState()).toEqual({
      phase: "available",
      update: replacementUpdate,
      dialogOpen: true,
      message: "",
    });
  });

  it("removes stale update actions while a manual re-check rejects", async () => {
    let failCheck: (error: Error) => void = () => undefined;
    const nextCheck = new Promise<null>((_resolve, reject) => {
      failCheck = reject;
    });
    const staleUpdate = {
      version: "0.6.0",
      body: "Old update",
      downloadAndInstall: () => Promise.resolve(),
    };
    const storage = new Map<string, string>();
    const controller = createUpdateController({
      checkForUpdate: vi
        .fn()
        .mockResolvedValueOnce(staleUpdate)
        .mockReturnValueOnce(nextCheck),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
      getStoredValue: (key) => storage.get(key) ?? null,
      setStoredValue: (key, value) => storage.set(key, value),
      now: () => 1234,
    });
    await controller.check("manual");

    const checking = controller.check("manual");
    controller.skip();
    failCheck(new Error("offline"));
    await checking;

    expect(storage.has("margin.update-skipped-version")).toBe(false);
    expect(controller.getState()).toEqual({
      phase: "idle",
      update: null,
      dialogOpen: false,
      message: "Could not check for updates right now.",
    });
  });
});
