/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
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

interface OverviewData {
	status: 'healthy' | 'degraded' | 'down';
	version: string;
	uptime: string;
	activeAgents: number;
	activeSessions: number;
	connectedChannels: number;
	pairedNodes: number;
	skillsLoaded: number;
	toolsAvailable: number;
	tokensToday: number;
	messagesToday: number;
}

const MOCK_OVERVIEW: OverviewData = {
	status: 'healthy',
	version: 'v2026.3.2',
	uptime: '4h 32m',
	activeAgents: 2,
	activeSessions: 3,
	connectedChannels: 3,
	pairedNodes: 2,
	skillsLoaded: 12,
	toolsAvailable: 24,
	tokensToday: 420000,
	messagesToday: 38,
};

interface StatCard {
	label: string;
	value: string;
	icon: string;
}

// ---------------------------------------------------------------------------
// EditorInput — the "identity" of the tab
// ---------------------------------------------------------------------------

export class OverviewEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.overviewEditor';

	readonly resource = undefined;

	override get typeId(): string { return OverviewEditorInput.ID; }

	override getName(): string { return 'Overview'; }

	override matches(other: unknown): boolean {
		return other instanceof OverviewEditorInput;
	}
}

// ---------------------------------------------------------------------------
// EditorPane — renders into the main editor area
// ---------------------------------------------------------------------------

export class OverviewEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.overviewEditor';

	private container!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super(OverviewEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// -- lifecycle -----------------------------------------------------------

	protected createEditor(parent: HTMLElement): void {
		this.container = document.createElement('div');
		this.container.className = 'gw-overview-root';
		parent.appendChild(this.container);

		// Inject scoped styles
		const style = document.createElement('style');
		style.textContent = OVERVIEW_EDITOR_STYLES;
		this.container.appendChild(style);

		// Header
		const header = document.createElement('div');
		header.className = 'gw-overview-header';
		header.textContent = 'Overview \u2014 OpenClaw Gateway';
		this.container.appendChild(header);

		// Status bar
		this.renderStatusBar(MOCK_OVERVIEW);

		// Stat cards grid
		this.renderGrid(MOCK_OVERVIEW);
	}

	override async setInput(
		input: OverviewEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		// Future: fetch live overview data from OpenClaw RPC here
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

	private renderStatusBar(data: OverviewData): void {
		const bar = document.createElement('div');
		bar.className = 'gw-overview-status-bar';

		// Status badge
		const badge = document.createElement('span');
		badge.className = `gw-overview-status-badge ${data.status}`;
		badge.textContent = data.status === 'healthy' ? '\u25CF Healthy'
			: data.status === 'degraded' ? '\u25CF Degraded'
				: '\u25CF Down';
		bar.appendChild(badge);

		// Version
		const version = document.createElement('span');
		version.className = 'gw-overview-meta';
		version.textContent = data.version;
		bar.appendChild(version);

		// Uptime
		const uptime = document.createElement('span');
		uptime.className = 'gw-overview-meta';
		uptime.textContent = `Uptime: ${data.uptime}`;
		bar.appendChild(uptime);

		this.container.appendChild(bar);
	}

	private renderGrid(data: OverviewData): void {
		const cards: StatCard[] = [
			{ label: 'Active Agents', value: String(data.activeAgents), icon: '\uD83E\uDD16' },
			{ label: 'Active Sessions', value: String(data.activeSessions), icon: '\uD83D\uDCE1' },
			{ label: 'Connected Channels', value: String(data.connectedChannels), icon: '\uD83D\uDD17' },
			{ label: 'Paired Nodes', value: String(data.pairedNodes), icon: '\uD83D\uDDA5\uFE0F' },
			{ label: 'Skills Loaded', value: String(data.skillsLoaded), icon: '\u2699\uFE0F' },
			{ label: 'Tools Available', value: String(data.toolsAvailable), icon: '\uD83D\uDEE0\uFE0F' },
			{ label: 'Tokens Today', value: data.tokensToday.toLocaleString(), icon: '\uD83D\uDCCA' },
			{ label: 'Messages Today', value: String(data.messagesToday), icon: '\uD83D\uDCAC' },
		];

		const grid = document.createElement('div');
		grid.className = 'gw-overview-grid';

		for (const card of cards) {
			const el = document.createElement('div');
			el.className = 'gw-overview-card';

			const icon = document.createElement('span');
			icon.className = 'gw-overview-card-icon';
			icon.textContent = card.icon;
			el.appendChild(icon);

			const value = document.createElement('div');
			value.className = 'gw-overview-card-value';
			value.textContent = card.value;
			el.appendChild(value);

			const label = document.createElement('div');
			label.className = 'gw-overview-card-label';
			label.textContent = card.label;
			el.appendChild(label);

			grid.appendChild(el);
		}

		this.container.appendChild(grid);
	}
}

// ---------------------------------------------------------------------------
// Scoped styles
// ---------------------------------------------------------------------------

const OVERVIEW_EDITOR_STYLES = `
	.gw-overview-root {
		background: #0d0d1a;
		color: #e0e0e0;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		overflow-y: auto;
		padding: 24px;
		box-sizing: border-box;
	}

	.gw-overview-header {
		color: #00d4ff;
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid #2a2a3e;
		letter-spacing: 0.3px;
	}

	.gw-overview-status-bar {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 24px;
		padding: 12px 16px;
		background: #12122a;
		border: 1px solid #2a2a3e;
		border-radius: 8px;
	}

	.gw-overview-status-badge {
		display: inline-block;
		padding: 4px 14px;
		border-radius: 12px;
		font-size: 12px;
		font-weight: 600;
		text-transform: capitalize;
	}

	.gw-overview-status-badge.healthy {
		background: #4caf5022;
		color: #4caf50;
		border: 1px solid #4caf5044;
	}

	.gw-overview-status-badge.degraded {
		background: #ff980022;
		color: #ff9800;
		border: 1px solid #ff980044;
	}

	.gw-overview-status-badge.down {
		background: #f4433622;
		color: #f44336;
		border: 1px solid #f4433644;
	}

	.gw-overview-meta {
		color: #808080;
		font-size: 12px;
		letter-spacing: 0.3px;
	}

	.gw-overview-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	.gw-overview-card {
		background: #12122a;
		border: 1px solid #2a2a3e;
		border-radius: 8px;
		padding: 20px;
		transition: border-color 0.15s, background 0.15s;
		position: relative;
	}

	.gw-overview-card:hover {
		border-color: #00d4ff44;
		background: #00d4ff08;
	}

	.gw-overview-card-icon {
		font-size: 18px;
		display: block;
		margin-bottom: 8px;
	}

	.gw-overview-card-value {
		font-size: 28px;
		font-weight: 700;
		color: #00d4ff;
		line-height: 1.2;
		margin-bottom: 4px;
	}

	.gw-overview-card-label {
		font-size: 11px;
		font-weight: 600;
		color: #808080;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
`;
