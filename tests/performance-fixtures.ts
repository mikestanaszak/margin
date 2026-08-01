export type PerformanceNoteFixture = {
  path: string;
  title: string;
  tags: string[];
  updated: number;
  searchable_text: string;
  excerpt: string;
  folder: string;
};

/** A deterministic long document that exercises heading extraction and preview work. */
export function createLongNoteFixture(sectionCount = 600) {
  return Array.from({ length: sectionCount }, (_, index) => {
    const level = (index % 3) + 1;
    return `${"#".repeat(level)} Section ${index + 1}\n\n` +
      `A deliberately long paragraph for scrolling, previewing, and outline synchronization. `.repeat(4);
  }).join("\n\n");
}

/** A representative all-notes data set without checking a thousand generated files into git. */
export function createLargeLibraryFixture(count = 1_000): PerformanceNoteFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `C:/Notes/Projects/Area ${Math.floor(index / 50)}/Note ${index + 1}.md`,
    title: `Note ${index + 1}`,
    tags: [],
    updated: 1_700_000_000_000 + index,
    searchable_text: `Note ${index + 1} project planning reference`,
    excerpt: "A compact list-card excerpt for virtualized rendering.",
    folder: `Projects/Area ${Math.floor(index / 50)}`,
  }));
}
