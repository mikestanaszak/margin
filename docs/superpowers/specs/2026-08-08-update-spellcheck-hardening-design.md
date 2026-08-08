# Update and spell-check hardening design

## Scope

This work completes the existing native update experience and makes edit-only
spell checking a regression-tested behavior. The published `main` branch
already contains a conflict-free product roadmap, so no public roadmap repair
is required. The unresolved conflict in the user's detached checkout is
intentionally left untouched.

## Update behavior

Margin already checks for updates once per day and exposes a manual Settings
check. An available update is never downloaded automatically: the user opens
the update dialog and chooses **Update now**. That behavior remains unchanged.

After `downloadAndInstall()` succeeds, Margin already presents an explicit
**Restart Margin** action backed by Tauri's supported process relaunch
capability. It will never restart the app without a user click. This work
hardens that existing action: it records the restarting state and catches a
relaunch failure so the dialog stays open, shows a useful error, and preserves
the discovered update.

The update state transitions are:

`idle -> checking -> available -> downloading -> ready -> restarting`

The user can also close the dialog or skip a version from `available` without
altering the existing daily-check schedule.

## Release validation

The release workflow will retain its three bundle jobs: Windows, Apple Silicon
macOS, and x64 Linux. A final release-validation job will run after all three
complete, inspect the draft release for the tagged version, and require:

- a Windows installer (`.exe` or `.msi`) and its signature;
- an Apple Silicon `.dmg` and its updater archive/signature;
- Linux `.deb` and AppImage packages and signatures; and
- a `latest.json` updater manifest whose version matches the tag.

The release stays a draft until those checks pass. Publishing remains the
deliberate release step after validation; no workflow change will auto-publish
a failed or incomplete release.

## Workflow audit

Before changing a workflow, inventory every file in `.github/workflows` and
review its trigger, permissions, recent run history, runtime, and unique
coverage. The audit will classify each workflow or job as **keep**,
**consolidate**, or **remove**, with a short recorded reason.

A workflow is kept only when it supplies distinct value: pull-request quality
gates, a supported-platform package check, release artifact production,
security scanning, or a deliberate manual recovery path. Redundant jobs and
stale triggers will be removed or consolidated, but the following safeguards
must remain:

- a required PR validation path for frontend tests, Rust checks, and a Linux
  package build;
- a tag-triggered three-platform release path; and
- a manual workflow-dispatch route for recovery when automatic triggers or
  hosted runners are unavailable.

The audit findings will be added to the pull request description. Any workflow
edits will preserve least-privilege permissions and avoid expanding the set of
third-party actions without a documented reason.

## Spell check

Margin's CodeMirror Markdown editor already sets the standard native
`spellcheck="true"` content attribute. This work makes that existing behavior
a regression-tested boundary:

- spelling assistance is enabled in editable Markdown notes;
- Preview remains a rendered, non-editable surface and does not create an
  editor; and
- no custom dictionary, network service, or settings switch is introduced.

Spell-check language and dictionaries continue to be provided by the platform
webview, so the behavior remains local and follows each operating system's
configured language preferences.

## Tests and validation

- Add a focused editor test that verifies the editable CodeMirror DOM has
  native spell checking enabled.
- Add update-flow tests for successful install, explicit relaunch, and the
  failure states. Plugin calls are mocked only at the Tauri boundary.
- Add a release-validation script with fixture-based tests for missing assets,
  signatures, and version mismatches; invoke it from the release workflow.
- Audit all GitHub workflows and validate any retained or consolidated path
  with its relevant local checks and a workflow syntax review.
- Run the existing frontend, Rust, formatting, and package validations, then
  manually exercise the update dialog and spell check in the native desktop
  app. The release workflow remains the final cross-platform packaging gate.

## Non-goals

- No automatic update downloads, installations, or restarts.
- No changes to the selected-library Markdown data model.
- No attempt to repair or commit the user's detached checkout conflict.
- No custom spell checker, cloud spelling service, or dictionary management UI.
