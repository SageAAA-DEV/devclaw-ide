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

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface CronJobRow {
	jobId: string;
	schedule: string;
	agentId: string;
	lastRun: number;
	enabled: boolean;
}

// ---------------------------------------------------------------------------
// EditorInput — the "identity" of the tab
// ---------------------------------------------------------------------------

export class CronEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.cronEditor';

	readonly resource = URI.from({ scheme: 'devclaw-cron', path: 'default' });

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override get typeId(): string { return CronEditorInput.ID; }

	override getName(): string { return 'Cron Jobs'; }

	override matches(other: unknown): boolean {
		return other instanceof CronEditorInput;
	}
}

// ---------------------------------------------------------------------------
// EditorPane — renders into the main editor area
// ---------------------------------------------------------------------------

export class CronEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.cronEditor';

	private container!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IGatewayRpcService private readonly rpcService: IGatewayRpcService,
	) {
		super(CronEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// -- lifecycle -----------------------------------------------------------

	protected createEditor(parent: HTMLElement): void {
		this.container = document.createElement('div');
		this.container.className = 'gw-cron-root';
		parent.appendChild(this.container);

		// Inject scoped styles
		const style = document.createElement('style');
		style.textContent = CRON_EDITOR_STYLES;
		this.container.appendChild(style);

		// Header
		const header = document.createElement('div');
		header.className = 'gw-cron-header';
		header.textContent = 'Cron Jobs \u2014 OpenClaw Gateway';
		this.container.appendChild(header);

		// Loading state
		const loading = document.createElement('div');
		loading.className = 'gw-loading';
		loading.textContent = 'Loading...';
		this.container.appendChild(loading);

		// Kick off live data fetch
		this._loadLiveData();
	}

	private _clearContainer(): void {
		while (this.container.firstChild) {
			this.container.removeChild(this.container.firstChild);
		}
	}

	private _renderChrome(): void {
		const style = document.createElement('style');
		style.textContent = CRON_EDITOR_STYLES;
		this.container.appendChild(style);

		const header = document.createElement('div');
		header.className = 'gw-cron-header';
		header.textContent = 'Cron Jobs \u2014 OpenClaw Gateway';
		this.container.appendChild(header);
	}

	private async _loadLiveData(): Promise<void> {
		try {
			const result = await this.rpcService.call<{ jobs: Array<{ id?: string; jobId?: string; schedule: string; agentId?: string; lastRun?: number; enabled?: boolean }> }>('cron.list', {});
			const jobs: CronJobRow[] = result.jobs.map(j => ({
				jobId: j.jobId ?? j.id ?? 'unknown',
				schedule: j.schedule,
				agentId: j.agentId ?? 'main',
				lastRun: j.lastRun ?? Date.now(),
				enabled: j.enabled ?? true,
			}));

			this._clearContainer();
			this._renderChrome();
			this.renderTable(jobs);
		} catch {
			this._clearContainer();
			this._renderChrome();

			const error = document.createElement('div');
			error.className = 'gw-error';
			error.textContent = 'Unable to connect to gateway';
			this.container.appendChild(error);
		}
	}

	override async setInput(
		input: CronEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		// Future: fetch live cron job list from OpenClaw RPC here
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

	// -- helpers -------------------------------------------------------------

	private formatRelativeTime(timestamp: number): string {
		const diff = Date.now() - timestamp;
		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) { return `${days}d ago`; }
		if (hours > 0) { return `${hours}h ago`; }
		if (minutes > 0) { return `${minutes}m ago`; }
		return `${seconds}s ago`;
	}

	// -- rendering -----------------------------------------------------------

	private renderTable(jobs: CronJobRow[]): void {
		const table = document.createElement('table');
		table.className = 'gw-cron-table';

		// Header row
		const thead = document.createElement('thead');
		const headerRow = document.createElement('tr');
		for (const col of ['Job ID', 'Schedule', 'Agent', 'Last Run', 'Enabled']) {
			const th = document.createElement('th');
			th.className = 'gw-cron-th';
			th.textContent = col;
			headerRow.appendChild(th);
		}
		thead.appendChild(headerRow);
		table.appendChild(thead);

		// Body rows
		const tbody = document.createElement('tbody');
		for (const job of jobs) {
			const tr = document.createElement('tr');
			tr.className = 'gw-cron-row';

			// Job ID cell
			const tdJobId = document.createElement('td');
			tdJobId.className = 'gw-cron-td';
			tdJobId.textContent = job.jobId;
			tr.appendChild(tdJobId);

			// Schedule cell (monospace)
			const tdSchedule = document.createElement('td');
			tdSchedule.className = 'gw-cron-td gw-cron-schedule';
			tdSchedule.textContent = job.schedule;
			tr.appendChild(tdSchedule);

			// Agent cell
			const tdAgent = document.createElement('td');
			tdAgent.className = 'gw-cron-td';
			tdAgent.textContent = job.agentId;
			tr.appendChild(tdAgent);

			// Last Run cell (relative time)
			const tdLastRun = document.createElement('td');
			tdLastRun.className = 'gw-cron-td gw-cron-lastrun';
			tdLastRun.textContent = this.formatRelativeTime(job.lastRun);
			tr.appendChild(tdLastRun);

			// Enabled cell (ON/OFF badge)
			const tdEnabled = document.createElement('td');
			tdEnabled.className = 'gw-cron-td';
			const badge = document.createElement('span');
			badge.className = `gw-cron-badge ${job.enabled ? 'on' : 'off'}`;
			badge.textContent = job.enabled ? 'ON' : 'OFF';
			tdEnabled.appendChild(badge);
			tr.appendChild(tdEnabled);

			tbody.appendChild(tr);
		}
		table.appendChild(tbody);

		this.container.appendChild(table);
	}
}

// ---------------------------------------------------------------------------
// Scoped styles
// ---------------------------------------------------------------------------

const CRON_EDITOR_STYLES = `
	.gw-cron-root {
		background: #0d0d1a;
		color: #e0e0e0;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		overflow-y: auto;
		padding: 24px;
		box-sizing: border-box;
	}

	.gw-cron-header {
		color: #00d4ff;
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid #2a2a3e;
		letter-spacing: 0.3px;
	}

	.gw-cron-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	.gw-cron-th {
		text-align: left;
		color: #808080;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		padding: 8px 12px;
		border-bottom: 1px solid #2a2a3e;
	}

	.gw-cron-row {
		transition: background 0.15s;
	}

	.gw-cron-row:hover {
		background: #00d4ff08;
	}

	.gw-cron-td {
		padding: 10px 12px;
		border-bottom: 1px solid #1a1a2e;
		color: #e0e0e0;
	}

	.gw-cron-schedule {
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		color: #00d4ff;
		font-size: 12px;
	}

	.gw-cron-lastrun {
		color: #808080;
		font-size: 12px;
	}

	.gw-cron-badge {
		display: inline-block;
		padding: 2px 10px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
	}

	.gw-cron-badge.on {
		background: #4caf5022;
		color: #4caf50;
		border: 1px solid #4caf5044;
	}

	.gw-cron-badge.off {
		background: #f4433622;
		color: #f44336;
		border: 1px solid #f4433644;
	}

	.gw-loading, .gw-error {
		padding: 32px;
		text-align: center;
		font-size: 13px;
	}
	.gw-loading { color: #808080; }
	.gw-error { color: #f44336; }
`;
