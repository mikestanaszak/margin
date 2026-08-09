# Repository Guidelines

## Project Structure & Module Organization

This is a local-first Markdown notes desktop application built with Tauri 2, React, TypeScript, and Rust.

- `src/main.tsx` contains the React UI, state management, and calls to native commands; `src/styles.css` contains the application styles.
- `src-tauri/src/lib.rs` implements Tauri commands for reading, indexing, creating, saving, moving, and renaming Markdown notes. `src-tauri/src/main.rs` boots the native app.
- `src-tauri/tauri.conf.json` and `src-tauri/capabilities/` configure Tauri; `src-tauri/icons/` holds generated platform icons.
- `PRODUCT_SPEC.md` defines product behavior and the roadmap. Update it when a feature changes its documented scope.

Keep note-file behavior portable: libraries contain UTF-8 `.md` files with optional YAML front matter. Do not introduce a database or store user notes inside this repository.

## Build, Test, and Development Commands

Use Windows Command Prompt (`cmd.exe`) for every repository command. Open a regular Command Prompt for frontend work, or an **x64 Native Tools Command Prompt for VS 2022** when Cargo needs the MSVC linker. Use pnpm (the version is pinned by `.nvmrc`):

```cmd
pnpm install                         # install frontend and Tauri tooling
pnpm tauri dev                       # run Vite and the native desktop app
pnpm test                            # run unit tests, then Mermaid integration tests
pnpm test:unit                       # run unit tests without the real Mermaid renderer
pnpm test:integration                # run the dedicated Mermaid renderer integration suite
pnpm build                           # TypeScript type-check and build the web UI
pnpm tauri build --debug             # build a debug native executable
pnpm tauri build                     # create a production application bundle
cargo test --manifest-path src-tauri/Cargo.toml   # run Rust tests
cargo check --manifest-path src-tauri/Cargo.toml  # validate Rust backend code
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings  # lint Rust code
```

Run `cargo fmt --manifest-path src-tauri/Cargo.toml` after editing Rust, and use `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` to validate formatting. Build output belongs in the repository-root `target/` directory and is not committed.

## Coding Style & Naming Conventions

Follow the surrounding code: TypeScript uses double quotes, semicolons, `camelCase` functions and variables, and PascalCase React components/types. Keep frontend-native boundaries explicit with typed `invoke<T>("command_name", ...)` calls. Rust follows `rustfmt`, uses `snake_case`, and exposes native operations with `#[tauri::command]`. Prefer small, focused helpers and preserve clear user-facing error messages.

## Testing Guidelines

Before submitting changes, run `pnpm test`, `pnpm build`, `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo check --manifest-path src-tauri/Cargo.toml`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`. Run `pnpm test:integration` directly when changing Mermaid rendering. Then manually exercise the affected flow with `pnpm tauri dev` (especially note creation, autosave, search, and external-file changes). Add tests for observable behavior, such as `saves_front_matter_tags`.

## Commit & Pull Request Guidelines

Recent history uses concise, imperative, sentence-case subjects, for example `Fix external change detection races` and `Add Markdown syntax highlighting`. Keep commits focused and avoid generic messages. Pull requests should explain the user-visible change, link the relevant issue or spec section, list validation commands run, and include screenshots or a short recording for UI changes. Call out changes to note-file format, migrations, or platform packaging explicitly.

For every release, update `CHANGELOG.md` with the version, release date, and user-facing additions, changes, and fixes before creating the release tag.
