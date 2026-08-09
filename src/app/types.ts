export type NoteSummary = {
  path: string;
  title: string;
  tags: string[];
  updated: number;
  excerpt: string;
  folder: string;
};

export type NoteDocument = {
  path: string;
  title: string;
  tags: string[];
  body: string;
  updated: number;
  revision: string;
  created?: string;
  updated_at?: string;
};

export type IndexWarning = {
  path: string;
  kind: "walk" | "unreadable_markdown" | "invalid_metadata";
};

export type LibrarySnapshot = {
  notes: NoteSummary[];
  folders: string[];
  trash: NoteSummary[];
  warnings: IndexWarning[];
};

export type SaveNoteResult =
  | { status: "saved"; note: NoteDocument }
  | { status: "conflict"; disk: NoteDocument }
  | { status: "error"; message: string };

export type FolderRenameResult = {
  folder: string;
  paths: { from: string; to: string }[];
};

export type ImportedImageResponse = { markdown_path: string; alt: string };
