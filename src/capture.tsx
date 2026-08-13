import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CaptureComposer,
  captureSuccessDelayMs,
  useCancelableDelay,
} from "./features/capture/CaptureComposer";
import { isMac } from "./platform";
import { native } from "./services/native";
import "./styles.css";

type NoteTemplate = { id: string; name: string; body: string };

const templatesKey = "margin.templates";
const defaultDailyTemplate: NoteTemplate = {
  id: "daily",
  name: "Daily note",
  body: "# {{date}}\n\n## Priorities\n\n- [ ] \n\n## Notes\n\n",
};
const shortcut = isMac
  ? "⌘⌥⇧Space"
  : "Ctrl+Alt+Shift+Space";

function loadTemplates(): NoteTemplate[] {
  try {
    const saved = JSON.parse(
      localStorage.getItem(templatesKey) || "[]",
    ) as NoteTemplate[];
    return saved.length ? saved : [defaultDailyTemplate];
  } catch {
    return [defaultDailyTemplate];
  }
}

function todayTitle() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function expandTemplate(template: NoteTemplate, date = todayTitle()) {
  return template.body.replace(/{{date}}/g, date).replace(
    /{{time}}/g,
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date()),
  );
}

export function CaptureWindow() {
  const captureSession = useRef(0);
  const [session, setSession] = useState(0);
  const [library, setLibrary] = useState<string | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [status, setStatus] = useState("");
  const [templates, setTemplates] = useState<NoteTemplate[]>(loadTemplates);
  const {
    cancel: cancelSuccessHide,
    schedule: scheduleSuccessHide,
  } = useCancelableDelay();

  const invalidateSession = useCallback(() => {
    captureSession.current += 1;
    setSession(captureSession.current);
    cancelSuccessHide();
    return captureSession.current;
  }, [cancelSuccessHide]);

  const hide = useCallback(() => {
    const closedSession = invalidateSession();
    void (async () => {
      try {
        await native.hideQuickCapture();
      } catch {
        if (closedSession !== captureSession.current) return;
        await getCurrentWindow()
          .hide()
          .catch(() => undefined);
      }
    })();
  }, [invalidateSession]);

  const refreshLibrary = useCallback((forSession: number) => {
    setLibraryReady(false);
    void native
      .loadSelectedLibrary()
      .then((selectedLibrary) => {
        if (forSession === captureSession.current)
          setLibrary(selectedLibrary);
      })
      .catch(() => {
        if (forSession === captureSession.current) setLibrary(null);
      })
      .finally(() => {
        if (forSession === captureSession.current) setLibraryReady(true);
      });
  }, []);

  useEffect(() => {
    refreshLibrary(captureSession.current);
  }, [refreshLibrary]);

  useEffect(() => {
    const syncCaptureSession = () => {
      const reopenedSession = invalidateSession();
      setStatus("");
      setTemplates(loadTemplates());
      refreshLibrary(reopenedSession);
    };
    const suppressWebviewMenu = (event: MouseEvent) => event.preventDefault();
    document.documentElement.classList.add("capture-window-html");
    document.body.classList.add("capture-window-body");
    window.addEventListener("focus", syncCaptureSession);
    window.addEventListener("contextmenu", suppressWebviewMenu);
    return () => {
      captureSession.current += 1;
      window.removeEventListener("focus", syncCaptureSession);
      window.removeEventListener("contextmenu", suppressWebviewMenu);
      document.documentElement.classList.remove("capture-window-html");
      document.body.classList.remove("capture-window-body");
    };
  }, [invalidateSession, refreshLibrary]);

  const save = async (text: string): Promise<boolean> => {
    const startedInSession = captureSession.current;
    if (!libraryReady) {
      setStatus("Loading your notes folder…");
      return false;
    }
    if (!library) {
      setStatus("Open Margin and choose your notes folder first.");
      return false;
    }
    try {
      await native.appendQuickNote(
        library,
        text,
        expandTemplate(
          templates.find((template) => template.id === "daily") ||
            templates[0] ||
            defaultDailyTemplate,
        ),
      );
      if (startedInSession !== captureSession.current) return false;
      setStatus("Saved to today’s Daily note");
      scheduleSuccessHide(() => {
        if (startedInSession === captureSession.current) hide();
      }, captureSuccessDelayMs);
      return true;
    } catch (error) {
      if (startedInSession !== captureSession.current) return false;
      setStatus(`Could not save: ${String(error)}`);
      return false;
    }
  };

  return (
    <main className="capture-window">
      <CaptureComposer
        session={session}
        shortcut={shortcut}
        status={
          status ||
          (libraryReady
            ? "Adds to today’s Daily note"
            : "Loading your notes folder…")
        }
        disabled={!libraryReady}
        onClose={hide}
        onSave={save}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CaptureWindow />
  </React.StrictMode>,
);
