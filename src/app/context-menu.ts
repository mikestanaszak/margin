export function shouldSuppressWebviewContextMenu(target: EventTarget | null) {
  return !(
    target instanceof Element &&
    target.closest('.cm-content[contenteditable="true"][spellcheck="true"]')
  );
}
