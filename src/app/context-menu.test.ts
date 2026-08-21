import { describe, expect, it } from "vitest";
import { shouldSuppressWebviewContextMenu } from "./context-menu";

describe("webview context-menu policy", () => {
  it("allows native spelling controls in an editable note", () => {
    const content = document.createElement("div");
    content.className = "cm-content";
    content.setAttribute("contenteditable", "true");
    content.setAttribute("spellcheck", "true");
    const token = document.createElement("span");
    content.append(token);

    expect(shouldSuppressWebviewContextMenu(token)).toBe(false);
  });

  it("suppresses browser menus everywhere else", () => {
    const readOnly = document.createElement("div");
    readOnly.className = "cm-content";
    readOnly.setAttribute("contenteditable", "false");

    expect(shouldSuppressWebviewContextMenu(readOnly)).toBe(true);
    expect(shouldSuppressWebviewContextMenu(document.body)).toBe(true);
    expect(shouldSuppressWebviewContextMenu(null)).toBe(true);
  });
});
