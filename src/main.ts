import {
	App,
	ButtonComponent,
	DropdownComponent,
	Editor,
	Modal,
	Notice,
	Plugin,
	TextComponent,
	ToggleComponent,
	PluginSettingTab,
	Setting
} from 'obsidian';

interface RegexPattern {
	id: string;
	name: string;
	findText: string;
	replaceText: string;
	useRegEx: boolean;
	caseInsensitive: boolean;
	isPinned: boolean;
	lastUsed: number;
	useCount: number;
}

interface RfrPluginSettings {
	findText: string;
	replaceText: string;
	useRegEx: boolean;
	selOnly: boolean;
	caseInsensitive: boolean;
	multilineMatch: boolean;
	processLineBreak: boolean;
	processTab: boolean;
	prefillFind: boolean;
	savedPatterns: RegexPattern[];
	maxHistorySize: number;
	showPreview: boolean;
	previewLimit: number;
	confirmLargeReplace: boolean;
	largeReplaceThreshold: number;
}

const DEFAULT_SETTINGS: RfrPluginSettings = {
	findText: '',
	replaceText: '',
	useRegEx: true,
	selOnly: false,
	caseInsensitive: true,
	multilineMatch: true,
	processLineBreak: false,
	processTab: false,
	prefillFind: false,
	savedPatterns: [],
	maxHistorySize: 10,
	showPreview: true,
	previewLimit: 5,
	confirmLargeReplace: true,
	largeReplaceThreshold: 20
}

// logThreshold: 0 ... only error messages
//               9 ... verbose output
const logThreshold = 9;
const logger = (logString: string, logLevel=0): void => {if (logLevel <= logThreshold) console.log ('RegexFiRe: ' + logString)};

type FixStat = { key: string; count: number };

interface MatchPreview {
	lineNumber: number;
	lineContent: string;
	matchedText: string;
	replacementText: string;
	matchIndex: number;
	lineAfterReplace: string;
	matchStartInLine: number;
	matchEndInLine: number;
	isMultiLine: boolean;
}

const generateMatchPreviews = (
	text: string,
	searchString: string,
	replaceString: string,
	useRegEx: boolean,
	caseInsensitive: boolean,
	multilineMatch: boolean,
	limit: number
): { previews: MatchPreview[], totalCount: number } => {
	const previews: MatchPreview[] = [];
	const lines = text.split('\n');
	let totalCount = 0;
	let matchIndex = 0;

	if (useRegEx) {
		let regexFlags = 'g';
		if (multilineMatch) regexFlags += 'm';
		if (caseInsensitive) regexFlags += 'i';
		try {
			const searchRegex = new RegExp(searchString, regexFlags);
			const allMatches = text.match(searchRegex);
			totalCount = allMatches ? allMatches.length : 0;

			for (let i = 0; i < lines.length && previews.length < limit; i++) {
				const line = lines[i];
				const lineRegex = new RegExp(searchString, caseInsensitive ? 'gi' : 'g');
				let match;

				while ((match = lineRegex.exec(line)) !== null) {
					if (previews.length >= limit) break;

					// Calculate the replacement for this specific match
					// Manually handle replacement string special patterns
					let replacementText = replaceString;

					// First, protect $$ by replacing with a placeholder
					const dollarPlaceholder = '\x00DOLLAR\x00';
					replacementText = replacementText.replace(/\$\$/g, dollarPlaceholder);

					// Get match position for $` and $'
					const matchStart = match.index !== undefined ? match.index : 0;
					const matchEnd = matchStart + match[0].length;

					// Replace $` with text before match
					const beforeMatch = line.substring(0, matchStart);
					replacementText = replacementText.replace(/\$`/g, beforeMatch);

					// Replace $' with text after match
					const afterMatch = line.substring(matchEnd);
					replacementText = replacementText.replace(/\$'/g, afterMatch);

					// Replace $& with the entire match
					replacementText = replacementText.replace(/\$&/g, match[0]);

					// Replace $n with capture groups (in reverse order to avoid conflicts like $1 and $10)
					for (let n = match.length - 1; n >= 1; n--) {
						const groupValue = match[n] !== undefined ? match[n] : '';
						replacementText = replacementText.replace(new RegExp('\\$' + n, 'g'), groupValue);
					}

					// Finally, restore $$ to literal $
					replacementText = replacementText.replace(new RegExp(dollarPlaceholder, 'g'), '$');

					// Calculate the full line after replacement
					const lineAfterReplace = line.substring(0, matchStart) + replacementText + line.substring(matchEnd);

					// Check if match contains newlines
					const isMultiLine = match[0].includes('\n');

					previews.push({
						lineNumber: i + 1,
						lineContent: line,
						matchedText: match[0],
						replacementText: replacementText,
						matchIndex: matchIndex++,
						lineAfterReplace: lineAfterReplace,
						matchStartInLine: matchStart,
						matchEndInLine: matchEnd,
						isMultiLine: isMultiLine
					});
					if (!lineRegex.global) break;
				}
			}
		} catch (e) {
			logger('Invalid regex pattern: ' + e, 0);
			return { previews: [], totalCount: 0 };
		}
	} else {
		const occurrences = text.split(searchString).length - 1;
		totalCount = occurrences;

		for (let i = 0; i < lines.length && previews.length < limit; i++) {
			const line = lines[i];
			const matchStart = line.indexOf(searchString);
			if (matchStart !== -1) {
				const matchEnd = matchStart + searchString.length;
				const lineAfterReplace = line.split(searchString).join(replaceString);
				const isMultiLine = searchString.includes('\n');

				previews.push({
					lineNumber: i + 1,
					lineContent: line,
					matchedText: searchString,
					replacementText: replaceString,
					matchIndex: matchIndex++,
					lineAfterReplace: lineAfterReplace,
					matchStartInLine: matchStart,
					matchEndInLine: matchEnd,
					isMultiLine: isMultiLine
				});
			}
		}
	}

	return { previews, totalCount };
};

const fixMarkdownFormatting = (text: string): { text: string; stats: FixStat[] } => {
	let stats: FixStat[] = [];
	const inc = (key: string, by = 1) => {
		const s = stats.find(x => x.key === key);
		if (s) s.count += by; else stats.push({ key, count: by });
	};

	const lines = text.split('\n');
	let inFence = false;
	let fenceMarker = '';
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		const fenceMatch = line.match(/^\s*(```+|~~~+)/);
		if (fenceMatch) {
			const marker = fenceMatch[1].startsWith('`') ? '```' : '~~~';
			if (!inFence) { inFence = true; fenceMarker = marker; }
			else if (marker === fenceMarker) { inFence = false; fenceMarker = ''; }
			lines[i] = line;
			continue;
		}
		if (inFence) { continue; }

		let updated = line;

		const dupHead = updated.replace(/^(\s{0,3})(#{1,6})\s+#{1,6}\s+(.+)$/, (_m, p1, p2, p3) => {
			inc('heading_duplicate_hashes');
			return `${p1}${p2} ${String(p3).trim()}`;
		});
		updated = dupHead;

		const capHead = updated.replace(/^(\s*)(#{7,})\s+(\S.*)$/, (_m, p1, _p2, p3) => {
			inc('heading_cap_to_h6');
			return `${p1}###### ${p3}`;
		});
		updated = capHead;

		const normHead = updated.replace(/^(\s{0,3})(#{1,6})[ \t]*(\S.*)$/, (m, p1, p2, p3) => {
			const desired = `${p1}${p2} ${p3}`;
			if (m !== desired) inc('heading_space_normalize');
			return desired;
		});
		updated = normHead;

		const listBullet = updated.replace(/^(\s*)([-+*])[ \t]*(\S)/, (m, p1, p2, p3) => {
			const desired = `${p1}${p2} ${p3}`;
			if (m !== desired) inc('list_bullet_space');
			return desired;
		});
		updated = listBullet;

		const listOrdered = updated.replace(/^(\s*)(\d+\.)[ \t]*(\S)/, (m, p1, p2, p3) => {
			const desired = `${p1}${p2} ${p3}`;
			if (m !== desired) inc('list_ordered_space');
			return desired;
		});
		updated = listOrdered;

		if (updated !== line) {
			lines[i] = updated;
		}
	}

	let trailingFixes = 0;
	let inFence2 = false;
	let fenceMarker2 = '';
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fenceMatch2 = line.match(/^\s*(```+|~~~+)/);
		if (fenceMatch2) {
			const marker = fenceMatch2[1].startsWith('`') ? '```' : '~~~';
			if (!inFence2) { inFence2 = true; fenceMarker2 = marker; }
			else if (marker === fenceMarker2) { inFence2 = false; fenceMarker2 = ''; }
		}
		if (inFence2) { continue; }
		if (line.endsWith('  ') && !line.endsWith('   ')) { continue; }
		const trimmed = line.replace(/[ \t]+$/, '');
		if (trimmed !== line) {
			lines[i] = trimmed;
			trailingFixes++;
		}
	}
	if (trailingFixes > 0) inc('trim_trailing_whitespace', trailingFixes);

	return { text: lines.join('\n'), stats };
};

export default class RegexFindReplacePlugin extends Plugin {
	settings: RfrPluginSettings;

	generatePatternName(findText: string): string {
		const maxLen = 30;
		if (findText.length <= maxLen) return findText;
		return findText.substring(0, maxLen) + '...';
	}

	savePattern(findText: string, replaceText: string, useRegEx: boolean, caseInsensitive: boolean): void {
		const now = Date.now();
		const existingIndex = this.settings.savedPatterns.findIndex(
			p => p.findText === findText &&
			     p.replaceText === replaceText &&
			     p.useRegEx === useRegEx &&
			     p.caseInsensitive === caseInsensitive
		);

		if (existingIndex !== -1) {
			const pattern = this.settings.savedPatterns[existingIndex];
			pattern.lastUsed = now;
			pattern.useCount++;
			this.settings.savedPatterns.splice(existingIndex, 1);
			this.settings.savedPatterns.unshift(pattern);
		} else {
			const newPattern: RegexPattern = {
				id: `${now}-${Math.random().toString(36).substr(2, 9)}`,
				name: this.generatePatternName(findText),
				findText,
				replaceText,
				useRegEx,
				caseInsensitive,
				isPinned: false,
				lastUsed: now,
				useCount: 1
			};
			this.settings.savedPatterns.unshift(newPattern);
			this.pruneHistory();
		}
		this.saveSettings();
	}

	pruneHistory(): void {
		const pinned = this.settings.savedPatterns.filter(p => p.isPinned);
		const unpinned = this.settings.savedPatterns.filter(p => !p.isPinned);

		if (unpinned.length > this.settings.maxHistorySize) {
			unpinned.sort((a, b) => b.lastUsed - a.lastUsed);
			this.settings.savedPatterns = [...pinned, ...unpinned.slice(0, this.settings.maxHistorySize)];
		}
	}

	deletePattern(patternId: string): void {
		this.settings.savedPatterns = this.settings.savedPatterns.filter(p => p.id !== patternId);
		this.saveSettings();
	}

	togglePinPattern(patternId: string): void {
		const pattern = this.settings.savedPatterns.find(p => p.id === patternId);
		if (pattern) {
			pattern.isPinned = !pattern.isPinned;
			this.saveSettings();
		}
	}

	async onload() {
		logger('Loading Plugin...', 9);
		await this.loadSettings();

		this.addSettingTab(new RegexFindReplaceSettingTab(this.app, this));


		this.addCommand({
			id: 'obsidian-regex-replace',
			name: 'Find and Replace using regular expressions',
			editorCallback: (editor) => {
				new FindAndReplaceModal(this.app, editor, this.settings, this).open();
			},
		});

		this.addCommand({
			id: 'markdown-fix-formatting',
			name: 'Markdown: Check and Fix formatting',
			editorCallback: (editor) => {
				const doc = editor.getValue();
				const { text, stats } = fixMarkdownFormatting(doc);
				if (text !== doc) {
					editor.setValue(text);
					const msg = stats
						.filter(s => s.count > 0)
						.map(s => {
							if (s.key === 'heading_duplicate_hashes') return `重复标题井号修复 ${s.count}`;
							if (s.key === 'heading_cap_to_h6') return `标题级别超过 H6 规范化 ${s.count}`;
							if (s.key === 'heading_space_normalize') return `标题空格规范化 ${s.count}`;
							if (s.key === 'list_bullet_space') return `无序列表空格修复 ${s.count}`;
							if (s.key === 'list_ordered_space') return `有序列表空格修复 ${s.count}`;
							if (s.key === 'trim_trailing_whitespace') return `行尾空白移除 ${s.count}`;
							return `${s.key} ${s.count}`;
						})
						.join(' · ');
					new Notice(msg || 'Markdown formatting fixes applied');
				} else {
					new Notice('未发现需要修复的 Markdown 格式问题');
				}
			}
		});
	}

	onunload() {
		logger('Bye!', 9);
	}

	async loadSettings() {
		logger('Loading Settings...', 6);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		logger('   findVal:         ' + this.settings.findText, 6);
		logger('   replaceText:     ' + this.settings.replaceText, 6);
		logger('   caseInsensitive: ' + this.settings.caseInsensitive, 6);
		logger('   multilineMatch:  ' + this.settings.multilineMatch, 6);
		logger('   processLineBreak: ' + this.settings.processLineBreak, 6);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

}

class FindAndReplaceModal extends Modal {
	constructor(app: App, editor: Editor, settings: RfrPluginSettings, plugin: Plugin) {
		super(app);
		this.editor = editor;
		this.settings = settings;
		this.plugin = plugin;
	}

	settings: RfrPluginSettings;
	editor: Editor;
	plugin: Plugin;

	onOpen() {
		const { contentEl, titleEl, editor, modalEl } = this;

		modalEl.addClass('find-replace-modal');
		modalEl.style.width = '90vw';
		modalEl.style.maxWidth = '1200px';
		// @ts-ignore - __VERSION__ is replaced by rollup at build time
		titleEl.setText('Regex Find/Replace v' + __VERSION__);

		const rowClass = 'row';
		const divClass = 'div';
		const noSelection = editor.getSelection() === '';
		const buildRegexFlags = () => {
			let flags = 'g';
			if (this.settings.multilineMatch) flags += 'm';
			if (this.settings.caseInsensitive) flags += 'i';
			return flags;
		};
		let regexFlags = buildRegexFlags();

		logger('No text selected?: ' + noSelection, 9);

		let findInputComponent: TextComponent;
		let replaceWithInputComponent: TextComponent;
		let regToggleComponent: ToggleComponent;

		// Create two-column layout
		const mainContainer = document.createElement(divClass);
		mainContainer.style.display = 'flex';
		mainContainer.style.gap = '1.5em';
		mainContainer.style.alignItems = 'flex-start';

		const leftColumn = document.createElement(divClass);
		leftColumn.style.flex = '0 0 400px';
		leftColumn.style.minWidth = '350px';

		const rightColumn = document.createElement(divClass);
		rightColumn.style.flex = '1';
		rightColumn.style.minWidth = '300px';

		mainContainer.appendChild(leftColumn);
		mainContainer.appendChild(rightColumn);
		contentEl.appendChild(mainContainer);

		const addTextComponent = (label: string, placeholder: string, postfix=''): [TextComponent, HTMLDivElement] => {
			const containerEl = document.createElement(divClass);
			containerEl.addClass(rowClass);

			const targetEl = document.createElement(divClass);
			targetEl.addClass('input-wrapper');

			const labelEl = document.createElement(divClass);
			labelEl.addClass('input-label');
			labelEl.setText(label);

			const labelEl2 = document.createElement(divClass);
			labelEl2.addClass('postfix-label');
			labelEl2.setText(postfix);

			containerEl.appendChild(labelEl);
			containerEl.appendChild(targetEl);
			containerEl.appendChild(labelEl2);

			const component = new TextComponent(targetEl);
			component.setPlaceholder(placeholder);

			leftColumn.append(containerEl);
			return [component, labelEl2];
		};

		// Create interactive regex flags component
		const createFlagsComponent = (container: HTMLDivElement) => {
			container.empty();
			container.style.fontFamily = 'var(--font-monospace)';
			container.style.cursor = 'pointer';
			container.style.userSelect = 'none';

			const slash = document.createElement('span');
			slash.setText('/');
			slash.style.opacity = '0.5';
			container.appendChild(slash);

			const createFlag = (flag: string, enabled: boolean, tooltip: string, onClick: () => void) => {
				const span = document.createElement('span');
				span.setText(flag);
				span.style.opacity = enabled ? '1' : '0.3';
				span.style.textDecoration = enabled ? 'none' : 'line-through';
				span.style.padding = '0 1px';
				span.title = tooltip;
				span.onclick = (e) => {
					e.stopPropagation();
					onClick();
				};
				span.onmouseenter = () => { span.style.color = 'var(--interactive-accent)'; };
				span.onmouseleave = () => { span.style.color = ''; };
				return span;
			};

			// g is always on (not clickable)
			const gSpan = document.createElement('span');
			gSpan.setText('g');
			gSpan.title = 'Global (always on)';
			gSpan.style.opacity = '0.7';
			container.appendChild(gSpan);

			container.appendChild(createFlag('m', this.settings.multilineMatch,
				'Multiline: ^ and $ match line boundaries',
				() => {
					this.settings.multilineMatch = !this.settings.multilineMatch;
					this.plugin.saveData(this.settings);
					updateFlagsDisplay();
					updatePreview();
				}));

			container.appendChild(createFlag('i', this.settings.caseInsensitive,
				'Case insensitive',
				() => {
					this.settings.caseInsensitive = !this.settings.caseInsensitive;
					this.plugin.saveData(this.settings);
					updateFlagsDisplay();
					updatePreview();
				}));
		};

		let flagsContainer: HTMLDivElement;
		const updateFlagsDisplay = () => {
			if (flagsContainer && regToggleComponent?.getValue()) {
				createFlagsComponent(flagsContainer);
			} else if (flagsContainer) {
				flagsContainer.empty();
			}
		};

		const addToggleComponent = (label: string, tooltip: string, hide = false): ToggleComponent => {
			const containerEl = document.createElement(divClass);
			containerEl.addClass(rowClass);

			const targetEl = document.createElement(divClass);
			targetEl.addClass(rowClass);

			const component = new ToggleComponent(targetEl);
			component.setTooltip(tooltip);

			const labelEl = document.createElement(divClass);
			labelEl.addClass('check-label');
			labelEl.setText(label);

			containerEl.appendChild(labelEl);
			containerEl.appendChild(targetEl);
			if (!hide) leftColumn.appendChild(containerEl);
			return component;
		};

		// Create saved patterns dropdown
		if (this.settings.savedPatterns.length > 0) {
			const patternContainerEl = document.createElement(divClass);
			patternContainerEl.addClass(rowClass);

			const labelEl = document.createElement(divClass);
			labelEl.addClass('input-label');
			labelEl.setText('Saved:');

			const dropdownEl = document.createElement(divClass);
			dropdownEl.addClass('input-wrapper');

			const dropdownComponent = new DropdownComponent(dropdownEl);
			dropdownComponent.addOption('', 'Select a saved pattern...');

			const sortedPatterns = [...this.settings.savedPatterns].sort((a, b) => {
				if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
				return b.lastUsed - a.lastUsed;
			});

			sortedPatterns.forEach(pattern => {
				const prefix = pattern.isPinned ? '⭐ ' : '';
				const displayName = `${prefix}${pattern.name}`;
				dropdownComponent.addOption(pattern.id, displayName);
			});

			patternContainerEl.appendChild(labelEl);
			patternContainerEl.appendChild(dropdownEl);
			leftColumn.appendChild(patternContainerEl);

			dropdownComponent.onChange((patternId) => {
				if (!patternId) return;
				const pattern = this.settings.savedPatterns.find(p => p.id === patternId);
				if (pattern) {
					findInputComponent.setValue(pattern.findText);
					replaceWithInputComponent.setValue(pattern.replaceText);
					regToggleComponent.setValue(pattern.useRegEx);
					logger('Loaded saved pattern: ' + pattern.name, 9);
				}
			});
		}

		// Create input fields
		const escapeHints = [];
		if (this.settings.processLineBreak) escapeHints.push('\\n=LF');
		if (this.settings.processTab) escapeHints.push('\\t=TAB');
		const escapeHintText = escapeHints.length > 0 ? escapeHints.join(' ') : '';

		const findRow = addTextComponent('Find:', 'e.g. (.*)');
		findInputComponent = findRow[0];
		flagsContainer = findRow[1];
		if (this.settings.useRegEx) {
			createFlagsComponent(flagsContainer);
		}
		const replaceRow = addTextComponent('Replace:', 'e.g. $1', escapeHintText);
		replaceWithInputComponent = replaceRow[0];

		// Create and show regular expression toggle switch
		regToggleComponent = addToggleComponent('Use regular expressions', 'If enabled, regular expressions in the find field are processed as such, and regex groups might be addressed in the replace field');

		// Create and show selection toggle switch only if any text is selected
		const selToggleComponent = addToggleComponent('Replace only in selection', 'If enabled, replaces only occurances in the currently selected text', noSelection);

		// Create preview section (right column)
		const previewContainerEl = document.createElement(divClass);
		previewContainerEl.addClass('preview-container');
		previewContainerEl.style.height = '100%';
		previewContainerEl.style.display = 'flex';
		previewContainerEl.style.flexDirection = 'column';

		const previewTitleEl = document.createElement(divClass);
		previewTitleEl.addClass('preview-title');
		previewTitleEl.style.fontWeight = 'bold';
		previewTitleEl.style.marginBottom = '0.5em';
		previewTitleEl.style.fontSize = '1.1em';
		previewTitleEl.style.paddingBottom = '0.5em';
		previewTitleEl.style.borderBottom = '1px solid var(--background-modifier-border)';

		const previewContentEl = document.createElement(divClass);
		previewContentEl.addClass('preview-content');
		previewContentEl.style.fontSize = '0.9em';
		previewContentEl.style.flex = '1';
		previewContentEl.style.overflowY = 'auto';
		previewContentEl.style.padding = '0.5em';
		previewContentEl.style.backgroundColor = 'var(--background-secondary)';
		previewContentEl.style.borderRadius = '4px';
		previewContentEl.style.marginTop = '0.5em';

		previewContainerEl.appendChild(previewTitleEl);
		previewContainerEl.appendChild(previewContentEl);

		if (this.settings.showPreview) {
			rightColumn.appendChild(previewContainerEl);
		}

		let currentPreviewLimit = this.settings.previewLimit;

		const updatePreview = (keepLimit = false) => {
			if (!this.settings.showPreview) return;

			let searchString = findInputComponent.getValue();
			let replaceString = replaceWithInputComponent.getValue();

			if (!searchString) {
				previewTitleEl.setText('Preview: Enter search text');
				previewContentEl.setText('');
				currentPreviewLimit = this.settings.previewLimit;
				return;
			}

			// Process escape sequences for preview
			if (this.settings.processLineBreak) {
				searchString = searchString.replace(/\\n/gm, '\n');
				replaceString = replaceString.replace(/\\n/gm, '\n');
			}
			if (this.settings.processTab) {
				searchString = searchString.replace(/\\t/gm, '\t');
				replaceString = replaceString.replace(/\\t/gm, '\t');
			}

			// Reset limit when inputs change (unless explicitly keeping it)
			if (!keepLimit) {
				currentPreviewLimit = this.settings.previewLimit;
			}

			const targetText = selToggleComponent.getValue() && !noSelection
				? editor.getSelection()
				: editor.getValue();

			const { previews, totalCount } = generateMatchPreviews(
				targetText,
				searchString,
				replaceString,
				regToggleComponent.getValue(),
				this.settings.caseInsensitive,
				this.settings.multilineMatch,
				Math.min(currentPreviewLimit, 50) // Cap at 50 to prevent performance issues
			);

			if (totalCount === 0) {
				previewTitleEl.setText('Preview: No matches found');
				previewContentEl.setText('');
			} else {
				const scope = selToggleComponent.getValue() ? 'selection' : 'document';
				previewTitleEl.setText(`Preview: ${totalCount} match${totalCount !== 1 ? 'es' : ''} in ${scope}`);

				const escapeHtml = (text: string) => {
					return text
						.replace(/&/g, '&amp;')
						.replace(/</g, '&lt;')
						.replace(/>/g, '&gt;')
						.replace(/"/g, '&quot;')
						.replace(/'/g, '&#039;');
				};

				const truncateWithEllipsis = (text: string, maxLen: number) => {
					if (text.length <= maxLen) return text;
					return text.substring(0, maxLen - 3) + '...';
				};

				let previewHtml = '';
				previews.forEach(p => {
					if (p.isMultiLine) {
						// Handle multi-line matches specially
						const displayMatch = truncateWithEllipsis(p.matchedText.replace(/\n/g, '↵'), 60);
						const displayReplace = truncateWithEllipsis(p.replacementText.replace(/\n/g, '↵'), 60);

						previewHtml += `<div style="margin-bottom: 0.8em; padding: 0.5em; border-left: 3px solid var(--interactive-accent); background: var(--background-secondary-alt);">`;
						previewHtml += `<div style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 0.3em;">Line ${p.lineNumber} <span style="color: var(--text-warning);">(跨行匹配)</span></div>`;
						previewHtml += `<div style="font-family: var(--font-monospace); font-size: 0.9em;">`;
						previewHtml += `<div style="color: var(--text-error); margin-bottom: 0.2em;"><span style="opacity: 0.6;">−</span> ${escapeHtml(displayMatch)}</div>`;
						previewHtml += `<div style="color: var(--text-success);"><span style="opacity: 0.6;">+</span> ${escapeHtml(displayReplace)}</div>`;
						previewHtml += `</div></div>`;
					} else {
						// Show full line context with highlighted match
						const maxLineLen = 120;
						let displayLine = truncateWithEllipsis(p.lineContent, maxLineLen);
						let displayLineAfter = truncateWithEllipsis(p.lineAfterReplace, maxLineLen);

						// Build highlighted before line
						const beforePart = escapeHtml(p.lineContent.substring(0, p.matchStartInLine));
						const matchPart = escapeHtml(p.lineContent.substring(p.matchStartInLine, p.matchEndInLine));
						const afterPart = escapeHtml(p.lineContent.substring(p.matchEndInLine));

						const highlightedBefore = truncateWithEllipsis(
							beforePart + `<span style="background: var(--background-modifier-error); padding: 0 2px; border-radius: 2px;">${matchPart}</span>` + afterPart,
							maxLineLen + 100 // Allow extra for HTML tags
						);

						// Build highlighted after line
						const afterBeforePart = escapeHtml(p.lineAfterReplace.substring(0, p.matchStartInLine));
						const replacePart = escapeHtml(p.replacementText);
						const afterAfterPart = escapeHtml(p.lineAfterReplace.substring(p.matchStartInLine + p.replacementText.length));

						const highlightedAfter = truncateWithEllipsis(
							afterBeforePart + `<span style="background: var(--background-modifier-success); padding: 0 2px; border-radius: 2px;">${replacePart}</span>` + afterAfterPart,
							maxLineLen + 100
						);

						previewHtml += `<div style="margin-bottom: 0.8em; padding: 0.5em; border-left: 3px solid var(--interactive-accent); background: var(--background-secondary-alt);">`;
						previewHtml += `<div style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 0.3em;">Line ${p.lineNumber}</div>`;
						previewHtml += `<div style="font-family: var(--font-monospace); font-size: 0.9em; line-height: 1.6;">`;
						previewHtml += `<div style="margin-bottom: 0.2em;"><span style="opacity: 0.6; margin-right: 0.5em;">−</span>${highlightedBefore}</div>`;
						previewHtml += `<div><span style="opacity: 0.6; margin-right: 0.5em;">+</span>${highlightedAfter}</div>`;
						previewHtml += `</div></div>`;
					}
				});

				previewContentEl.innerHTML = previewHtml;

				// Add "Show more" button if there are more results
				if (totalCount > previews.length) {
					const showMoreBtn = document.createElement('button');
					showMoreBtn.setText(`Show ${Math.min(totalCount - previews.length, 10)} more...`);
					showMoreBtn.addClass('mod-cta');
					showMoreBtn.style.marginTop = '0.5em';
					showMoreBtn.style.width = '100%';
					showMoreBtn.onclick = () => {
						currentPreviewLimit += 10;
						updatePreview(true);
					};
					previewContentEl.appendChild(showMoreBtn);

					// Also show remaining count
					const remainingText = document.createElement('div');
					remainingText.style.fontStyle = 'italic';
					remainingText.style.color = 'var(--text-muted)';
					remainingText.style.marginTop = '0.5em';
					remainingText.style.textAlign = 'center';
					remainingText.style.fontSize = '0.9em';
					remainingText.setText(`(${totalCount - previews.length} more matches)`);
					previewContentEl.appendChild(remainingText);
				}
			}
		};

		// Add listeners to update preview
		findInputComponent.inputEl.addEventListener('input', () => updatePreview());
		replaceWithInputComponent.inputEl.addEventListener('input', () => updatePreview());
		regToggleComponent.onChange(() => {
			updatePreview();
			updateFlagsDisplay();
		});
		selToggleComponent.onChange(() => updatePreview());

		// Create Buttons
		const buttonContainerEl = document.createElement(divClass);
		buttonContainerEl.addClass(rowClass);

		const submitButtonTarget = document.createElement(divClass);
		submitButtonTarget.addClass('button-wrapper');
		submitButtonTarget.addClass(rowClass);

		const cancelButtonTarget = document.createElement(divClass);
		cancelButtonTarget.addClass('button-wrapper');
		cancelButtonTarget.addClass(rowClass);

		const submitButtonComponent = new ButtonComponent(submitButtonTarget);
		const cancelButtonComponent = new ButtonComponent(cancelButtonTarget);
		
		cancelButtonComponent.setButtonText('Cancel');
		cancelButtonComponent.onClick(() => {
			logger('Action cancelled.', 8);
			this.close();
		});

		submitButtonComponent.setButtonText('Replace All');
		submitButtonComponent.setCta();

		const performReplacement = () => {
			let resultString = 'No match';
			let scope = '';
			let searchString = findInputComponent.getValue();
			let replaceString = replaceWithInputComponent.getValue();
			const selectedText = editor.getSelection();

			if (searchString === '') {
				new Notice('Nothing to search for!');
				return;
			}

			// Replace line breaks in find-field if option is enabled
			if (this.settings.processLineBreak) {
				logger('Replacing linebreaks in find-field', 9);
				logger('  old: ' + searchString, 9);
				searchString = searchString.replace(/\\n/gm, '\n');
				logger('  new: ' + searchString, 9);
			}

			// Replace tabs in find-field if option is enabled
			if (this.settings.processTab) {
				logger('Replacing tabs in find-field', 9);
				logger('  old: ' + searchString, 9);
				searchString = searchString.replace(/\\t/gm, '\t');
				logger('  new: ' + searchString, 9);
			}

			// Replace line breaks in replace-field if option is enabled
			if (this.settings.processLineBreak) {
				logger('Replacing linebreaks in replace-field', 9);
				logger('  old: ' + replaceString, 9);
				replaceString = replaceString.replace(/\\n/gm, '\n');
				logger('  new: ' + replaceString, 9);
			}

			// Replace tabs in replace-field if option is enabled
			if (this.settings.processTab) {
				logger('Replacing tabs in replace-field', 9);
				logger('  old: ' + replaceString, 9);
				replaceString = replaceString.replace(/\\t/gm, '\t');
				logger('  new: ' + replaceString, 9);
			}

			// Check if regular expressions should be used
			if(regToggleComponent.getValue()) {
				const currentFlags = buildRegexFlags();
				logger('USING regex with flags: ' + currentFlags, 8);

				const searchRegex = new RegExp(searchString, currentFlags);
				if(!selToggleComponent.getValue()) {
					logger('   SCOPE: Full document', 9);
					const documentText = editor.getValue();
					const rresult = documentText.match(searchRegex);
					if (rresult) {
						editor.setValue(documentText.replace(searchRegex, replaceString));
						resultString = `Made ${rresult.length} replacement(s) in document`;			
					}
				}
				else {
					logger('   SCOPE: Selection', 9);
					const rresult = selectedText.match(searchRegex);
					if (rresult) {
						editor.replaceSelection(selectedText.replace(searchRegex, replaceString));	
						resultString = `Made ${rresult.length} replacement(s) in selection`;
					}
				}
			}
			else {
				logger('NOT using regex', 8);
				let nrOfHits = 0;
				if(!selToggleComponent.getValue()) {
					logger('   SCOPE: Full document', 9);
					scope = 'selection'
					const documentText = editor.getValue();
					const documentSplit = documentText.split(searchString);
					nrOfHits = documentSplit.length - 1;
					editor.setValue(documentSplit.join(replaceString));
				}
				else {
					logger('   SCOPE: Selection', 9);
					scope = 'document';
					const selectedSplit = selectedText.split(searchString);
					nrOfHits = selectedSplit.length - 1;
					editor.replaceSelection(selectedSplit.join(replaceString));
				}
				resultString = `Made ${nrOfHits} replacement(s) in ${scope}`;
			} 		
			
			// Saving settings (find/replace text and toggle switch states)
			this.settings.findText = searchString;
			this.settings.replaceText = replaceString;
			this.settings.useRegEx = regToggleComponent.getValue();
			this.settings.selOnly = selToggleComponent.getValue();

			// Auto-save successful pattern to history
			if (resultString !== 'No match') {
				(this.plugin as RegexFindReplacePlugin).savePattern(
					searchString,
					replaceWithInputComponent.getValue(),
					regToggleComponent.getValue(),
					this.settings.caseInsensitive
				);
			}

			this.plugin.saveData(this.settings);

			this.close();
			new Notice(resultString);
		};

		submitButtonComponent.onClick(() => {
			const searchString = findInputComponent.getValue();
			if (!searchString) {
				new Notice('Nothing to search for!');
				return;
			}

			// Check if confirmation is needed for large replacements
			if (this.settings.confirmLargeReplace) {
				const targetText = selToggleComponent.getValue() && !noSelection
					? editor.getSelection()
					: editor.getValue();

				const { totalCount } = generateMatchPreviews(
					targetText,
					searchString,
					replaceWithInputComponent.getValue(),
					regToggleComponent.getValue(),
					this.settings.caseInsensitive,
					this.settings.multilineMatch,
					1
				);

				if (totalCount >= this.settings.largeReplaceThreshold) {
					const scope = selToggleComponent.getValue() ? 'selection' : 'document';
					const confirmed = confirm(
						`This will replace ${totalCount} matches in ${scope}.\n\nAre you sure you want to proceed?`
					);
					if (!confirmed) {
						logger('Large replacement cancelled by user', 8);
						return;
					}
				}
			}

			performReplacement();
		});

		// Apply settings
		regToggleComponent.setValue(this.settings.useRegEx);
		selToggleComponent.setValue(this.settings.selOnly);
		replaceWithInputComponent.setValue(this.settings.replaceText);
		
		// Check if the prefill find option is enabled and the selection does not contain linebreaks
		if (this.settings.prefillFind && editor.getSelection().indexOf('\n') < 0 && !noSelection) {
			logger('Found selection without linebreaks and option is enabled -> fill',9);
			findInputComponent.setValue(editor.getSelection());
			selToggleComponent.setValue(false);
		}
		else {
			logger('Restore find text', 9);
			findInputComponent.setValue(this.settings.findText);
		}
		
		// Add button row to dialog
		buttonContainerEl.appendChild(submitButtonTarget);
		buttonContainerEl.appendChild(cancelButtonTarget);
		buttonContainerEl.style.marginTop = '1em';
		leftColumn.appendChild(buttonContainerEl);

		// If no text is selected, disable selection-toggle-switch
		if (noSelection) selToggleComponent.setValue(false);

		// Initial preview after all values are set
		updatePreview();
	}
	
	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class RegexFindReplaceSettingTab extends PluginSettingTab {
	plugin: RegexFindReplacePlugin;

	constructor(app: App, plugin: RegexFindReplacePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h4', {text: 'Regular Expression Settings'});

		new Setting(containerEl)
			.setName('Case Insensitive')
			.setDesc('Apply the /i modifier for case insensitive search')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.caseInsensitive)
				.onChange(async (value) => {
					logger('Settings update: caseInsensitive: ' + value);
					this.plugin.settings.caseInsensitive = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Multiline Mode')
			.setDesc('Apply the /m modifier (^ and $ match line start/end instead of string start/end)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.multilineMatch)
				.onChange(async (value) => {
					logger('Settings update: multilineMatch: ' + value);
					this.plugin.settings.multilineMatch = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h4', {text: 'General Settings'});


		new Setting(containerEl)
			.setName('Process \\n as line break')
			.setDesc('When \'\\n\' is used in the find or replace field, it will be treated as a line break. This allows searching for and replacing text across multiple lines.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.processLineBreak)
				.onChange(async (value) => {
					logger('Settings update: processLineBreak: ' + value);
					this.plugin.settings.processLineBreak = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Process \\t as tab')
			.setDesc('When \'\\t\' is used in the find or replace field, it will be treated as a tab character. This allows searching for and replacing tabs.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.processTab)
				.onChange(async (value) => {
					logger('Settings update: processTab: ' + value);
					this.plugin.settings.processTab = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Prefill Find Field')
			.setDesc('Copy the currently selected text (if any) into the \'Find\' text field. This setting is only applied if the selection does not contain linebreaks')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.prefillFind)
				.onChange(async (value) => {
					logger('Settings update: prefillFind: ' + value);
					this.plugin.settings.prefillFind = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h4', {text: 'Preview & Safety'});

		new Setting(containerEl)
			.setName('Show Preview')
			.setDesc('Display a live preview of matches and replacements before performing the operation')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showPreview)
				.onChange(async (value) => {
					logger('Settings update: showPreview: ' + value);
					this.plugin.settings.showPreview = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Preview Limit')
			.setDesc('Maximum number of matches to show in the preview')
			.addText(text => text
				.setPlaceholder('5')
				.setValue(String(this.plugin.settings.previewLimit))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0 && num <= 50) {
						logger('Settings update: previewLimit: ' + num);
						this.plugin.settings.previewLimit = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Confirm Large Replacements')
			.setDesc('Show a confirmation dialog when replacing many matches')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.confirmLargeReplace)
				.onChange(async (value) => {
					logger('Settings update: confirmLargeReplace: ' + value);
					this.plugin.settings.confirmLargeReplace = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Large Replacement Threshold')
			.setDesc('Number of matches that triggers the confirmation dialog')
			.addText(text => text
				.setPlaceholder('20')
				.setValue(String(this.plugin.settings.largeReplaceThreshold))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0 && num <= 1000) {
						logger('Settings update: largeReplaceThreshold: ' + num);
						this.plugin.settings.largeReplaceThreshold = num;
						await this.plugin.saveSettings();
					}
				}));

		containerEl.createEl('h4', {text: 'Saved Patterns'});

		new Setting(containerEl)
			.setName('Max History Size')
			.setDesc('Maximum number of unpinned patterns to keep in history (pinned patterns are never removed)')
			.addText(text => text
				.setPlaceholder('10')
				.setValue(String(this.plugin.settings.maxHistorySize))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0 && num <= 100) {
						logger('Settings update: maxHistorySize: ' + num);
						this.plugin.settings.maxHistorySize = num;
						this.plugin.pruneHistory();
						await this.plugin.saveSettings();
					}
				}));

		if (this.plugin.settings.savedPatterns.length > 0) {
			const sortedPatterns = [...this.plugin.settings.savedPatterns].sort((a, b) => {
				if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
				return b.lastUsed - a.lastUsed;
			});

			sortedPatterns.forEach(pattern => {
				const setting = new Setting(containerEl)
					.setName(pattern.name)
					.setDesc(`Find: ${pattern.findText.substring(0, 50)} | Replace: ${pattern.replaceText.substring(0, 50)}`);

				setting.addExtraButton(button => button
					.setIcon(pattern.isPinned ? 'pin' : 'pin-off')
					.setTooltip(pattern.isPinned ? 'Unpin' : 'Pin')
					.onClick(async () => {
						this.plugin.togglePinPattern(pattern.id);
						this.display();
					}));

				setting.addExtraButton(button => button
					.setIcon('trash')
					.setTooltip('Delete')
					.onClick(async () => {
						this.plugin.deletePattern(pattern.id);
						this.display();
					}));
			});

			new Setting(containerEl)
				.setName('Clear All Patterns')
				.setDesc('Remove all saved patterns from history')
				.addButton(button => button
					.setButtonText('Clear All')
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.savedPatterns = [];
						await this.plugin.saveSettings();
						this.display();
					}));
		} else {
			containerEl.createEl('p', {
				text: 'No saved patterns yet. Patterns will be automatically saved when you perform replacements.',
				cls: 'setting-item-description'
			});
		}
	}
}
