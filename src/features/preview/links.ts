import type { NoteSummary } from "../../app/types";
import { safeDecodeURIComponent } from "../../note-utils";
import { native } from "../../services/native";

/** Link-following rules shared by Preview and the editor. */

function normalizePath(path: string) {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/").toLowerCase();
}

/** The note a `[[Title]]` link names, matched case-insensitively. */
export function noteForWikiTitle(title: string, notes: NoteSummary[]) {
  const wanted = title.trim().toLowerCase();
  return notes.find((item) => item.title.toLowerCase() === wanted);
}

/** The note a relative or absolute `.md` link points to, if it is indexed. */
export function noteForMarkdownLink(
  href: string | undefined,
  notePath: string,
  notes: NoteSummary[],
) {
  const relativePath = href?.split(/[?#]/, 1)[0];
  if (
    !relativePath ||
    !/\.md$/i.test(relativePath) ||
    /^[a-z][a-z\d+.-]*:/i.test(relativePath)
  )
    return undefined;
  const directory = notePath.replace(/[\\/][^\\/]+$/, "");
  const targetPath = /^[\\/]|^[a-z]:[\\/]/i.test(relativePath)
    ? relativePath
    : `${directory}/${safeDecodeURIComponent(relativePath)}`;
  return notes.find(
    (item) => normalizePath(item.path) === normalizePath(targetPath),
  );
}

/** A web, mail, or phone URL; bare domains such as `example.com` get https. */
export function externalUrl(href?: string) {
  const value = href?.trim();
  if (!value) return undefined;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  return /^(?:www\.)?[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d-]+)+(?:[/?#].*)?$/i.test(
    value,
  )
    ? `https://${value}`
    : undefined;
}

/** Opens an external link in the system browser, reporting failures. */
export function openExternalLink(
  href: string | undefined,
  onError: (message: string) => void,
) {
  const url = externalUrl(href);
  if (!url) {
    onError(
      "Could not open link: use a full web address such as https://example.com",
    );
    return;
  }
  void native.openExternalUrl(url).catch((error) => onError(String(error)));
}
