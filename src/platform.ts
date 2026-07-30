export const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);

/** The primary app shortcut is Command on Apple platforms and Control elsewhere. */
export function primaryShortcutPressed(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">) {
  return isMac ? event.metaKey : event.ctrlKey;
}
