# Example note library

`example-library` is a reusable manual and automated test library. Open a copied version in Margin when checking desktop-only behavior; automated Rust tests copy it to a temporary directory before mutating it.

The fixtures cover YAML front matter, duplicate/case-insensitive tags, nested and empty-capable folder structures, Unicode filenames and content, wiki and relative links, tasks, tables, blockquotes, code fences, local images, daily captures, title fallback, ignored non-Markdown assets, and Margin's internal trash.

`desktop-ui` contains additional synthetic notes for visual regression checks. Copy this directory to `UI Checks` inside the copied example library; the rich-content note resolves its image from the example library's `assets` folder. Keep these notes outside the base library so native fixture counts remain stable. See `TESTING.md` for the desktop check procedure.
