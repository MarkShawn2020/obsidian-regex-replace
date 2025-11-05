# Repository Guidelines

## Project Structure & Module Organization
Source lives under `src/`, with `src/main.ts` exporting the Obsidian plugin class and modal logic. Bundled output is written to `build/` (git-ignored) and shipped alongside `manifest.json` and `styles.css`. Static assets such as screenshots reside in `res/`. Configuration modules include `rollup.config.js` for bundling and `tsconfig.json` for compiler options; adjust these before touching generated artifacts in `versions.json`.

## Build, Test, and Development Commands
- `npm install` – install dependencies defined in `package.json`; rerun after updating Rollup or TypeScript plugins.
- `npm run dev` – start Rollup in watch mode, emitting incremental builds into `build/` for rapid local testing.
- `npm run build` – create a production bundle with minified output; run this before packaging a release.
Copy the resulting `build/main.js`, along with `manifest.json` and `styles.css`, into your Obsidian vault’s `.obsidian/plugins/obsidian-regex-replace/` folder to verify changes.

## Coding Style & Naming Conventions
The codebase is TypeScript-first. Follow the existing tab-based indentation and keep lines concise. Use PascalCase for exported classes (e.g., `RegexFindReplacePlugin`), camelCase for variables and functions, and SCREAMING_SNAKE_CASE only for constant objects like `DEFAULT_SETTINGS`. Prefer TypeScript `interface` definitions for structured data, and keep UI helpers localized to the modal to avoid polluting the plugin class.

## Testing Guidelines
Automated tests are not yet defined. Validate changes by installing the plugin into a sandbox vault and exercising find/replace scenarios: plain text, regex groups, selection-only mode, case-insensitive searches, and `\n`/`\t` replacement flags. Document any new manual test cases in the PR description so others can reproduce them.

## Commit & Pull Request Guidelines
Use clear, present-tense commit messages similar to the existing history (`Option for pre-fill find-text added`). Group related code, build artifacts, and documentation together; do not commit the compiled `build/` output unless preparing a tagged release. Pull requests should include: a short summary of the change, screenshots of UI updates (store them under `res/`), notes about manual testing in Obsidian, and references to related issues or community plugin submissions. Tag reviewers when touching shared settings or modal UX.

## Release & Configuration Tips
Before publishing, bump versions in `manifest.json`, `package.json`, and `versions.json` synchronously. Verify the plugin loads without console errors by running Obsidian with the developer console open (`Cmd+Opt+I`) and monitoring `RegexFiRe` log output for regressions.
