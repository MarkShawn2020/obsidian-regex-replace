# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Obsidian plugin for regex-based find/replace in the editor. TypeScript + Rollup bundling.

## Build Commands
- `npm run dev` - Watch mode (rebuilds on changes)
- `npm run build` - Production build (outputs main.js to root)

## Architecture
Single-file: all code in `src/main.ts`:
- `RegexFindReplacePlugin` - Main plugin, registers commands, manages pattern history
- `FindAndReplaceModal` - Two-column modal with live preview
- `RegexFindReplaceSettingTab` - Plugin settings UI
- `generateMatchPreviews()` - Generates preview diffs with line context
- `fixMarkdownFormatting()` - Markdown formatting fixer (headings, lists, trailing whitespace)

Two commands registered:
1. `obsidian-regex-replace` - Main find/replace modal
2. `markdown-fix-formatting` - Auto-fix common Markdown issues

## Key Implementation Details
- `__VERSION__` replaced at build time via rollup-plugin-replace (from package.json)
- Regex flags: 'g' always, 'm' for multiline, 'i' for case-insensitive (clickable in UI)
- Pattern history: auto-saved on successful replace, supports pinning, configurable max size
- Preview: shows line-by-line diff with highlighted changes, "show more" pagination
- Plain text mode: string.split()+join() for replacement
- Logging: `logThreshold` constant (0=errors, 9=verbose)

## Settings (RfrPluginSettings)
Core: findText, replaceText, useRegEx, selOnly, caseInsensitive, multilineMatch
Escape handling: processLineBreak (`\n`), processTab (`\t`)
UX: prefillFind, showPreview, previewLimit, confirmLargeReplace, largeReplaceThreshold
History: savedPatterns (RegexPattern[]), maxHistorySize

## Release Artifacts (committed to root)
- `main.js` - Bundled code
- `manifest.json` - Version must match package.json
- `styles.css` - Modal CSS
- `versions.json` - Maps plugin version to min Obsidian version
