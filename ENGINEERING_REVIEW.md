# Margin engineering review

**Review date:** 2026-08-21

**Reviewed version:** 0.5.1 release candidate on `release/v0.5.1-integrity-hardening`

**Scope:** fresh static and behavioral review of the React/TypeScript application, Tauri/Rust backend, updater, tests, capabilities, packaging, installer scripts, release workflow, and product documentation. Notes remain ordinary UTF-8 Markdown files with optional YAML front matter; no database or repository-local note store was introduced.

## Release-candidate validation status

The completed local release gate covers the updater and every new integrity boundary:

- Frontend unit suite: **21/21 files and 183/183 tests passed**, including **19/19** updater-controller tests.
- Mermaid integration suite: **3/3 passed** with the real renderer.
- Production frontend build and bundle-boundary gate: **passed**, processing 2,618 modules; **1/1** bundle-boundary test passed. The existing main-chunk warning remains.
- Rust suite: **58/58 passed** after the final transaction regressions. `cargo check`, `cargo fmt -- --check`, and Clippy with warnings denied all passed.
- Focused release/checksum/security tests: **24/24 passed**. macOS and Linux Bash syntax checks passed; PowerShell selection logic is covered by the installer contract test.

The current native candidate compiled and launched successfully on Windows. Settings and a manual update check were exercised without modifying the selected personal note library; the check completed with the up-to-date state. A final independent diff re-review after the last blocker fixes found no Critical, Important, or Minor issues and assessed the candidate as ready to merge with the local gate green. GitHub pull-request and tagged release jobs remain mandatory before publication; local evidence is not treated as a substitute for those platform builds.

## Executive summary

Margin 0.5.1 is a substantially safer release candidate than 0.5.0. The three release-blocking data-integrity defects from the fresh review are fixed: case-variant rename destinations are checked by filesystem identity and committed without clobbering, companion-image cleanup preserves ambiguous Markdown references, and multi-file link repairs move live targets aside before validated no-clobber installation/restoration. Release packaging now produces a SHA-256 manifest, checks downloaded bytes and refreshed GitHub digests, validates every updater platform entry against the tagged release, and makes all three installer scripts verify their exact versioned download before modifying an installation.

No unresolved Critical finding remains in the reviewed release scope. The most important product correctness gap is now semantic rather than destructive: moving a note or renaming a folder can still break portable relative Markdown links. Other priorities are backend-owned managed-note classification, accurate post-save cleanup warnings, accessible shared dialog/menu primitives, incremental library indexing, and real signed-update installation coverage.

The updater controller is well isolated and tested. Automatic checks honor skipped versions and a one-day cadence, corrupt or future stored times are treated as stale, manual checks can reconsider a skipped release, accepted checks clear stale actions, overlapping checks/installs are guarded, and installation never restarts Margin automatically. Restart is offered only after successful installation.

## Resolved release blockers

### Case-variant rename identity

`path_for_title` now routes case-only selection through a testable platform-behavior helper. If a case-variant destination already exists, canonical source and destination paths must identify the same filesystem entry before Margin permits the intermediate case-hop. A distinct `Foo.md`/`foo.md` destination instead uses the normal unique-name path, and filesystem lookup errors or dangling entries are no longer treated as absence. At mutation time the case-hop uses a no-clobber transfer from the temporary source. A same-volume hard link provides the atomic fast path; filesystems without hard-link support fall back to atomically reserving the destination with `create_new`, copying and syncing the bytes, then removing the source. A destination created after selection is preserved; Margin restores the source or reports the retained recovery path when a case-insensitive namespace cannot hold both spellings. Tests exercise the distinct-entry, true case-only, late-destination, and forced hard-link-unavailable outcomes (`src-tauri/src/paths.rs`, `src-tauri/src/notes.rs`).

This closes the prior overwrite path on case-sensitive macOS volumes. A regular macOS behavioral CI job is still recommended because the Windows release environment cannot reproduce every APFS semantic.

### Encoded companion-image cleanup

Asset cleanup no longer uses raw Markdown substring matching. It consumes the shared visible-link scanner, independently verifies that an inline destination ends at the balanced closing parenthesis, removes query/fragment suffixes, decodes percent escapes exactly once without translating `+`, accepts only safe direct paths inside the exact companion folder, and compares canonical file paths. Encoded spaces, Unicode, encoded folder markers, angle-bracket destinations, query/fragment suffixes, and literal percent names are covered. Balanced/escaped parentheses, optional titles, reference-style images, traversal, or an unterminated potentially local target cause cleanup to preserve the folder whenever the exact reference cannot be derived safely. Malformed percent encoding in any relative destination is now ambiguous even when the folder marker itself is encoded; both inline and reference-definition regressions cover that deletion path (`src-tauri/src/assets.rs`).

This deliberately favors retention over deletion. The companion folder remains app-managed; Margin does not persist per-file provenance.

### Concurrent staged link repair

Every planned rewrite records its original and replacement bytes. Staging rejects a target that changed after planning and writes the validated bytes to its recovery backup. Applying a staged rewrite atomically moves the live target to a unique same-folder path first, validates those moved bytes, and installs the replacement only through the no-clobber transfer. An external target created after the move is never replaced; the external file remains at the requested path while the original and backup locations are reported. Rollback uses the same pattern in reverse: it moves current content aside before restoring, calls no-clobber restoration, discards the moved copy only when it exactly matches Margin's committed bytes, and retains and reports unexpected content. Hooks immediately after the apply move and immediately before rollback restore exercise both former check-then-overwrite windows (`src-tauri/src/notes.rs`).

The ordinary active-note save remains a filesystem check-then-replace operation, not a filesystem-level compare-and-swap. Its revision includes content and modification time, and the new transaction validation materially narrows the multi-file risk, but stress testing external writers is still worthwhile.

### Release and installer integrity

The release workflow downloads the complete draft, creates byte-order deterministic `SHA256SUMS`, uploads it, refreshes release metadata, and then validates the draft. The validator requires Windows NSIS/MSI, macOS DMG/app archive, Linux DEB/AppImage, updater signatures, `latest.json`, every expected Tauri platform alias, nonempty updater signatures, and exact GitHub asset API URLs from that tagged release. It recomputes each package hash from the downloaded bytes, compares it with `SHA256SUMS`, and compares refreshed GitHub digests for the packages and uploaded checksum manifest (`scripts/release-checksums.mjs`, `scripts/verify-release-assets.mjs`, `.github/workflows/release.yml`).

The PowerShell, macOS, and Linux installer scripts derive the one exact artifact name from the release's `tag_name`, reject missing or duplicate exact assets even when suffix-matching decoys exist, download `SHA256SUMS`, require one safe matching entry, compute SHA-256 locally, and abort before replacing or stopping Margin if verification fails. In-app artifacts remain signed with the configured Tauri updater key. Manual Windows packages are not Authenticode-signed, and macOS remains ad-hoc signed rather than Developer ID-signed/notarized. Documentation states that limitation explicitly; checksums provide download integrity, not operating-system publisher identity.

## Prioritized findings

| Severity | Finding | Impact and evidence | Recommendation |
|---|---|---|---|
| **High** | Note moves and folder renames do not repair relative Markdown links. | Title-derived filename changes use staged link repair, while note moves and folder renames primarily move filesystem entries. Incoming and boundary-crossing outgoing links can become stale, so navigation/backlinks disappear after supported organization actions. | Reuse the revalidated transaction for note moves. For folder renames, compute old/new IDs for every affected note and rewrite only links whose resolution is unambiguous. Add mixed incoming/outgoing fixture tests first. |
| **Medium** | Managed/external note classification is still partly decided in JavaScript with unconditional lowercasing. | On case-sensitive systems, sibling paths that differ only by case can be presented as managed even though Rust correctly rejects the save. Draft recovery prevents silent loss, but the UI promise is wrong. | Return canonical ownership/relative note identity from Rust and remove filesystem-containment decisions from React. |
| **Medium** | A post-commit asset-cleanup failure is reported like a text-save failure. | The note can already be committed before cleanup returns an error. Retrying the retained draft can then encounter a stale revision and show a confusing conflict. | Model `saved with cleanup warning` separately, advance the saved revision immediately, and retry cleanup independently. |
| **Medium** | Whole-library rebuilds still occur synchronously under one index mutex. | Watcher dirtiness and reconciliation can reread/relink an entire large library after ordinary edits, creating command stalls and disk/battery churn. | Maintain per-path index records, build replacements off-lock, atomically swap snapshots, and retain periodic full reconciliation as recovery. Instrument first. |
| **Medium** | Search and Quick Open overfetch. | Empty Quick Open can sort/serialize the library even though the UI keeps ten results; rapid queries still do native work that the client later discards. | Pass scope and limit to Rust, apply them before serialization, and consider a short nonempty-query debounce after profiling. |
| **Medium** | Signed native update installation/relaunch is not exercised end to end. | Controller and React tests mock updater/process dependencies. Package replacement, invalid-signature rejection, and relaunch can still fail only on a real staged release. | Maintain a signed staged fixture and test valid install, invalid signature, explicit restart, and persisted library state on each supported updater target. |
| **Medium** | Shared dialog and menu accessibility is incomplete. | Several overlays do not consistently trap/restore focus or make the background inert. The custom ARIA menu lacks a complete roving-focus/arrow-key model. | Introduce one labelled dialog primitive and either implement the full menu keyboard contract or use ordinary button semantics. Add keyboard and automated accessibility coverage. |
| **Medium** | `App.tsx` remains the main orchestration/race surface. | Persistence queues, library lifecycle, opened-file routing, capture fallback, quit coordination, mutations, and most dialogs remain coupled in one component and one large interaction suite. | Extract `useNotePersistence`, `useLibraryIndex`, `useQuitCoordinator`, and `useOpenedMarkdown` incrementally, following the updater controller pattern. |
| **Low** | The outline reconciles scroll positions on a permanent animation-frame loop while open. | Static reading can consume avoidable CPU/battery. | Make synchronization event-driven and use short-lived frames only after layout/programmatic scroll changes. |
| **Low** | Static asset protocol scope remains broad. | `$HOME/**` is allowed even though selected-library and external-note directories are granted dynamically. This widens the impact of a future renderer compromise. | Validate a minimal dynamic-only scope on each platform, then narrow the static scope if image startup remains reliable. |
| **Low** | Manual packages lack OS publisher identity. | Checksums now verify the downloaded bytes and trust wording is accurate, but Windows SmartScreen/macOS Gatekeeper cannot establish a named publisher from the current packages. | Add Authenticode and Apple Developer ID/notarization when credentials and release operations are available; keep it separate from the Tauri updater key. |

## Architecture and data flow

The typed native service, feature directories, note-session reducer, dedicated capture bundle, and updater controller are healthy boundaries. The native library index keeps note bodies out of ordinary React snapshot payloads, which is good for privacy and IPC size. Save queues own immutable drafts and path aliases, conflict results preserve both versions, and quit coordination waits for managed saves rather than discarding work.

`App.tsx` remains the principal change-coupling risk. Individual refs and callbacks are defensible, but together they form an implicit state machine spanning library generation, active note, recovery drafts, capture, external-file polling, quit, and dialogs. Extraction should be behavior-preserving and test-led; a broad UI rewrite would increase risk.

Plain files remain authoritative. That interoperability is a core product strength and the reason every cross-file mutation must cooperate with external writers. The new staged revalidation establishes the right transaction pattern for upcoming move/folder link repair.

## Performance

Existing work is effective: large flat lists virtualize, preview rendering is memoized/deferred, Mermaid loads lazily, the capture window has a separate entry bundle, and searchable bodies stay native. The production build still reports a roughly 1.7 MB main JavaScript chunk, driven partly by syntax-highlighting and editor/preview dependencies. Startup and parse costs have not been measured, so language-set reduction or further lazy loading should follow profiling rather than bundle size alone.

The larger risk is native index invalidation. Current tests cover ranking, warnings, backlinks, watcher reconciliation, a long-note outline budget, and the virtualization threshold, but do not measure thousands of notes, watcher bursts, IPC bytes, memory, or time-to-interactive.

## Security and privacy

The production posture is thoughtful: no telemetry/cloud dependency in application code, strict production CSP, development allowances separated, no raw HTML rendering, strict Mermaid mode, native external-URL allowlisting, window-specific plugin permissions, canonical library containment, and in-library symlink rejection. GitHub Actions are commit-pinned and dependency audits run in CI.

Distribution trust is now described in layers:

- in-app update packages are signed by the Tauri updater key and checked by the updater;
- the release draft must satisfy the full asset/platform/signature/checksum contract;
- manual scripts verify SHA-256 before installation;
- Windows Authenticode and Apple Developer ID/notarization are not currently provided.

That is an accurate posture. Publishing `SHA256SUMS` in the same GitHub release protects against corruption and unintended substitution within the GitHub release channel; it does not replace publisher signing if the repository/release channel itself is compromised.

## UX and accessibility

The product model is coherent: preview-first reading, ranked Search/Quick Open, real folders, explicit conflicts, recoverable drafts, keyboard-resizable panes, a shared capture composer, and update states that distinguish checking, downloading, installed, and restarting. Update errors use alerts, progress uses polite status, and Settings feedback is live.

The largest accessibility need is a shared modal layer. Focus trapping/restoration, inert background behavior, Escape policy, accessible naming, and menu keyboard behavior should be solved centrally instead of surface by surface. Index warnings also expose only a count; users need paths/reasons and a stable problems/recovery surface.

## Cross-platform and release engineering

The documented matrix is Windows x64, Apple Silicon macOS, and Linux x64 DEB/AppImage. Windows behavior receives the strongest CI coverage; Linux packages are regularly built, but Linux behavioral testing and regular macOS build/test jobs remain gaps. The release workflow is still the first macOS package gate.

Opening a Markdown file while Margin is already running can also differ by platform because subsequent open-event routing is implemented most completely on macOS and no single-instance plugin is configured. Windows/Linux existing-instance routing deserves an integration test before strengthening file-association claims.

Release verification is now much stronger but still validates artifacts rather than launching them. The draft must remain unpublished if any package, platform alias, signature, tagged URL, or checksum is wrong. Package launch smoke tests and signed staged-update tests remain the next step.

## Test coverage assessment

Strong coverage exists for real temporary-library workflows, containment and symlink rejection, portable filenames, stale revisions, companion assets, link scanning/repair/rollback, native search/ranking/backlinks, watcher reconciliation, note-session phases, queued saves, recovery drafts, quit ordering, capture races, editor commands, view preservation, updater lifecycle, Mermaid integration, and bundle boundaries.

Important remaining gaps:

1. note-move/folder-rename relative-link preservation;
2. post-commit cleanup warnings as a distinct save result;
3. real Tauri event/listener and quit/window integration;
4. focus trapping, menu keyboard behavior, background inertness, and contrast;
5. multi-thousand-note index/search/startup/memory measurements;
6. Windows/Linux existing-instance file-open routing;
7. regular macOS and Linux behavioral jobs;
8. signed staged-update install, invalid-signature rejection, and relaunch.

## Implementation agenda

### Next

1. Repair relative links during note moves and folder renames using the revalidated transaction.
2. Split committed note saves from asset-cleanup warnings.
3. Move managed/external ownership classification into Rust.
4. Add shared accessible dialog/menu primitives.
5. Add regular macOS build/test and Linux behavior jobs, plus existing-instance file-open coverage.

### After measurement

1. Incrementalize the native index and reduce lock scope.
2. Add native search scope/limit and frontend debounce.
3. Remove the outline's permanent animation-frame loop.
4. Profile startup/main-bundle parsing before curating or lazily loading syntax languages.
5. Build a signed staged-update harness and package launch smoke tests.

## Release posture

The three previously release-blocking data-integrity defects are resolved with focused regressions, the manual download path now has enforced checksum integrity with accurate trust documentation, the full local matrix is green, and final independent review found no remaining issue. Margin 0.5.1 is suitable to advance through pull-request checks, the tag build, and draft-asset verification.

Do not publish the draft if any aggregate test, package job, updater-platform check, signature check, tagged asset URL check, or checksum check fails. Publication does not imply Windows Authenticode or Apple Developer ID/notarization; those remain explicitly documented release limitations.
