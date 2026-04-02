/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { CodeApplyService } from './codeApply.js';
import { IDevClawService } from './devclawService.js';

interface StreamItem {
	type: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	timestamp: Date;
	agentName?: string;
	toolName?: string;
}

export class DevTeamChatPane extends ViewPane {

	static readonly ID = 'devteam.chatView';

	private streamContainer!: HTMLElement;
	private inputEl!: HTMLInputElement;
	private items: StreamItem[] = [];
	private codeApplyService: CodeApplyService;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IFileService fileService: IFileService,
		@IEditorService editorService: IEditorService,
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@IDevClawService private readonly devclawService: IDevClawService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this.codeApplyService = new CodeApplyService(fileService, editorService, workspaceService);

		// Listen for messages from the shared service
		this._register(this.devclawService.onChatMessage((msg) => {
			this.addStreamItem({
				type: msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'system',
				content: msg.content,
				timestamp: new Date(),
				agentName: msg.agentId,
			});
		}));

		// Listen for agent changes
		this._register(this.devclawService.onAgentSelected((agentId) => {
			this.addSystemMessage(`Switched to agent: ${agentId}`);
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.style.cssText = `
			display: flex;
			flex-direction: column;
			background: #0f1a1e;
			height: 100%;
		`;

		// Inject styles
		const style = document.createElement('style');
		style.textContent = CHAT_STYLES;
		container.appendChild(style);

		// Stream container (scrollable)
		this.streamContainer = document.createElement('div');
		this.streamContainer.className = 'devteam-stream';
		container.appendChild(this.streamContainer);

		// Welcome message
		this.addSystemMessage('Welcome to OpenClaw IDE. Configure your API key in Settings to start chatting.');

		// Input bar
		const inputBar = document.createElement('div');
		inputBar.className = 'devteam-input-bar';

		const prompt = document.createElement('span');
		prompt.className = 'devteam-prompt';
		prompt.textContent = '>';
		inputBar.appendChild(prompt);

		this.inputEl = document.createElement('input');
		this.inputEl.className = 'devteam-input';
		this.inputEl.type = 'text';
		this.inputEl.placeholder = 'Message your agent team...';
		this.inputEl.spellcheck = false;

		this._register(addDisposableListener(this.inputEl, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && this.inputEl.value.trim()) {
				this.handleSend(this.inputEl.value.trim());
				this.inputEl.value = '';
			}
		}));

		inputBar.appendChild(this.inputEl);
		container.appendChild(inputBar);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	private handleSend(message: string): void {
		// Send through the shared service (handles both connected + disconnected states)
		this.devclawService.sendMessage(message);
	}

	private addSystemMessage(text: string): void {
		this.addStreamItem({
			type: 'system',
			content: text,
			timestamp: new Date(),
		});
	}

	private addStreamItem(item: StreamItem): void {
		this.items.push(item);

		const el = document.createElement('div');
		el.className = `devteam-stream-item devteam-stream-${item.type}`;

		// Timestamp
		const ts = document.createElement('span');
		ts.className = 'devteam-ts';
		ts.textContent = item.timestamp.toLocaleTimeString('en-US', { hour12: false });
		el.appendChild(ts);

		// Agent label (for assistant messages)
		if (item.agentName) {
			const agent = document.createElement('span');
			agent.className = 'devteam-agent-name';
			agent.textContent = item.agentName;
			el.appendChild(agent);
		}

		// User label
		if (item.type === 'user') {
			const you = document.createElement('span');
			you.className = 'devteam-user-name';
			you.textContent = 'you';
			el.appendChild(you);
		}

		// Content — handle code blocks
		const lines = item.content.split('\n');
		let inCodeBlock = false;
		let codeLines: string[] = [];
		let codeLang = '';

		for (const line of lines) {
			if (line.startsWith('```') && !inCodeBlock) {
				inCodeBlock = true;
				codeLang = line.slice(3).trim();
				codeLines = [];
			} else if (line.startsWith('```') && inCodeBlock) {
				inCodeBlock = false;
				// Render code block
				const codeBlock = document.createElement('div');
				codeBlock.className = 'devteam-code-block';

				if (codeLang) {
					const langLabel = document.createElement('span');
					langLabel.className = 'devteam-code-lang';
					langLabel.textContent = codeLang;
					codeBlock.appendChild(langLabel);
				}

				const pre = document.createElement('pre');
				const code = document.createElement('code');
				code.textContent = codeLines.join('\n');
				pre.appendChild(code);
				codeBlock.appendChild(pre);

				// Apply button
				const actions = document.createElement('div');
				actions.className = 'devteam-code-actions';

				const codeContent = codeLines.join('\n');
				const applyBtn = document.createElement('button');
				applyBtn.className = 'devteam-btn devteam-btn-apply';
				applyBtn.textContent = 'Apply';
				applyBtn.addEventListener('click', async () => {
					applyBtn.textContent = 'Applying...';
					applyBtn.disabled = true;
					const result = await this.codeApplyService.apply({
						filePath: codeLang ? `untitled.${codeLang}` : 'untitled.txt',
						content: codeContent,
						language: codeLang || undefined,
					});
					if (result.success) {
						applyBtn.textContent = result.created ? 'Created' : 'Applied';
						this.addSystemMessage(`Code applied to ${result.filePath}`);
					} else {
						applyBtn.textContent = 'Failed';
						this.addSystemMessage(`Failed to apply: ${result.error}`);
						applyBtn.disabled = false;
					}
				});
				actions.appendChild(applyBtn);

				const copyBtn = document.createElement('button');
				copyBtn.className = 'devteam-btn devteam-btn-copy';
				copyBtn.textContent = 'Copy';
				copyBtn.addEventListener('click', () => {
					navigator.clipboard.writeText(codeLines.join('\n'));
					copyBtn.textContent = 'Copied!';
					setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
				});
				actions.appendChild(copyBtn);

				codeBlock.appendChild(actions);
				el.appendChild(codeBlock);
			} else if (inCodeBlock) {
				codeLines.push(line);
			} else {
				// Plain text line
				if (line.trim()) {
					const textEl = document.createElement('div');
					textEl.className = 'devteam-text-line';
					textEl.textContent = line;
					el.appendChild(textEl);
				}
			}
		}

		this.streamContainer.appendChild(el);
		this.streamContainer.scrollTop = this.streamContainer.scrollHeight;
	}
}

const CHAT_STYLES = `
	.devteam-stream {
		flex: 1;
		overflow-y: auto;
		padding: 8px 12px;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		font-size: 13px;
		line-height: 1.5;
	}

	.devteam-stream-item {
		padding: 6px 0;
		border-bottom: 1px solid #1a2a2e;
	}

	.devteam-stream-system {
		color: #555;
		font-style: italic;
	}

	.devteam-stream-user .devteam-text-line {
		color: #e0e0e0;
	}

	.devteam-stream-assistant .devteam-text-line {
		color: #c0c0c0;
	}

	.devteam-ts {
		color: #444;
		font-size: 11px;
		margin-right: 8px;
	}

	.devteam-agent-name {
		color: #e85555;
		font-weight: 600;
		font-size: 12px;
		margin-right: 8px;
	}

	.devteam-user-name {
		color: #9b59b6;
		font-weight: 600;
		font-size: 12px;
		margin-right: 8px;
	}

	.devteam-text-line {
		margin: 2px 0 2px 0;
	}

	.devteam-code-block {
		background: #1a2a2e;
		border: 1px solid #2a3a3e;
		border-radius: 4px;
		margin: 6px 0;
		overflow: hidden;
	}

	.devteam-code-lang {
		display: block;
		padding: 4px 10px;
		color: #666;
		font-size: 11px;
		border-bottom: 1px solid #2a3a3e;
	}

	.devteam-code-block pre {
		margin: 0;
		padding: 10px;
		overflow-x: auto;
	}

	.devteam-code-block code {
		color: #d4d4d4;
		font-size: 12px;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
	}

	.devteam-code-actions {
		display: flex;
		gap: 6px;
		padding: 6px 10px;
		border-top: 1px solid #2a3a3e;
	}

	.devteam-btn {
		padding: 3px 12px;
		border: 1px solid #2a3a3e;
		border-radius: 3px;
		font-size: 11px;
		cursor: pointer;
		font-family: inherit;
		background: transparent;
	}

	.devteam-btn-apply {
		color: #e85555;
		border-color: #e8555533;
	}

	.devteam-btn-apply:hover {
		background: #e8555511;
	}

	.devteam-btn-copy {
		color: #808080;
		border-color: #2a3a3e;
	}

	.devteam-btn-copy:hover {
		background: #ffffff08;
	}

	.devteam-input-bar {
		display: flex;
		align-items: center;
		padding: 8px 12px;
		border-top: 1px solid #2a3a3e;
		background: #0a0a18;
		flex-shrink: 0;
	}

	.devteam-prompt {
		color: #e85555;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		font-size: 14px;
		font-weight: 700;
		margin-right: 8px;
		user-select: none;
	}

	.devteam-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #e0e0e0;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		font-size: 13px;
		caret-color: #e85555;
	}

	.devteam-input::placeholder {
		color: #444;
	}
`;
