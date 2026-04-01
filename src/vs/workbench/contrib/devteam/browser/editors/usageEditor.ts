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
// Types
// ---------------------------------------------------------------------------

interface ProviderUsage {
	provider: string;
	tokens: number;
	cost: number;
}

interface DailyUsage {
	date: string;
	tokens: number;
	messages: number;
}

interface UsageData {
	totalTokens: number;
	totalCost: number;
	byProvider: ProviderUsage[];
	daily: DailyUsage[];
}

// ---------------------------------------------------------------------------
// EditorInput — the "identity" of the tab
// ---------------------------------------------------------------------------

export class UsageEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.usageEditor';

	readonly resource = URI.from({ scheme: 'devclaw-usage', path: 'default' });

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override get typeId(): string { return UsageEditorInput.ID; }

	override getName(): string { return 'Usage'; }

	override matches(other: unknown): boolean {
		return other instanceof UsageEditorInput;
	}
}

// ---------------------------------------------------------------------------
// EditorPane — renders into the main editor area
// ---------------------------------------------------------------------------

export class UsageEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.usageEditor';

	private container!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IGatewayRpcService private readonly rpcService: IGatewayRpcService,
	) {
		super(UsageEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// -- lifecycle -----------------------------------------------------------

	protected createEditor(parent: HTMLElement): void {
		this.container = document.createElement('div');
		this.container.className = 'gw-usage-root';
		parent.appendChild(this.container);

		// Inject scoped styles
		const style = document.createElement('style');
		style.textContent = USAGE_EDITOR_STYLES;
		this.container.appendChild(style);

		// Header
		const header = document.createElement('div');
		header.className = 'gw-usage-header';
		header.textContent = 'Usage \u2014 OpenClaw Gateway';
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
		input: UsageEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		// Future: fetch live usage data from OpenClaw RPC here
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
			// usage.status may fail with AbortError on some gateway instances — handle gracefully
			let usageResult: { totalTokens?: number; totalCost?: number; providers?: Array<{ provider: string; tokens: number; cost: number }> } | null = null;
			try {
				usageResult = await this.rpcService.call<{
					totalTokens?: number;
					totalCost?: number;
					providers?: Array<{ provider: string; tokens: number; cost: number }>;
				}>('usage.status', {});
			} catch {
				// usage.status not available on this gateway
			}

			let timeseries: Array<{ date: string; tokens: number; messages?: number }> = [];
			try {
				const tsResult = await this.rpcService.call<{
					timeseries?: Array<{ date: string; tokens: number; messages?: number }>;
				}>('sessions.usage.timeseries', {});
				timeseries = tsResult.timeseries || [];
			} catch {
				// timeseries call failed independently — proceed without it
			}

			// If neither RPC succeeded, show unavailable message
			if (!usageResult && timeseries.length === 0) {
				this._renderUnavailable('Usage data unavailable');
				return;
			}

			const liveData: UsageData = {
				totalTokens: usageResult?.totalTokens ?? 0,
				totalCost: usageResult?.totalCost ?? 0,
				byProvider: (usageResult?.providers || []).map(p => ({
					provider: p.provider,
					tokens: p.tokens,
					cost: p.cost,
				})),
				daily: timeseries.map(t => ({
					date: t.date,
					tokens: t.tokens,
					messages: t.messages ?? 0,
				})),
			};

			// Clear container and re-render with live data
			while (this.container.firstChild) {
				this.container.removeChild(this.container.firstChild);
			}

			const style = document.createElement('style');
			style.textContent = USAGE_EDITOR_STYLES;
			this.container.appendChild(style);

			const header = document.createElement('div');
			header.className = 'gw-usage-header';
			header.textContent = 'Usage \u2014 OpenClaw Gateway';
			this.container.appendChild(header);

			this.renderTotals(liveData);
			this.renderProviderBars(liveData);
			this.renderDailyTable(liveData);
		} catch (err) {
			const isConnectionError = err instanceof Error && (err.message.includes('WebSocket') || err.message.includes('ECONNREFUSED') || err.message.includes('not connected'));
			this._renderUnavailable(isConnectionError ? 'Unable to connect to gateway' : 'Usage data unavailable');
		}
	}

	private _renderUnavailable(message: string): void {
		// Clear container and show message
		while (this.container.firstChild) {
			this.container.removeChild(this.container.firstChild);
		}

		const style = document.createElement('style');
		style.textContent = USAGE_EDITOR_STYLES;
		this.container.appendChild(style);

		const header = document.createElement('div');
		header.className = 'gw-usage-header';
		header.textContent = 'Usage \u2014 OpenClaw Gateway';
		this.container.appendChild(header);

		const error = document.createElement('div');
		error.className = 'gw-error';
		error.textContent = message;
		this.container.appendChild(error);
	}

	// -- helpers -------------------------------------------------------------

	private formatTokens(tokens: number): string {
		if (tokens >= 1000000) { return `${(tokens / 1000000).toFixed(2)}M`; }
		if (tokens >= 1000) { return `${(tokens / 1000).toFixed(1)}K`; }
		return tokens.toString();
	}

	// -- rendering -----------------------------------------------------------

	private renderTotals(data: UsageData): void {
		const totals = document.createElement('div');
		totals.className = 'gw-usage-totals';

		// Total tokens card
		const tokensCard = document.createElement('div');
		tokensCard.className = 'gw-usage-card';
		const tokensValue = document.createElement('div');
		tokensValue.className = 'gw-usage-card-value';
		tokensValue.textContent = this.formatTokens(data.totalTokens);
		const tokensLabel = document.createElement('div');
		tokensLabel.className = 'gw-usage-card-label';
		tokensLabel.textContent = 'Total Tokens';
		tokensCard.appendChild(tokensValue);
		tokensCard.appendChild(tokensLabel);
		totals.appendChild(tokensCard);

		// Total cost card
		const costCard = document.createElement('div');
		costCard.className = 'gw-usage-card';
		const costValue = document.createElement('div');
		costValue.className = 'gw-usage-card-value';
		costValue.textContent = `$${data.totalCost.toFixed(2)}`;
		const costLabel = document.createElement('div');
		costLabel.className = 'gw-usage-card-label';
		costLabel.textContent = 'Total Cost';
		costCard.appendChild(costValue);
		costCard.appendChild(costLabel);
		totals.appendChild(costCard);

		this.container.appendChild(totals);
	}

	private renderProviderBars(data: UsageData): void {
		const section = document.createElement('div');
		section.className = 'gw-usage-section';

		const sectionTitle = document.createElement('div');
		sectionTitle.className = 'gw-usage-section-title';
		sectionTitle.textContent = 'By Provider';
		section.appendChild(sectionTitle);

		const maxTokens = Math.max(...data.byProvider.map(p => p.tokens));

		for (const provider of data.byProvider) {
			const row = document.createElement('div');
			row.className = 'gw-usage-bar-row';

			// Provider label
			const label = document.createElement('div');
			label.className = 'gw-usage-bar-label';
			label.textContent = provider.provider;
			row.appendChild(label);

			// Bar container
			const barContainer = document.createElement('div');
			barContainer.className = 'gw-usage-bar-container';
			const bar = document.createElement('div');
			bar.className = 'gw-usage-bar';
			const widthPercent = (provider.tokens / maxTokens) * 100;
			bar.style.width = `${widthPercent}%`;
			barContainer.appendChild(bar);
			row.appendChild(barContainer);

			// Stats
			const stats = document.createElement('div');
			stats.className = 'gw-usage-bar-stats';
			stats.textContent = `${this.formatTokens(provider.tokens)} / $${provider.cost.toFixed(2)}`;
			row.appendChild(stats);

			section.appendChild(row);
		}

		this.container.appendChild(section);
	}

	private renderDailyTable(data: UsageData): void {
		const section = document.createElement('div');
		section.className = 'gw-usage-section';

		const sectionTitle = document.createElement('div');
		sectionTitle.className = 'gw-usage-section-title';
		sectionTitle.textContent = 'Daily Breakdown';
		section.appendChild(sectionTitle);

		const table = document.createElement('table');
		table.className = 'gw-usage-table';

		// Header row
		const thead = document.createElement('thead');
		const headerRow = document.createElement('tr');
		for (const col of ['Date', 'Tokens', 'Messages']) {
			const th = document.createElement('th');
			th.className = 'gw-usage-th';
			th.textContent = col;
			headerRow.appendChild(th);
		}
		thead.appendChild(headerRow);
		table.appendChild(thead);

		// Body rows
		const tbody = document.createElement('tbody');
		for (const day of data.daily) {
			const tr = document.createElement('tr');
			tr.className = 'gw-usage-row';

			const tdDate = document.createElement('td');
			tdDate.className = 'gw-usage-td';
			tdDate.textContent = day.date;
			tr.appendChild(tdDate);

			const tdTokens = document.createElement('td');
			tdTokens.className = 'gw-usage-td';
			tdTokens.textContent = this.formatTokens(day.tokens);
			tr.appendChild(tdTokens);

			const tdMessages = document.createElement('td');
			tdMessages.className = 'gw-usage-td';
			tdMessages.textContent = day.messages.toString();
			tr.appendChild(tdMessages);

			tbody.appendChild(tr);
		}
		table.appendChild(tbody);

		section.appendChild(table);
		this.container.appendChild(section);
	}
}

// ---------------------------------------------------------------------------
// Scoped styles
// ---------------------------------------------------------------------------

const USAGE_EDITOR_STYLES = `
	.gw-usage-root {
		background: #0d0d1a;
		color: #e0e0e0;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		overflow-y: auto;
		padding: 24px;
		box-sizing: border-box;
	}

	.gw-usage-header {
		color: #00d4ff;
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid #2a2a3e;
		letter-spacing: 0.3px;
	}

	.gw-usage-totals {
		display: flex;
		gap: 24px;
		margin-bottom: 32px;
	}

	.gw-usage-card {
		background: #12122a;
		border: 1px solid #2a2a3e;
		border-radius: 8px;
		padding: 24px 32px;
		text-align: center;
		min-width: 180px;
	}

	.gw-usage-card-value {
		font-size: 32px;
		font-weight: 700;
		color: #00d4ff;
		line-height: 1.2;
	}

	.gw-usage-card-label {
		font-size: 12px;
		color: #808080;
		margin-top: 6px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.gw-usage-section {
		margin-bottom: 28px;
	}

	.gw-usage-section-title {
		color: #808080;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 12px;
	}

	.gw-usage-bar-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 10px;
	}

	.gw-usage-bar-label {
		width: 100px;
		font-size: 13px;
		color: #e0e0e0;
		flex-shrink: 0;
	}

	.gw-usage-bar-container {
		flex: 1;
		height: 20px;
		background: #1a1a2e;
		border-radius: 4px;
		overflow: hidden;
	}

	.gw-usage-bar {
		height: 100%;
		background: linear-gradient(90deg, #00d4ff, #0088aa);
		border-radius: 4px;
		transition: width 0.3s ease;
	}

	.gw-usage-bar-stats {
		width: 160px;
		font-size: 12px;
		color: #808080;
		text-align: right;
		flex-shrink: 0;
	}

	.gw-usage-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	.gw-usage-th {
		text-align: left;
		color: #808080;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		padding: 8px 12px;
		border-bottom: 1px solid #2a2a3e;
	}

	.gw-usage-row {
		transition: background 0.15s;
	}

	.gw-usage-row:hover {
		background: #00d4ff08;
	}

	.gw-usage-td {
		padding: 10px 12px;
		border-bottom: 1px solid #1a1a2e;
		color: #e0e0e0;
	}

	.gw-loading, .gw-error {
		padding: 32px;
		text-align: center;
		font-size: 13px;
	}
	.gw-loading { color: #808080; }
	.gw-error { color: #f44336; }
`;
