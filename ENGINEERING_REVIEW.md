# Margin engineering review

**Review date:** 2026-08-15

**Reviewed version:** 0.5.0 working tree based on `main` at `3c8e832` (`v0.5.0`)

**Review basis:** independent static inspection of the current React/TypeScript application, Tauri/Rust backend, tests, capabilities, packaging, installers, release workflows, and product documentation. The previous contents of this file were treated as stale and were not used as evidence.

## Validation status

The completed updater synchronization was reviewed against the final controller, React wiring, tests, product specification, and testing guide. The final automated validation matrix is green:

- Exact `pnpm test`: **passed** — unit suite **166/166 tests**, Mermaid integration **3/3 tests**.
- Focused updater/controller plus application tests: **71/71 passed**; the controller suite accounts for **19/19**.
- `pnpm build`: **passed**. The preceding full build processed **2,618 modules** and reported a main bundle around **1.7 MB / 564 kB gzip**, with a `>500 kB` chunk warning; the final updater-only build remained green.
- `cargo test --manifest-path src-tauri/Cargo.toml`: **46/46 passed**.
- `cargo check --manifest-path src-tauri/Cargo.toml`: **passed**.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: **passed**.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`: **passed**.

Before the test-discovery correction, the focused updater/application run passed **64/64**, and a root-only unit run passed **158/158** when `.worktrees/**` was excluded manually; the literal unit command had instead discovered `.worktrees/v0.5.0` and loaded a duplicate React instance. Vitest now preserves its defaults and excludes nested worktrees in configuration (`vite.config.ts:1`, `vite.config.ts:22-25`), with a regression test (`scripts/toolchain-config.test.ts:6-27`), so the final exact aggregate command above is authoritative. No native Tauri bundle build or manual `pnpm tauri dev` desktop exercise was reported in this review, so this status does not claim those flows.

Inspected areas include all production TypeScript/TSX modules under `src/`, the Rust modules under `src-tauri/src/`, Tauri configuration and capabilities, the Vite/package configuration, test sources and fixtures, release and CI workflows, installer scripts, `README.md`, `PRODUCT_SPEC.md`, `TESTING.md`, and `CHANGELOG.md`. No source file was changed as part of this review.

## Executive summary

Margin 0.5.0 is a credible local-first desktop application with unusually strong stabilization work for its size. Native path containment, symlink rejection, optimistic revision conflicts, queued autosave convergence, quit/save coordination, a process-owned search/backlink index, a separate capture bundle, strict production CSP, and broad behavioral tests are all present in current code.

The release should not be considered fully hardened, however. The most serious correctness issue is a real overwrite path on case-sensitive macOS volumes: the filename helper assumes every macOS filesystem is case-insensitive and can select an already-existing, distinct case variant as a case-only rename target. Two other data-integrity boundaries need immediate work: encoded image references can be deleted as “unreferenced,” and staged backlink repair does not revalidate other files before replacing them, so an external edit during a title rename can be overwritten. The manual installers also do not provide the trust guarantees described by the signed updater story, and the macOS workflow is ad-hoc signed rather than publisher-signed/notarized.

Architecturally, the extraction of feature components, a typed native service, and now a platform-independent updater controller is valuable, but `App.tsx` still owns almost every lifecycle, persistence, navigation, dialog, and filesystem orchestration concern. Large-library behavior is much better than earlier designs, yet each filesystem change can still trigger a complete synchronous re-index, Quick Open transfers the entire library for its empty-query top ten, and the outline runs a permanent animation-frame loop while open. The updater lifecycle is sound, isolated, and well tested after final review fixes.

## Updater synchronization and independent code review

The final updater behavior matches the 0.5.0 product contract. Daily automatic checks suppress the stored skipped version, while manual checks surface it; corrupt or future cadence timestamps are conservatively treated as stale (`src/features/updater/update-controller.ts:34-47`, `src/features/updater/update-controller.ts:126-165`). Check/install guards prevent normal overlap and duplicate installation, install success stops at `ready`, and relaunch is accepted only from that state (`src/features/updater/update-controller.ts:91-133`). Install/restart errors preserve a retry-or-close path (`src/features/updater/update-controller.ts:72-125`). An accepted re-check clears the old candidate and closes its dialog before awaiting the platform, so stale install/skip actions cannot affect it (`src/features/updater/update-controller.ts:126-139`); resolve and reject paths are covered (`src/features/updater/update-controller.test.ts:413-512`). Nineteen controller tests cover cadence/storage resilience, skip semantics, failures, lifecycle publication, install/relaunch gating, close/reopen, and overlap (`src/features/updater/update-controller.test.ts:8-512`). React tests cover manual reconsideration, restarting, retry/close, busy-state controls, live feedback, and state-accurate headings (`src/main.test.tsx:112-266`, `src/main.test.tsx:858-896`). No automatic-restart path is present.

| Final code-review severity | Assessment | Evidence / recommendation |
|---|---|---|
| **Critical** | None remain in the updater change. | Final controller, application wiring, UI, and tests re-read after review fixes. |
| **Important** | None remain in the updater change. The initially identified stale-candidate re-check race was fixed before finalization. | Checks now publish a fresh non-actionable `checking` state (`src/features/updater/update-controller.ts:126-139`), with deferred resolve/reject regressions (`src/features/updater/update-controller.test.ts:413-512`). |
| **Minor** | None remain in the updater change after review fixes. | Invalid/future timestamps are covered (`src/features/updater/update-controller.ts:34-47`, `src/features/updater/update-controller.test.ts:8-19`); dialog and Settings feedback now use accurate busy/alert/status semantics (`src/app/App.tsx:2467-2522`, `src/features/settings/SettingsDialog.tsx:217-235`, `src/main.test.tsx:199-265`, `src/main.test.tsx:858-896`). |

## Prioritized findings

| Severity | Finding and evidence | Impact | Recommendation | Effort / change risk |
|---|---|---|---|---|
| **Critical** | **A case-only title rename can overwrite a distinct note on a case-sensitive macOS volume.** `path_for_title` treats all macOS targets as case-insensitive and returns the requested destination solely from an ASCII case-insensitive filename comparison (`src-tauri/src/paths.rs:201-219`). `rename_file_safely` then performs an intermediate rename and renames onto that destination (`src-tauri/src/notes.rs:908-925`). On case-sensitive APFS, `Foo.md` and `foo.md` may be separate files; the latter can be replaced. CI runs functional tests on Windows and only builds packages on Linux, with no macOS test job (`.github/workflows/test.yml:15-57`, `.github/workflows/test.yml:74-105`). | Destructive loss of an existing note during an ordinary title edit. Companion assets and repaired links can compound the damage. | Before any case-hop, distinguish “same directory entry with different spelling” from “different existing destination.” If the destination exists and is not the source identity, use `unique_path`; add tests on a case-sensitive filesystem and a macOS CI smoke job. | Small–medium implementation; high test importance; low product risk once covered. |
| **High** | **Encoded image references can be deleted on save.** Preview intentionally decodes a relative image URL once (`src/features/preview/MarkdownPreview.tsx:44-57`), but cleanup decides liveness with raw substring searches for only the unencoded folder and filename (`src-tauri/src/assets.rs:119-160`). A reference such as `Note.assets/My%20image.png` can render and then be removed during the next save. | Irrecoverable deletion of a user's local image while the note still visibly references it. | Parse Markdown image destinations, decode exactly once, normalize only safe relative paths, and compare normalized paths inside the companion directory. Add percent-encoded space/Unicode/query/fragment tests and never delete on a parse ambiguity. | Medium; moderate parser/compatibility risk. |
| **High** | **Title-rename link repair can overwrite concurrent external edits in other notes.** The repair planner reads every Markdown file (`src-tauri/src/notes.rs:759-785`), staging stores copies and replacements (`src-tauri/src/notes.rs:808-835`), and commit replaces targets without checking that they still match what was read (`src-tauri/src/notes.rs:875-905`). Revision checking covers the active note only (`src-tauri/src/notes.rs:929-943`). | An edit made in another editor during a rename can be silently replaced by stale staged content. The rollback protects transaction failures, not concurrent writers. | Record a digest/identity for every planned source and revalidate all targets immediately before the first replacement; abort with a conflict if any changed. Consider serializing mutations per library and expose the affected paths in the conflict UI. | Medium–large; moderate behavior risk; requires concurrency tests. |
| **High** | **Manual installation does not match the signed-update trust story.** Windows and Linux download release executables without checking the Tauri `.sig`, a digest, or a platform signature (`install.ps1:10-29`, `install-linux.sh:24-40`). macOS release builds set `APPLE_SIGNING_IDENTITY` to `-`, i.e. ad-hoc signing (`.github/workflows/release.yml:43-54`), while `install.sh` accepts any bundle for which `codesign --verify` succeeds (`install.sh:43-55`). The artifact verifier checks names and manifest version, not signatures, manifest platforms/URLs, or signing identity (`scripts/verify-release-assets.mjs:4-29`). | Users who choose the documented installer scripts receive materially weaker authenticity guarantees than in-app updater users; macOS distribution lacks publisher identity/notarization. | Verify updater signatures in Windows/Linux installers using a pinned public key or publish and verify SHA-256 values from a separately authenticated manifest. Use Developer ID signing and notarization for macOS, and make release verification inspect `latest.json` platform entries, URLs, and signatures. Correct documentation until those guarantees exist. | Medium operational effort; high release/process risk because secrets and notarization are involved. |
| **High** | **Move operations break portable relative Markdown links.** Link repair is invoked only when saving to a new title-derived filename (`src-tauri/src/notes.rs:959-1031`). `move_note_to_folder` directly moves the note/assets (`src-tauri/src/notes.rs:1158-1185`), and `rename_folder` directly renames the directory (`src-tauri/src/notes.rs:252-316`). Incoming links from outside the moved subtree and outgoing links crossing the moved boundary are not rewritten. | Navigation and backlinks silently disappear after supported note/folder organization actions; ordinary Markdown links become stale on disk. | Reuse the staged rewrite transaction for note moves. For folder renames, compute old/new paths for every Markdown file and repair only links whose resolved target changes unambiguously. Revalidate concurrent files as required by the preceding finding. | Large; high compatibility risk; should be staged behind focused fixture tests. |
| **Medium** | **Frontend containment is incorrect on case-sensitive systems.** `pathIsInLibrary` lowercases both paths on every OS (`src/app/App.tsx:187-193`). It controls whether a note is editable (`src/app/App.tsx:1414-1416`, `src/app/App.tsx:1471-1525`), while the Rust backend correctly enforces real canonical containment. Two sibling Linux/macOS directories differing only by case can therefore make an external note appear managed; edits then fail at save time. | A user can edit a note that the UI promises to autosave, only to receive a backend failure and an in-memory recovery draft. | Stop making filesystem identity decisions in JavaScript. Return an explicit managed/external classification and canonical note ID from Rust; at minimum make comparison platform-aware and use canonical values supplied by the backend. | Medium; low implementation risk if native ownership becomes authoritative. |
| **Medium** | **A post-commit asset-cleanup error is reported as if the note save failed.** The note is already replaced and reread before cleanup runs (`src-tauri/src/notes.rs:1032-1037`). Any cleanup failure returns `SaveNoteResult::Error`; the frontend retains and retries the draft as unsaved (`src/app/App.tsx:1006-1024`). That retry uses a now-stale revision and can turn the successful write into a confusing conflict. | False failure/retry/conflict states; users cannot accurately tell whether text is safely on disk. | Split “note committed” from “asset cleanup warning” in the result type. Update the baseline/revision after a committed write, surface cleanup non-destructively, and retry cleanup separately. | Small–medium; low data-format risk, moderate UI-state risk. |
| **Medium** | **Library updates still perform whole-library synchronous work under one mutex.** `LibraryIndex::with_index` holds its mutex while rebuilding the complete snapshot and link index (`src-tauri/src/library.rs:91-119`, `src-tauri/src/library.rs:138-159`). The frontend polls active-note external state every 2.5 seconds and asks the index to reconcile (`src/app/App.tsx:733-776`); autosaves mark the watcher dirty, so the next poll can reread every note. | Large libraries can experience periodic command stalls, search latency, and battery/disk churn after edits even though list rendering is virtualized. | Maintain per-path index records from watcher events, rebuild off-lock, and atomically swap a completed snapshot. Keep the 45-second full reconciliation as recovery. Instrument index duration and file counts before choosing thresholds. | Large; moderate concurrency risk. |
| **Medium** | **Search and Quick Open overfetch and issue work on every query change.** `useLibrarySearch` invokes native search immediately for each effect and filters scope only after the full result returns (`src/features/search/useLibrarySearch.ts:36-65`). Empty-query search clones/sorts every note (`src-tauri/src/library.rs:367-390`), while Quick Open then keeps only ten (`src/components/navigation-qol.tsx:40-41`). | Excess IPC, allocation, and rendering pressure for large libraries; fast typing still computes discarded requests because cancellation is only client-side. | Pass scope and a result limit to Rust, apply both before cloning/serialization, debounce nonempty queries briefly, and add generation/cancellation inside the native service if profiling shows long scans. | Medium; low behavior risk if ranking tests remain authoritative. |
| **Medium** | **Updater state logic is well unit-tested, but the signed native install path is not exercised end to end.** Nineteen controller tests cover cadence and corrupt storage, skipped versions, no-update/error feedback, installation, retry, success, restart gating, lifecycle publication, duplicate-action guards, and stale-candidate re-checks (`src/features/updater/update-controller.test.ts:8-512`); React interaction coverage checks the principal visible and accessible states (`src/main.test.tsx:112-266`, `src/main.test.tsx:858-896`). These use mocked updater/relaunch dependencies. `TESTING.md` correctly reserves signature verification and real install/relaunch for a signed staged release (`TESTING.md:50`, `TESTING.md:65`). | Unit/React regressions are now likely to be caught, but platform packaging, signature validation, filesystem replacement, and relaunch can still fail only after downloading a real signed release. | Add a staged signed-update lane for each supported updater target, retain the last installable fixture release, and verify valid download/install, invalid-signature rejection, user-triggered relaunch, and preserved library selection. | Large operational effort; high CI complexity. |
| **Medium** | **Modal and context-menu accessibility is incomplete.** Some surfaces declare dialogs, but `ConflictDialog` has neither `role="dialog"` nor `aria-modal` (`src/app/App.tsx:2824-2857`), and `FolderDialog` is an unlabelled form on a backdrop (`src/app/App.tsx:2554-2608`). Modal rendering does not make the background inert or trap/restore focus (`src/app/App.tsx:2004-2266`). The custom context menu declares `role="menu"` but supplies no roving focus, arrow-key behavior, or initial focus (`src/app/App.tsx:2267-2417`). | Keyboard and screen-reader users can reach background controls, lose context, or be unable to operate a UI that claims menu semantics. | Introduce one dialog primitive with labelled title, focus trap, Escape policy, inert background, and focus restoration. Implement proper menu keyboard behavior or use ordinary buttons without menu semantics. Add keyboard-only and axe-style tests. | Medium; low functional risk, moderate focus-regression risk. |
| **Medium** | **`App.tsx` remains the primary change-coupling and race surface.** `App` begins at `src/app/App.tsx:224`, owns more than thirty state/ref domains through `src/app/App.tsx:381`, implements library/note/save/capture/quit orchestration through `src/app/App.tsx:428-1700`, and renders every workspace/dialog surface through `src/app/App.tsx:1774-2266`. Its matching interaction test is about 95 KB and combines unrelated concerns (`src/main.test.tsx:112-2767`). | New work can accidentally disturb save queues, active-note generations, dialog state, or updater behavior; tests are slow to understand and heavily mock implementation details. | Extract domain hooks/controllers in risk order: `useNotePersistence`, `useLibraryIndex`, `useQuitCoordinator`, and `useOpenedMarkdown`, following the updater controller already extracted. Keep the reducer and typed native facade, and move tests beside each controller before changing behavior. | Medium–large; moderate refactor risk; do incrementally. |
| **Low** | **The outline consumes an animation frame continuously while open.** After installing normal scroll listeners, it also schedules `reconcileScrollPositions` on every frame until unmount (`src/features/preview/Outline.tsx:121-181`). | Avoidable CPU/battery usage while reading a static note; it scales with every open outline session. | Replace the permanent loop with event-driven synchronization plus a short-lived frame only after programmatic scroll/layout changes. Respect reduced-motion behavior for smooth scrolling. | Small; low risk. |
| **Low** | **Persisted UI-state parsing is inconsistent.** Templates and shortcuts catch malformed JSON (`src/app/App.tsx:128-136`, `src/app/App.tsx:166-182`), but favorites parse directly during render (`src/app/App.tsx:317-319`). `Number(null)` also makes first-run pane widths clamp to 180 rather than use the supplied defaults (`src/app/App.tsx:162-164`, `src/app/App.tsx:238-246`). | Corrupt storage can blank the workspace; first-run panes do not use the intended dimensions. | Centralize versioned, schema-checked settings reads with safe defaults and a narrow migration/reset path. Test missing, malformed, and obsolete values. | Small; low risk. |
| **Low** | **The asset protocol scope is broader than the runtime design requires.** Production statically allows `$HOME/**` (`src-tauri/tauri.conf.json:9`), while selected/opened Markdown directories are already granted dynamically (`src-tauri/src/windows.rs:151-186`, `src-tauri/src/windows.rs:416-440`). Preview also accepts parent-relative image paths without constraining them to the note or library (`src/features/preview/MarkdownPreview.tsx:43-58`). | A future renderer compromise would have a wider local-file read surface than necessary, and user-authored Markdown can preview images outside the library when scope permits. | Start with an empty/minimal static scope, dynamically allow only the selected library and explicit external-note parent, and decide/document whether `..` image references are a supported portability feature. Add capability tests for allowed and denied paths. | Small–medium; moderate cross-platform testing risk. |
| **Low** | **Documentation overstates managed image cleanup and underspecifies Paper.** The README says Margin removes only files it created (`README.md:37`), but no provenance is stored and cleanup removes every unreferenced direct file (`src-tauri/src/assets.rs:136-151`). The spec's palette summary names Ink, Mint, and Linen (`PRODUCT_SPEC.md:40`) and only mentions Paper later (`PRODUCT_SPEC.md:44`). | Users can place an unrelated file in a companion folder based on a false safety promise; feature documentation is internally inconsistent. | Either track managed asset provenance or state clearly that `<note>.assets` is app-managed. List all four palettes in one canonical section. | Small docs change, or medium if provenance is added. |

## Correctness and data integrity

### Save lifecycle and conflicts

The current save architecture is substantially safer than a basic debounce. Each loaded file has a content-and-mtime revision (`src-tauri/src/notes.rs:50-59`), backend saves reject a stale revision (`src-tauri/src/notes.rs:929-943`), the frontend owns immutable queued drafts and path aliases (`src/app/App.tsx:355-426`, `src/app/App.tsx:957-1159`), and the note-session reducer preserves changes made while a save is in flight (`src/features/note-session/note-session.ts:83-109`). Note changes from disk are polled and either cleanly reloaded or turned into an explicit conflict (`src/app/App.tsx:733-776`). Failed background drafts remain in a recovery map and participate in quit blocking (`src/app/App.tsx:1535-1643`, `src/app/App.tsx:2189-2221`).

The remaining concurrency boundaries are important:

- The active-note revision check is a check-then-replace sequence, not an atomic filesystem compare-and-swap (`src-tauri/src/notes.rs:933-975`). The window is small for a same-name save but should still be covered by stress tests.
- Rename transactions widen that window across every linked note and currently do not revalidate the other files before replacement.
- Cleanup errors occur after text is committed but are returned as save failures, so the protocol needs a committed-with-warning state.
- Quick Capture uses the same revision-aware `save_note_document` path (`src-tauri/src/capture.rs:10-46`), so concurrent capture attempts fail rather than silently overwrite, but there is no retry/merge of two valid appends.

### Filesystem operations and portability

The backend consistently canonicalizes selected libraries, rejects paths outside them, and refuses symlinks within them (`src-tauri/src/paths.rs:17-75`). Folder inputs reject absolute and parent components (`src-tauri/src/paths.rs:77-97`). Filenames are NFC-normalized, invalid Windows characters and reserved device names are handled, and UTF-8 byte length is bounded (`src-tauri/src/paths.rs:144-199`). Tests explicitly cover containment, symlinks, `.markdown`, collisions, restore disambiguation, and case-only renames (`src-tauri/src/notes.rs:1825-2009`). These are strong foundations.

The macOS case-sensitive collision is the exception that must be fixed first. Filesystem behavior should be detected from destination identity/existence, never inferred only from `target_os`. The same principle supports moving the JavaScript managed-note classification into Rust.

Move and folder-rename behavior is physically safe in the sense that it stays within the selected library, moves companion assets with the note, and disambiguates collisions. It is not yet semantically safe for relative Markdown links. Because Margin advertises ordinary portable Markdown links and a shared backlink graph, link preservation should be part of these operations rather than an undocumented tradeoff.

### Images and assets

Image import validates magic bytes, enforces a 25 MB limit, chooses portable names, and writes only to the active note's companion directory (`src-tauri/src/assets.rs:66-88`, `src-tauri/src/assets.rs:254-323`). Asset directories move and copy with notes, including rollback if the note move fails (`src-tauri/src/assets.rs:163-233`). The editor inserts angle-bracket Markdown destinations, which correctly tolerate spaces (`src/MarkdownEditor.tsx:327-338`).

Cleanup is the weak point. It should use the same URL-decoding and path-normalization semantics as preview, and it should define ownership. The current substring algorithm cannot safely distinguish a percent-encoded live reference, a similarly named substring, an indirect reference, or a user-owned file. Deletion should be conservative: uncertainty must retain the asset and produce at most a warning.

## Architecture and state flow

0.5.0 has real boundaries now:

- `src/services/native.ts:12-119` is a single typed frontend/native facade.
- `src/features/note-session/note-session.ts:3-133` makes note phases and conflict transitions explicit.
- Search, capture, library navigation, preview, settings, templates, editor, and view controls are separated into feature modules.
- Rust responsibilities are split into paths, notes, assets, capture, indexing, model, and window lifecycle modules (`src-tauri/src/lib.rs:3-25`).

The updater extraction demonstrates the right direction: lifecycle transitions and injected platform dependencies now live in a small controller, while `App` only creates, subscribes to, and presents it (`src/features/updater/update-controller.ts:1-178`, `src/app/App.tsx:299-316`, `src/app/App.tsx:477-514`). The remaining concern is orchestration concentration. `App.tsx` still combines persistence queues, view state, opened-file routing, quick capture fallback, asset import, every mutation, and every modal. The number of refs is justified individually, but together they encode a state machine that TypeScript cannot verify. Incremental controller extraction should preserve existing behavior rather than become a broad visual refactor. The best next seam is note persistence because it already has a reducer and extensive tests; quit coordination can then consume a small `flushAll(): Promise<FlushResult>` interface instead of observing several maps and refs.

The Rust index also uses one coarse mutex around snapshot rebuilding and reads. A better boundary is a background builder producing immutable `Arc` snapshots, with a short lock only for swap/access. That enables per-path invalidation later without changing the frontend contract.

## Performance, startup, and bundle behavior

Present strengths include memoized note cards (`src/components/navigation-qol.tsx:180-218`), virtualization for flat lists at 120 notes (`src/features/library/NoteList.tsx:5-10`, `src/features/library/NoteList.tsx:68-147`), deferred split-preview/outline input (`src/app/App.tsx:1405-1412`, `src/app/App.tsx:1499-1500`), memoized preview (`src/features/preview/MarkdownPreview.tsx:254`), lazy Mermaid import and a serialized render queue (`src/MermaidDiagram.tsx:3-53`), and an independent capture entry enforced by a production bundle test (`scripts/bundle-boundaries.test.ts:14-57`). These directly support startup and typing responsiveness.

Remaining scaling costs are mostly outside React row rendering:

1. Every dirty/reconciled index rebuild recursively reads and parses all notes while holding the index mutex.
2. Search lowercases and scans all native searchable text for every request (`src-tauri/src/library.rs:393-425`), requests are not debounced, and scope filtering happens after IPC.
3. Folder counts perform a full note scan for each folder on every snapshot (`src/app/App.tsx:1392-1404`). Counts belong in the native snapshot or a single frontend pass.
4. The outline's permanent animation-frame reconciliation should be event-driven.
5. The main bundle imports all Lowlight languages in both editor and preview (`src/MarkdownEditor.tsx:34`, `src/features/preview/MarkdownPreview.tsx:7,142`). The production build passes but reports a **1,712.03 kB / 564.46 kB gzip** main bundle and a `>500 kB` warning. Startup parsing remains unmeasured; profile the bundle, then register a curated language set or lazily load highlighting if those imports are material.

The existing performance tests cover a long-note outline budget and the virtualization threshold (`tests/performance-pass.test.ts:19-31`). They do not measure native index construction, repeated watcher invalidation, IPC payload size, editor time-to-interactive, or memory on a multi-thousand-note corpus. Those measurements should drive the larger index redesign.

## Security and privacy

The production posture is generally thoughtful:

- Production CSP blocks eval, frames, objects, and forms, while development allowances are separate (`src-tauri/tauri.conf.json:9`).
- Plugin permissions are isolated to the main window; capture receives only the shared core capability (`src-tauri/capabilities/default.json:3-7`, `src-tauri/capabilities/desktop.json:1-17`).
- External links are allowlisted in both the preview and native command to HTTP(S), mail, and telephone schemes (`src/features/preview/MarkdownPreview.tsx:87-107`, `src-tauri/src/windows.rs:396-414`).
- React Markdown does not enable raw HTML, and Mermaid uses strict security mode (`src/features/preview/MarkdownPreview.tsx:137-250`, `src/MermaidDiagram.tsx:67-79`).
- CI actions are commit-pinned and the configuration is tested (`scripts/security-config.test.ts:76-91`). Frontend and Rust dependency audits run in CI (`.github/workflows/test.yml:41-42`, `.github/workflows/test.yml:59-71`).
- Note bodies stay in the native index rather than the normal snapshot payload (`src-tauri/src/model.rs:4-14`, `src-tauri/src/library.rs:219-239`). There is no telemetry or cloud data dependency in the application code.

The priority security work is distribution authenticity, followed by narrowing asset scope. The `$HOME/**` scope was added for reliable image startup, but the code now dynamically grants the selected library and external-note parents; keeping both mechanisms should be justified by platform tests, not retained by default. Custom `read_note` intentionally reads explicit external Markdown paths for file-open integration (`src-tauri/src/notes.rs:208-211`), so maintaining a renderer without XSS-capable raw HTML remains important.

## UX and accessibility

The product is coherent: preview-first reading, a consistent native-ranked Search/Quick Open model, hierarchical folders, explicit conflict comparison, visible save status, recoverable failed drafts, keyboard-resizable panes, native spellcheck only for editable notes, and a lightweight capture window. Accessible names exist on most icon buttons and separators, focus-visible styling is present, code copy announces state, and note cards expose unsaved/favorite/tag semantics.

The largest accessibility gap is the absence of a shared modal behavior layer. Dialog semantics are inconsistent, focus is not trapped/restored, and background panes remain interactive to assistive technology. The context menu similarly uses ARIA menu roles without the matching keyboard model. Fixing this centrally will improve Settings, templates, table editors, updater, import, conflict, folder, and recovery surfaces together.

Other UX issues worth addressing with that work:

- Error and status strings share a general status location; persistent save/index problems should have a stable, navigable problem surface rather than transient header text (`src/app/App.tsx:1890-1896`).
- Index warnings expose only a count in navigation (`src/features/library/LibraryNavigation.tsx:140-153`); users cannot see which file was skipped or why, even though native warnings include path and kind (`src-tauri/src/model.rs:16-35`).
- The Quick Capture dedicated window displays the default shortcut string, not the user's configured shortcut (`src/capture.tsx:21-23`, `src/capture.tsx:161-175`). The native registration is configurable, so the hint can become stale.
- Reduced-motion rules cover only a subset of component transitions; outline programmatic scrolling and feature CSS should follow one policy.

## Cross-platform, updater, and release engineering

The supported platform matrix is explicit and internally mostly consistent: Windows x64, Apple Silicon macOS, Linux x64 Debian/AppImage (`PRODUCT_SPEC.md:47-55`, `.github/workflows/release.yml:13-24`). Windows functional CI is comprehensive, Linux packaging is built on every test workflow, actions are pinned, and release publication verifies that the expected three-platform artifacts and updater manifest exist.

Gaps:

- There is no macOS test/build gate in the regular test workflow. The release workflow is the first time the macOS package is built, which is too late for path, tray, window, updater, and signing failures.
- Linux packages build, but Rust/React behavior is tested only on Windows. This leaves case-sensitive path logic and desktop-environment behavior undercovered.
- Windows/Linux file-open startup consumes command-line paths in `setup` (`src-tauri/src/windows.rs:480-483`), while subsequent open events are implemented only for macOS (`src-tauri/src/windows.rs:537-568`). No single-instance plugin is configured (`src-tauri/Cargo.toml:10-28`, `src-tauri/src/lib.rs:28-45`). Opening a Markdown file while Margin already runs can therefore start another instance instead of routing the file to the existing workspace, with duplicate tray/shortcut behavior.
- Manual installer authenticity and macOS signing/notarization need the high-priority changes described above.
- Release verification validates presence, not installability. A minimal package launch smoke test and signed staged-updater test are still needed.

The finalized updater controller performs one-day cadence checks with corrupt/future-storage recovery, distinguishes automatic from manual skipped-version behavior, clears old actions before re-checking, gates concurrent checks/installs, stops after successful installation, and relaunches only on an explicit user action (`src/features/updater/update-controller.ts:34-176`). Product and testing documentation describe that behavior accurately (`PRODUCT_SPEC.md:47-53`, `TESTING.md:50`, `TESTING.md:65`). The remaining release gap is native rather than controller-level: no signed staged artifact is installed and relaunched in CI.

## Test coverage and quality

### What is covered well

- Rust workflow tests exercise real temporary libraries for create/save/rename/duplicate/move/trash/restore/delete/import, containment, symlink rejection, Unicode filenames, stale revisions, asset movement/cleanup, link scanning/repair, and rollback (`src-tauri/src/notes.rs:1278-2009`, `src-tauri/src/assets.rs:326-469`).
- Native indexing tests cover ranking, empty queries, trash scope, warnings, invalid metadata, asset-folder pruning, external edits, watcher reconciliation, payload boundaries, and backlinks (`src-tauri/src/library.rs:537-1154`).
- Frontend tests cover stale search responses, note-session transitions, editor commands, image input, split layout, capture races, save-queue convergence, inactive draft recovery, quit request ordering, refresh coordination, update UI state, and substantial rendering behavior (`src/features/search/useLibrarySearch.test.tsx:32-188`, `src/features/note-session/note-session.test.ts:18-166`, `src/MarkdownEditor.test.ts:65-314`, `src/main.test.tsx:112-2767`).
- The updater now has a dedicated platform-independent controller suite covering daily/manual checks, invalid stored cadence, skipped-version semantics, errors, retry/close, successful install without automatic restart, explicit restart, lifecycle publication, overlapping-action guards, and stale-action removal during deferred re-checks (`src/features/updater/update-controller.test.ts:8-512`).
- Mermaid has a dedicated single-worker integration suite, and the capture bundle boundary is verified only after a production build (`package.json:14-21`, `scripts/bundle-boundaries.test.ts:42-57`).
- CI runs tests, build, Rust format/check/clippy, frontend audit, Rust audit, and Linux package construction (`.github/workflows/test.yml:38-105`).

### Important gaps

1. No case-sensitive macOS test can catch the critical filename collision.
2. No tests combine preview URL decoding with native asset cleanup for encoded paths.
3. Staged link repair tests inject apply/rollback failures, but not an external edit between plan/stage/commit.
4. Note/folder move tests do not assert preservation of incoming and outgoing relative links.
5. No real Tauri integration test crosses React event listeners and native quit/window state; both halves are tested separately.
6. Updater unit/React tests do not install and relaunch a signed staged release.
7. Accessibility tests assert selected labels/interactions but do not audit focus trapping, keyboard menus, background inertness, accessible dialog names, or contrast.
8. Performance tests do not exercise the native index, watcher churn, native search serialization, startup, or memory.
9. No Windows existing-instance file-open test, Linux behavioral job, or regular macOS build/test job exists.
10. Configuration tests sometimes assert exact source/CSS strings (`scripts/security-config.test.ts:16-33`, `scripts/style-ownership.test.ts:23-39`). They catch accidental drift but can pass while behavior is broken and make harmless refactors noisy; pair them with behavior or parsed-structure tests.

## Confirmed 0.5.0 stabilization items now present

The following major stabilization work is present in current code, independent of changelog claims:

- **Explicit note session phases and preserved drafts:** reducer states cover loading, clean, dirty, saving, conflict, and error; edits during save remain dirty (`src/features/note-session/note-session.ts:3-133`).
- **Per-note convergent save queues across renames and note switches:** owned draft snapshots, queue keys, aliases, and recovery maps are implemented (`src/app/App.tsx:355-426`, `src/app/App.tsx:957-1159`).
- **Optimistic external-change protection:** revisions include content digest and timestamp; stale saves return the disk version and the UI presents both choices (`src-tauri/src/notes.rs:50-59`, `src-tauri/src/notes.rs:929-943`, `src/app/App.tsx:2222-2266`).
- **Quit waits for managed-note persistence:** native dirty state, request IDs, timeout confirmation, cancellation, and frontend queue draining are implemented (`src-tauri/src/windows.rs:55-136`, `src-tauri/src/windows.rs:239-339`, `src/app/App.tsx:1570-1670`).
- **Native cached library snapshot/search/backlinks:** process-owned index, watcher dirtiness, reconciliation, native ranking, trash scope, and unified link index are implemented (`src-tauri/src/library.rs:25-188`, `src-tauri/src/library.rs:334-478`).
- **Reduced webview payload:** searchable bodies are skipped in serialized summaries while excerpts remain (`src-tauri/src/model.rs:3-14`).
- **Large-list and preview responsiveness:** flat-list virtualization, memoized rows/preview, deferred split rendering, lazy Mermaid loading, and a separate capture bundle are implemented (`src/features/library/NoteList.tsx:5-147`, `src/components/navigation-qol.tsx:216-218`, `src/MermaidDiagram.tsx:38-53`, `vite.config.ts:13-21`).
- **Frontend/native boundaries and module split:** a typed native service, feature directories, and a platform-independent updater controller replace a single-file-only structure, even though `App.tsx` remains the orchestration center (`src/services/native.ts:12-119`, `src/features/updater/update-controller.ts:1-178`, `src/app/App.tsx:15-77`).
- **Filesystem safety:** canonical library roots, internal-symlink rejection, portable filename sanitation, real folders, trash/restore disambiguation, and staged link-rewrite rollback are implemented (`src-tauri/src/paths.rs:17-239`, `src-tauri/src/notes.rs:788-927`).
- **Companion image lifecycle:** validated imports, sibling asset folders, note rename/move/copy/trash/restore support, hidden asset folders, and once-decoded Windows/Unicode preview paths are implemented (`src-tauri/src/assets.rs:39-323`, `src/features/preview/MarkdownPreview.tsx:43-58`). The encoded-cleanup defect remains.
- **Desktop lifecycle:** dedicated Quick Capture window, global shortcut replacement without dropping the previous binding, tray Show/Capture/Quit, hide-on-close, and OS-opened Markdown routing are implemented (`src-tauri/src/windows.rs:198-237`, `src-tauri/src/windows.rs:341-370`, `src-tauri/src/windows.rs:443-568`). Existing-instance routing remains incomplete off macOS.
- **Security/configuration hardening:** strict production CSP, scoped plugin capabilities, native URL allowlist, no raw HTML preview, strict Mermaid mode, commit-pinned actions, and dependency audits are present.
- **Updater lifecycle and release contract:** automatic checks honor the stored skipped version and recover from invalid timestamps; manual checks surface skipped releases; accepted re-checks remove old actions; normal overlap/duplicate installation is guarded; install success waits in `ready`; restart requires an explicit action; failure states preserve retry/close; and dialog/Settings feedback is accessible (`src/features/updater/update-controller.ts:34-176`, `src/features/updater/update-controller.test.ts:8-512`, `src/app/App.tsx:2467-2522`, `src/features/settings/SettingsDialog.tsx:217-235`, `src/main.test.tsx:112-266`, `src/main.test.tsx:858-896`). Signed updater artifacts are requested, three platform builds are configured, and a post-publish job checks required filenames plus manifest version (`src-tauri/tauri.conf.json:10-11`, `.github/workflows/release.yml:13-73`, `scripts/verify-release-assets.mjs:4-29`). Signature/install/relaunch verification and real-platform staged testing remain incomplete.
- **Static app identity:** one packaged icon set is configured rather than palette-dependent runtime icon switching (`src-tauri/tauri.conf.json:10`).

## Prioritized implementation agenda

### Immediate — protect user data and release trust

1. Fix case-sensitive macOS destination identity before any additional rename work; add a distinct `Foo.md`/`foo.md` collision test on a case-sensitive filesystem.
2. Replace substring asset cleanup with conservative parsed/decoded reference tracking; add encoded space and Unicode regression tests before shipping the fix.
3. Add digest revalidation to staged multi-file link repair so external edits abort rather than get replaced.
4. Change save results to distinguish committed text from post-commit cleanup warnings.
5. Align installer/release claims with actual trust: pin and verify downloadable artifacts, and decide the Developer ID/notarization path for macOS.

### Near term — make supported workflows semantically complete

1. Repair relative Markdown links for note moves and folder renames using the revalidated transaction mechanism.
2. Move managed/external note classification into the backend and remove unconditional JavaScript lowercasing.
3. Add existing-instance file-open routing on Windows/Linux and integration tests for launch-while-running behavior.
4. Introduce shared accessible dialog/menu primitives and apply them to conflict, recovery, folder, import, templates, tables, settings, and updater UI.
5. Return warning details rather than only a count, and create a stable recovery/problem panel for save and index failures.
6. Add native search scope/limit, frontend debounce, one-pass folder counts, and remove the outline's permanent frame loop.
7. Add regular macOS build/test and Linux behavior jobs, not only release-time macOS and Linux packaging.

### Longer term — scale and reduce change coupling

1. Incrementally extract persistence, library, quit, and opened-file controllers from `App.tsx`, following the updater controller pattern and moving their current tests beside them.
2. Replace full dirty-index rebuilds with per-path updates, off-lock construction, immutable snapshot swaps, and measured reconciliation.
3. Build a staged signed-update harness covering valid update, invalid signature, install, relaunch, and state preservation on each supported target.
4. Add performance fixtures for thousands of notes and large link graphs, recording index duration, search latency, IPC bytes, startup time, and memory.
5. Decide and document ownership semantics for `<note>.assets`; if the “only files Margin created” promise remains, persist provenance without introducing a note database.
6. Consider curated/lazy syntax language loading only after measuring the current production bundle and startup profile.

## Existing strengths and important tradeoffs

- **Plain files remain authoritative.** Notes are UTF-8 Markdown with optional YAML front matter; no database or repository-local note store was introduced. This keeps interoperability excellent but means cross-file rename/move transactions must cooperate with external writers rather than assume exclusive ownership.
- **Conflict safety favors draft preservation.** Failed and conflicted saves keep drafts in memory and block clean quit. That is the right safety bias, at the cost of a more complex queue/alias state machine that now deserves its own controller.
- **Indexing keeps bodies native.** Search/backlink performance and privacy benefit from a process-owned index and small snapshot payload. The tradeoff is rebuilding cost and a coarse lock, which should evolve without moving note bodies back into React.
- **Watcher plus reconciliation is pragmatic.** Filesystem watchers are fast but imperfect, so a 45-second reconciliation is a good fallback. The next step is incremental dirty-path handling, not removal of reconciliation.
- **Relative links are portable but operationally expensive.** Repairing only unambiguous relative Markdown links is a sound rule. Extending it to moves must preserve that conservative behavior and abort on concurrent changes.
- **Image companion folders are transparent and portable.** Sibling assets avoid opaque storage and travel with notes. Automatic deletion is the dangerous edge; cleanup must be conservative and ownership must be explicit.
- **Preview security is appropriately restrictive.** No raw HTML, strict Mermaid mode, native external-link allowlisting, and a production CSP significantly reduce renderer risk. The broad asset scope is a compatibility concession that should be narrowed with platform evidence.
- **The dedicated capture bundle is a good product/performance boundary.** It preserves global capture responsiveness without loading the editor/preview stack. The duplication of template/shortcut display state is small, but the configured shortcut should be shared accurately.
- **The test suite is behavior-rich.** It catches difficult queue, quit, watcher, rollback, and now updater lifecycle cases rather than only snapshots. Its largest remaining blind spots are real filesystem semantics on supported platforms, cross-process/native integration, accessibility, and staged signed updates.

## Final release posture

After the three immediate data-integrity defects are fixed and platform/release validation is reconciled, Margin has a solid foundation for further product work. Until then, treat title renames on case-sensitive macOS volumes, automatic image cleanup, and concurrent multi-file link repair as release-blocking correctness risks. Treat installer authenticity and staged updater coverage as release-engineering blockers for claiming a uniformly signed installation/update experience across every documented path.
