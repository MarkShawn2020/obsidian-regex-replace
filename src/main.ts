import {
	App,
	ButtonComponent,
	Editor,
	Modal,
	Notice,
	Plugin,
	TextComponent,
	ToggleComponent,
	PluginSettingTab,
	Setting
} from 'obsidian';

interface RfrPluginSettings {
	findText: string;
	replaceText: string;
	useRegEx: boolean;
	selOnly: boolean;
	caseInsensitive: boolean;
	processLineBreak: boolean;
	processTab: boolean;
	prefillFind: boolean;
}

const DEFAULT_SETTINGS: RfrPluginSettings = {
	findText: '',
	replaceText: '',
	useRegEx: true,
	selOnly: false,
	caseInsensitive: false,
	processLineBreak: false,
	processTab: false,
	prefillFind: false
}

// logThreshold: 0 ... only error messages
//               9 ... verbose output
const logThreshold = 9;
const logger = (logString: string, logLevel=0): void => {if (logLevel <= logThreshold) console.log ('RegexFiRe: ' + logString)};

type FixStat = { key: string; count: number };

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
		titleEl.setText('Regex Find/Replace');

		const rowClass = 'row';
		const divClass = 'div';
		const noSelection = editor.getSelection() === '';
		let regexFlags = 'gm';
		if (this.settings.caseInsensitive) regexFlags = regexFlags.concat('i');

		logger('No text selected?: ' + noSelection, 9);

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

			contentEl.append(containerEl);
			return [component, labelEl2];
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
			if (!hide) contentEl.appendChild(containerEl);
			return component;
		};

		// Create input fields
		const findRow = addTextComponent('Find:', 'e.g. (.*)', '/' + regexFlags);
		const findInputComponent = findRow[0];
		const findRegexFlags = findRow[1];
		const replaceRow = addTextComponent('Replace:', 'e.g. $1', this.settings.processLineBreak ? '\\n=LF' : '');
		const replaceWithInputComponent = replaceRow[0];

		// Create and show regular expression toggle switch
		const regToggleComponent = addToggleComponent('Use regular expressions', 'If enabled, regular expressions in the find field are processed as such, and regex groups might be addressed in the replace field');
		
		// Update regex-flags label if regular expressions are enabled or disabled
		regToggleComponent.onChange( regNew => {
			if (regNew) {
				findRegexFlags.setText('/' + regexFlags);
			}
			else {
				findRegexFlags.setText('');
			}
		})

		// Create and show selection toggle switch only if any text is selected
		const selToggleComponent = addToggleComponent('Replace only in selection', 'If enabled, replaces only occurances in the currently selected text', noSelection);

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
		submitButtonComponent.onClick(() => {
			let resultString = 'No match';
			let scope = '';
			const searchString = findInputComponent.getValue();
			let replaceString = replaceWithInputComponent.getValue();
			const selectedText = editor.getSelection();

			if (searchString === '') {
				new Notice('Nothing to search for!');
				return;
			}

			// Replace line breaks in find-field if option is enabled
			if (this.settings.processLineBreak) {
				logger('Replacing linebreaks in replace-field', 9);
				logger('  old: ' + replaceString, 9);
				replaceString = replaceString.replace(/\\n/gm, '\n');
				logger('  new: ' + replaceString, 9);
			}

			// Replace line breaks in find-field if option is enabled
			if (this.settings.processTab) {
				logger('Replacing tabs in replace-field', 9);
				logger('  old: ' + replaceString, 9);
				replaceString = replaceString.replace(/\\t/gm, '\t');
				logger('  new: ' + replaceString, 9);
			}

			// Check if regular expressions should be used
			if(regToggleComponent.getValue()) {
				logger('USING regex with flags: ' + regexFlags, 8);

				const searchRegex = new RegExp(searchString, regexFlags);
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
			this.plugin.saveData(this.settings);

			this.close();
			new Notice(resultString);					
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
		contentEl.appendChild(buttonContainerEl);

		// If no text is selected, disable selection-toggle-switch
		if (noSelection) selToggleComponent.setValue(false);
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
			.setDesc('When using regular expressions, apply the \'/i\' modifier for case insensitive search)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.caseInsensitive)
				.onChange(async (value) => {
					logger('Settings update: caseInsensitive: ' + value);
					this.plugin.settings.caseInsensitive = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h4', {text: 'General Settings'});


		new Setting(containerEl)
			.setName('Process \\n as line break')
			.setDesc('When \'\\n\' is used in the replace field, a \'line break\' will be inserted accordingly')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.processLineBreak)
				.onChange(async (value) => {
					logger('Settings update: processLineBreak: ' + value);
					this.plugin.settings.processLineBreak = value;
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
	}
}
