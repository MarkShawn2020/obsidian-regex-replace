# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is an Obsidian plugin that provides regex-based find/replace functionality in the editor. The plugin is written in TypeScript and uses Rollup for bundling.

## Build Commands
- `npm run dev` - Watch mode for development (rebuilds on file changes)
- `npm run build` - Production build (creates main.js in root)

## Architecture
Single-file architecture: All code lives in `src/main.ts` containing:
- `RegexFindReplacePlugin` - Main plugin class that registers the command
- `FindAndReplaceModal` - Modal dialog for find/replace UI
- `RegexFindReplaceSettingTab` - Settings tab in Obsidian preferences
- `RfrPluginSettings` interface - Plugin settings structure

Settings are persisted via Obsidian's `loadData()`/`saveData()` API and include:
- Find/replace text (retained between sessions)
- Toggle states: useRegEx, selOnly, caseInsensitive, processLineBreak, processTab, prefillFind

## Key Implementation Details
- The plugin operates on the active editor, either on full document or selection
- Regex mode uses RegExp with flags 'gm' (plus 'i' if case-insensitive enabled)
- Plain text mode uses string.split() + join() for replacement
- Logging controlled via `logThreshold` constant (0=errors only, 9=verbose)
- Modal UI built using Obsidian's component system (TextComponent, ToggleComponent, ButtonComponent)

## Plugin Distribution
Release artifacts (committed to repo root, not ignored):
- `main.js` - Bundled plugin code
- `manifest.json` - Plugin metadata (version must match package.json)
- `styles.css` - Modal styling
- `versions.json` - Version compatibility info

## Development Notes
- Obsidian API is treated as external dependency (not bundled)
- No test framework currently configured
- Desktop and mobile versions supported
