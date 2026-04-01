/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorInputCapabilities, IEditorOpenContext } from '../../../../common/editor.js';
import { URI } from '../../../../../base/common/uri.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { IGatewayRpcService } from '../../browser/gatewayRpcService.js';
import { GatewayToolsCatalogResult } from '../../common/gatewayTypes.js';

// --- Types ---

interface ITool {
	name: string;
	description: string;
}

interface IToolGroup {
	name: string;
	tools: ITool[];
}

// --- Styles ---

const TOOLS_EDITOR_STYLES = `
.gw-tools-container {
	background: #0d0d1a;
	color: #e0e0e0;
	height: 100%;
	overflow-y: auto;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	padding: 0;
}

.gw-tools-header {
	padding: 24px 28px 16px;
	border-bottom: 1px solid rgba(0, 212, 255, 0.15);
}

.gw-tools-header h2 {
	margin: 0 0 6px;
	font-size: 20px;
	font-weight: 600;
	color: #ffffff;
}

.gw-tools-header p {
	margin: 0;
	font-size: 13px;
	color: #888;
}

.gw-tools-groups {
	padding: 12px 28px 28px;
}

.gw-tools-group {
	margin-bottom: 16px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 8px;
	overflow: hidden;
	background: rgba(255, 255, 255, 0.02);
}

.gw-tools-group-header {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 12px 16px;
	cursor: pointer;
	user-select: none;
	background: rgba(255, 255, 255, 0.03);
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	transition: background 0.15s ease;
}

.gw-tools-group-header:hover {
	background: rgba(0, 212, 255, 0.06);
}

.gw-tools-group-chevron {
	font-size: 11px;
	color: #888;
	transition: transform 0.2s ease;
	width: 16px;
	text-align: center;
}

.gw-tools-group-chevron.collapsed {
	transform: rotate(-90deg);
}

.gw-tools-group-name {
	font-size: 13px;
	font-weight: 600;
	color: #ffffff;
	flex: 1;
}

.gw-tools-group-badge {
	font-size: 11px;
	font-weight: 500;
	color: #00d4ff;
	background: rgba(0, 212, 255, 0.12);
	padding: 2px 8px;
	border-radius: 10px;
}

.gw-tools-group-list {
	padding: 4px 0;
}

.gw-tools-group-list.hidden {
	display: none;
}

.gw-tools-row {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 16px 10px 42px;
	transition: background 0.12s ease;
}

.gw-tools-row:hover {
	background: rgba(0, 212, 255, 0.05);
}

.gw-tools-row-name {
	font-size: 13px;
	font-weight: 500;
	color: #00d4ff;
	font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
	min-width: 120px;
}

.gw-tools-row-desc {
	font-size: 12px;
	color: #999;
}

.gw-loading, .gw-error {
	padding: 32px;
	text-align: center;
	font-size: 13px;
}
.gw-loading { color: #808080; }
.gw-error { color: #f44336; }
`;

// --- Editor Input ---

export class ToolsEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.toolsEditor';

	readonly resource = URI.from({ scheme: 'devclaw-tools', path: 'default' });

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override get typeId(): string {
		return ToolsEditorInput.ID;
	}

	override getName(): string {
		return 'Tools';
	}

	override matches(other: EditorInput | unknown): boolean {
		return other instanceof ToolsEditorInput;
	}
}

// --- Editor Pane ---

export class ToolsEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.toolsEditor';

	private container: HTMLElement | undefined;
	private styleElement: HTMLStyleElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IGatewayRpcService private readonly rpcService: IGatewayRpcService,
	) {
		super(ToolsEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		// Inject styles once
		if (!this.styleElement) {
			this.styleElement = document.createElement('style');
			this.styleElement.textContent = TOOLS_EDITOR_STYLES;
			parent.ownerDocument.head.appendChild(this.styleElement);
		}

		this.container = document.createElement('div');
		this.container.classList.add('gw-tools-container');
		parent.appendChild(this.container);

		// Header
		const header = document.createElement('div');
		header.classList.add('gw-tools-header');

		const title = document.createElement('h2');
		title.textContent = 'Tools';
		header.appendChild(title);

		const subtitle = document.createElement('p');
		subtitle.textContent = 'Loading tool catalog...';
		header.appendChild(subtitle);

		this.container.appendChild(header);

		// Loading indicator
		const loading = document.createElement('div');
		loading.className = 'gw-loading';
		loading.textContent = 'Loading...';
		this.container.appendChild(loading);

		// Attempt to load live data from the gateway
		this._loadLiveData();
	}

	private clearContainer(): void {
		if (!this.container) {
			return;
		}
		while (this.container.firstChild) {
			this.container.removeChild(this.container.firstChild);
		}
	}

	private renderContent(groups: IToolGroup[]): void {
		if (!this.container) {
			return;
		}

		this.clearContainer();

		// Header
		const header = document.createElement('div');
		header.classList.add('gw-tools-header');

		const title = document.createElement('h2');
		title.textContent = 'Tools';
		header.appendChild(title);

		const subtitle = document.createElement('p');
		const totalTools = groups.reduce((sum, g) => sum + g.tools.length, 0);
		subtitle.textContent = `${totalTools} tools available across ${groups.length} groups`;
		header.appendChild(subtitle);

		this.container.appendChild(header);

		// Groups
		const groupsContainer = document.createElement('div');
		groupsContainer.classList.add('gw-tools-groups');

		for (const group of groups) {
			groupsContainer.appendChild(this.renderGroup(group));
		}

		this.container.appendChild(groupsContainer);
	}

	private async _loadLiveData(): Promise<void> {
		try {
			const result = await this.rpcService.call<GatewayToolsCatalogResult>('tools.catalog', { agentId: 'main' });
			const groups: IToolGroup[] = result.groups.map(g => ({
				name: g.name,
				tools: g.tools.map(t => ({
					name: t.name,
					description: t.description,
				})),
			}));

			// Re-render with live data
			this.renderContent(groups);
		} catch {
			// Clear and show error
			if (!this.container) {
				return;
			}
			this.clearContainer();

			const header = document.createElement('div');
			header.classList.add('gw-tools-header');

			const title = document.createElement('h2');
			title.textContent = 'Tools';
			header.appendChild(title);

			const subtitle = document.createElement('p');
			subtitle.textContent = 'Tool catalog unavailable.';
			header.appendChild(subtitle);

			this.container.appendChild(header);

			const error = document.createElement('div');
			error.className = 'gw-error';
			error.textContent = 'Unable to connect to gateway';
			this.container.appendChild(error);
		}
	}

	private renderGroup(group: IToolGroup): HTMLElement {
		const groupEl = document.createElement('div');
		groupEl.classList.add('gw-tools-group');

		// Header (clickable to collapse)
		const headerEl = document.createElement('div');
		headerEl.classList.add('gw-tools-group-header');

		const chevron = document.createElement('span');
		chevron.classList.add('gw-tools-group-chevron');
		chevron.textContent = '\u25BC'; // down arrow
		headerEl.appendChild(chevron);

		const nameEl = document.createElement('span');
		nameEl.classList.add('gw-tools-group-name');
		nameEl.textContent = group.name;
		headerEl.appendChild(nameEl);

		const badge = document.createElement('span');
		badge.classList.add('gw-tools-group-badge');
		badge.textContent = `${group.tools.length}`;
		headerEl.appendChild(badge);

		groupEl.appendChild(headerEl);

		// Tool list
		const listEl = document.createElement('div');
		listEl.classList.add('gw-tools-group-list');

		for (const tool of group.tools) {
			const row = document.createElement('div');
			row.classList.add('gw-tools-row');

			const toolName = document.createElement('span');
			toolName.classList.add('gw-tools-row-name');
			toolName.textContent = tool.name;
			row.appendChild(toolName);

			const toolDesc = document.createElement('span');
			toolDesc.classList.add('gw-tools-row-desc');
			toolDesc.textContent = tool.description;
			row.appendChild(toolDesc);

			listEl.appendChild(row);
		}

		groupEl.appendChild(listEl);

		// Toggle collapse
		headerEl.addEventListener('click', () => {
			const isCollapsed = listEl.classList.toggle('hidden');
			if (isCollapsed) {
				chevron.classList.add('collapsed');
			} else {
				chevron.classList.remove('collapsed');
			}
		});

		return groupEl;
	}

	override async setInput(
		input: ToolsEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
	}

	override layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
	}

	override dispose(): void {
		if (this.styleElement) {
			this.styleElement.remove();
			this.styleElement = undefined;
		}
		super.dispose();
	}
}
