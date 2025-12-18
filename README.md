<p align="center">
  <img src="docs/images/cover.png" alt="Regex Find/Replace Cover" width="100%">
</p>

<h1 align="center">
  <img src="assets/logo.svg" width="32" height="32" alt="Logo" align="top">
  Regex Find/Replace
</h1>

<p align="center">
  <strong>Powerful text find and replace for Obsidian with regex support</strong><br>
  <sub>Desktop & Mobile</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/Gru80/obsidian-regex-replace" alt="release">
  <img src="https://img.shields.io/github/downloads/Gru80/obsidian-regex-replace/total.svg" alt="downloads">
</p>

---

## Features

- **Regex & Plain Text** - Use regular expressions or simple text matching
- **Live Preview** - See matches and replacements before applying
- **Selection Scope** - Replace in selection or entire document
- **Pattern History** - Auto-saves patterns with pin support
- **Interactive Flags** - Toggle `g`, `m`, `i` flags directly in the UI
- **Escape Sequences** - Process `\n` and `\t` in find/replace fields
- **Markdown Fixer** - Auto-fix common Markdown formatting issues

<p align="center">
  <img src="res/dialog.png" alt="Regex Find/Replace Dialog" width="80%">
</p>

## Installation

### Community Plugins (Recommended)

1. Open Obsidian Settings → Community Plugins
2. Disable Safe Mode
3. Search for "Regex Find/Replace"
4. Install and enable

### Manual

1. Create `.obsidian/plugins/obsidian-regex-replace/`
2. Download from [releases](https://github.com/Gru80/obsidian-regex-replace/releases):
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. Enable in Community Plugins

## Usage

1. Open command palette (`Cmd/Ctrl + P`)
2. Run `Regex Find/Replace: Find and Replace using regular expressions`
3. Enter find/replace patterns
4. Click "Replace All"

**Tip:** Assign a keyboard shortcut for quick access.

## Settings

| Setting | Description |
|---------|-------------|
| Case Insensitive | Enable `/i` flag |
| Multiline Mode | Enable `/m` flag (^ and $ match line boundaries) |
| Process `\n` | Treat `\n` as line break |
| Process `\t` | Treat `\t` as tab |
| Prefill Find | Auto-fill find field with selected text |
| Show Preview | Display live match preview |
| Confirm Large Replace | Prompt before replacing many matches |

## License

MIT
