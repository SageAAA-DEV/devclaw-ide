/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorInputCapabilities, IEditorOpenContext } from '../../../../common/editor.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';

// ---------------------------------------------------------------------------
// Mock data — will be replaced by OpenClaw RPC client
// ---------------------------------------------------------------------------

interface NodeRow {
	nodeId: string;
	displayName: string;
	platform: 'macos' | 'ios' | 'linux' | 'windows';
	connected: boolean;
	caps: string[];
}

const MOCK_NODES: NodeRow[] = [
	{ nodeId: 'macbook-pro', displayName: 'MacBook Pro', platform: 'macos', connected: true, caps: ['bash', 'docker', 'browser'] },
	{ nodeId: 'iphone-15', displayName: 'iPhone 15', platform: 'ios', connected: true, caps: ['shortcuts'] },
	{ nodeId: 'server-1', displayName: 'Dev Server', platform: 'linux', connected: false, caps: ['bash', 'docker', 'gpu'] },
];

// ---------------------------------------------------------------------------
// Platform labels for display
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<string, string> = {
	macos: 'macOS',
	ios: 'iOS',
	linux: 'Linux',
	windows: 'Windows',
};

// ---------------------------------------------------------------------------
// EditorInput — the "identity" of the tab
// ---------------------------------------------------------------------------

export class NodesEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.nodesEditor';

	readonly resource = URI.from({ scheme: 'devclaw-nodes', path: 'default' });

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override get typeId(): string { return NodesEditorInput.ID; }

	override getName(): string { return 'Nodes'; }

	override matches(other: unknown): boolean {
		return other instanceof NodesEditorInput;
	}
}

// ---------------------------------------------------------------------------
// EditorPane — renders into the main editor area
// ---------------------------------------------------------------------------

export class NodesEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.nodesEditor';

	private container!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super(NodesEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// -- lifecycle -----------------------------------------------------------

	protected createEditor(parent: HTMLElement): void {
		this.container = document.createElement('div');
		this.container.className = 'gw-nodes-root';
		parent.appendChild(this.container);

		// Inject scoped styles
		const style = document.createElement('style');
		style.textContent = NODES_EDITOR_STYLES;
		this.container.appendChild(style);

		// Header
		const header = document.createElement('div');
		header.className = 'gw-nodes-header';
		header.textContent = 'Nodes \u2014 Paired Devices';
		this.container.appendChild(header);

		// Cards
		this.renderCards(MOCK_NODES);
	}

	override async setInput(
		input: NodesEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		// Future: fetch live node list from OpenClaw RPC here
	}

	override layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
	}

	override focus(): void {
		this.container?.focus();
	}

	// -- rendering -----------------------------------------------------------

	private renderCards(nodes: NodeRow[]): void {
		const grid = document.createElement('div');
		grid.className = 'gw-nodes-grid';

		for (const node of nodes) {
			const card = document.createElement('div');
			card.className = 'gw-nodes-card';

			// Card header row: status dot + name
			const cardHeader = document.createElement('div');
			cardHeader.className = 'gw-nodes-card-header';

			const statusDot = document.createElement('span');
			statusDot.className = `gw-nodes-status-dot ${node.connected ? 'connected' : 'disconnected'}`;
			cardHeader.appendChild(statusDot);

			const name = document.createElement('span');
			name.className = 'gw-nodes-name';
			name.textContent = node.displayName;
			cardHeader.appendChild(name);

			card.appendChild(cardHeader);

			// Platform badge
			const platformBadge = document.createElement('span');
			platformBadge.className = 'gw-nodes-platform';
			platformBadge.textContent = PLATFORM_LABELS[node.platform] ?? node.platform;
			card.appendChild(platformBadge);

			// Capabilities tags
			const capsRow = document.createElement('div');
			capsRow.className = 'gw-nodes-caps';
			for (const cap of node.caps) {
				const tag = document.createElement('span');
				tag.className = 'gw-nodes-cap-tag';
				tag.textContent = cap;
				capsRow.appendChild(tag);
			}
			card.appendChild(capsRow);

			grid.appendChild(card);
		}

		this.container.appendChild(grid);
	}
}

// ---------------------------------------------------------------------------
// Scoped styles
// ---------------------------------------------------------------------------

const NODES_EDITOR_STYLES = `
	.gw-nodes-root {
		background: #0d0d1a;
		color: #e0e0e0;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		overflow-y: auto;
		padding: 24px;
		box-sizing: border-box;
	}

	.gw-nodes-header {
		color: #00d4ff;
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid #2a2a3e;
		letter-spacing: 0.3px;
	}

	.gw-nodes-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 16px;
	}

	.gw-nodes-card {
		background: #13132a;
		border: 1px solid #2a2a3e;
		border-radius: 8px;
		padding: 16px;
		transition: border-color 0.15s, background 0.15s;
	}

	.gw-nodes-card:hover {
		border-color: #00d4ff44;
		background: #16163a;
	}

	.gw-nodes-card-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.gw-nodes-status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.gw-nodes-status-dot.connected {
		background: #4caf50;
		box-shadow: 0 0 6px #4caf5066;
	}

	.gw-nodes-status-dot.disconnected {
		background: #666;
	}

	.gw-nodes-name {
		font-size: 14px;
		font-weight: 600;
		color: #e0e0e0;
	}

	.gw-nodes-platform {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 500;
		color: #00d4ff;
		background: #00d4ff14;
		border: 1px solid #00d4ff33;
		margin-bottom: 12px;
	}

	.gw-nodes-caps {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.gw-nodes-cap-tag {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 500;
		color: #a0a0b0;
		background: #ffffff0a;
		border: 1px solid #ffffff14;
	}
`;
