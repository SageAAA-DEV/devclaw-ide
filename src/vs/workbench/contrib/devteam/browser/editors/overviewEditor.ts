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
import { IGatewayRpcService } from '../../browser/gatewayRpcService.js';
import { GatewayHealthResult } from '../../common/gatewayTypes.js';

// ---------------------------------------------------------------------------
// Types
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

	readonly resource = URI.from({ scheme: 'devclaw-overview', path: 'default' });

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

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
		@IGatewayRpcService private readonly rpcService: IGatewayRpcService,
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

		// Loading state
		const loading = document.createElement('div');
		loading.className = 'gw-loading';
		loading.textContent = 'Loading...';
		this.container.appendChild(loading);

		// Fetch live data
		this._loadLiveData();
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

	// -- live data -----------------------------------------------------------

	private async _loadLiveData(): Promise<void> {
		try {
			// Actual health payload: { ok, ts, channels: {}, channelOrder: [], heartbeatSeconds,
			//   defaultAgentId, agents: [{ agentId, isDefault, sessions: { count, recent } }],
			//   sessions: { count, recent } }
			const health = await this.rpcService.call<GatewayHealthResult>('health', {});
			const healthPayload = health as unknown as Record<string, unknown>;

			// Best-effort status call — may not exist on all gateways
			let status: Record<string, unknown> = {};
			try {
				status = await this.rpcService.call<Record<string, unknown>>('status', {});
			} catch { /* status endpoint not available */ }

			// Format uptime from seconds to "Xh Ym"
			let uptimeStr = '0h 0m';
			if (health.uptime !== undefined && health.uptime > 0) {
				const hours = Math.floor(health.uptime / 3600);
				const minutes = Math.floor((health.uptime % 3600) / 60);
				uptimeStr = `${hours}h ${minutes}m`;
			}

			// Extract agents array — health response uses { agentId } (not { id })
			const agentsList = Array.isArray(healthPayload.agents) ? healthPayload.agents : [];
			// Extract sessions — { count, recent }
			const sessionsObj = healthPayload.sessions as { count?: number } | undefined;
			// Extract channels — object map, count = number of keys
			const channelsObj = healthPayload.channels as Record<string, unknown> | undefined;

			const liveData: OverviewData = {
				status: health.ok ? 'healthy' : 'down',
				version: health.version ?? (typeof status.version === 'string' ? status.version : 'unknown'),
				uptime: uptimeStr,
				activeAgents: agentsList.length || (typeof status.agents === 'number' ? status.agents : 0),
				activeSessions: sessionsObj?.count ?? (typeof status.sessions === 'number' ? status.sessions : 0),
				connectedChannels: channelsObj ? Object.keys(channelsObj).length : 0,
				pairedNodes: typeof status.nodes === 'number' ? status.nodes : 0,
				skillsLoaded: typeof status.skills === 'number' ? status.skills : 0,
				toolsAvailable: typeof status.tools === 'number' ? status.tools : 0,
				tokensToday: typeof status.tokensToday === 'number' ? status.tokensToday : 0,
				messagesToday: typeof status.messagesToday === 'number' ? status.messagesToday : 0,
			};

			// Clear container and re-render with live data
			while (this.container.firstChild) {
				this.container.removeChild(this.container.firstChild);
			}

			const style = document.createElement('style');
			style.textContent = OVERVIEW_EDITOR_STYLES;
			this.container.appendChild(style);

			const header = document.createElement('div');
			header.className = 'gw-overview-header';
			header.textContent = 'Overview \u2014 OpenClaw Gateway';
			this.container.appendChild(header);

			this.renderStatusBar(liveData);
			this.renderGrid(liveData);
		} catch (err) {
			// Clear container and show error
			while (this.container.firstChild) {
				this.container.removeChild(this.container.firstChild);
			}

			const style = document.createElement('style');
			style.textContent = OVERVIEW_EDITOR_STYLES;
			this.container.appendChild(style);

			const header = document.createElement('div');
			header.className = 'gw-overview-header';
			header.textContent = 'Overview \u2014 OpenClaw Gateway';
			this.container.appendChild(header);

			const error = document.createElement('div');
			error.className = 'gw-error';
			const isConnectionError = err instanceof Error && (err.message.includes('WebSocket') || err.message.includes('ECONNREFUSED') || err.message.includes('not connected'));
			error.textContent = isConnectionError ? 'Unable to connect to gateway' : 'Gateway health data unavailable';
			this.container.appendChild(error);
		}
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
		background: #0f1a1e;
		color: #e0e0e0;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		overflow-y: auto;
		padding: 24px;
		box-sizing: border-box;
	}

	.gw-overview-header {
		color: #e85555;
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid #2a3a3e;
		letter-spacing: 0.3px;
	}

	.gw-overview-status-bar {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 24px;
		padding: 12px 16px;
		background: #12122a;
		border: 1px solid #2a3a3e;
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
		border: 1px solid #2a3a3e;
		border-radius: 8px;
		padding: 20px;
		transition: border-color 0.15s, background 0.15s;
		position: relative;
	}

	.gw-overview-card:hover {
		border-color: #e8555544;
		background: #e8555508;
	}

	.gw-overview-card-icon {
		font-size: 18px;
		display: block;
		margin-bottom: 8px;
	}

	.gw-overview-card-value {
		font-size: 28px;
		font-weight: 700;
		color: #e85555;
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

	.gw-loading, .gw-error {
		padding: 32px;
		text-align: center;
		font-size: 13px;
	}
	.gw-loading { color: #808080; }
	.gw-error { color: #f44336; }
`;
