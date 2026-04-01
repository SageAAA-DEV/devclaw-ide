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

interface LogEntry {
	timestamp: string;
	level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR';
	message: string;
}

// ---------------------------------------------------------------------------
// EditorInput — the "identity" of the tab
// ---------------------------------------------------------------------------

export class LogsEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.logsEditor';

	readonly resource = URI.from({ scheme: 'devclaw-logs', path: 'default' });

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override get typeId(): string { return LogsEditorInput.ID; }

	override getName(): string { return 'Logs'; }

	override matches(other: unknown): boolean {
		return other instanceof LogsEditorInput;
	}
}

// ---------------------------------------------------------------------------
// EditorPane — renders into the main editor area
// ---------------------------------------------------------------------------

export class LogsEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.logsEditor';

	private container!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IGatewayRpcService private readonly rpcService: IGatewayRpcService,
	) {
		super(LogsEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// -- lifecycle -----------------------------------------------------------

	protected createEditor(parent: HTMLElement): void {
		this.container = document.createElement('div');
		this.container.className = 'gw-logs-root';
		parent.appendChild(this.container);

		// Inject scoped styles
		const style = document.createElement('style');
		style.textContent = LOGS_EDITOR_STYLES;
		this.container.appendChild(style);

		// Header
		const header = document.createElement('div');
		header.className = 'gw-logs-header';
		header.textContent = 'Logs \u2014 OpenClaw Gateway';
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
		input: LogsEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		// Future: stream live logs from OpenClaw RPC here
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
			// Gateway rejects unexpected params — call with empty object
			const result = await this.rpcService.call<{
				entries?: Array<{ timestamp?: string; level?: string; message?: string }>;
				lines?: Array<string>;
			}>('logs.tail', {});

			// Handle both structured entries and plain string lines
			let liveEntries: LogEntry[];
			if (result.entries && Array.isArray(result.entries)) {
				liveEntries = result.entries.map(e => ({
					timestamp: e.timestamp ?? new Date().toISOString(),
					level: (e.level?.toUpperCase() as LogEntry['level']) || 'INFO',
					message: e.message ?? '',
				}));
			} else if (result.lines && Array.isArray(result.lines)) {
				liveEntries = result.lines.map(line => ({
					timestamp: new Date().toISOString(),
					level: 'INFO' as const,
					message: typeof line === 'string' ? line : String(line),
				}));
			} else {
				liveEntries = [];
			}

			// Clear container and re-render with live data
			while (this.container.firstChild) {
				this.container.removeChild(this.container.firstChild);
			}

			const style = document.createElement('style');
			style.textContent = LOGS_EDITOR_STYLES;
			this.container.appendChild(style);

			const header = document.createElement('div');
			header.className = 'gw-logs-header';
			header.textContent = 'Logs \u2014 OpenClaw Gateway';
			this.container.appendChild(header);

			if (liveEntries.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'gw-loading';
				empty.textContent = 'No log entries available';
				this.container.appendChild(empty);
			} else {
				this.renderLogOutput(liveEntries);
			}
		} catch (err) {
			// Clear container and show error
			while (this.container.firstChild) {
				this.container.removeChild(this.container.firstChild);
			}

			const style = document.createElement('style');
			style.textContent = LOGS_EDITOR_STYLES;
			this.container.appendChild(style);

			const header = document.createElement('div');
			header.className = 'gw-logs-header';
			header.textContent = 'Logs \u2014 OpenClaw Gateway';
			this.container.appendChild(header);

			const error = document.createElement('div');
			error.className = 'gw-error';
			const isConnectionError = err instanceof Error && (err.message.includes('WebSocket') || err.message.includes('ECONNREFUSED') || err.message.includes('not connected'));
			error.textContent = isConnectionError ? 'Unable to connect to gateway' : 'Log data unavailable';
			this.container.appendChild(error);
		}
	}

	// -- rendering -----------------------------------------------------------

	private renderLogOutput(entries: LogEntry[]): void {
		const output = document.createElement('div');
		output.className = 'gw-logs-output';

		for (const entry of entries) {
			const line = document.createElement('div');
			line.className = 'gw-logs-line';

			// Timestamp
			const timestamp = document.createElement('span');
			timestamp.className = 'gw-logs-timestamp';
			timestamp.textContent = `[${entry.timestamp}]`;
			line.appendChild(timestamp);

			// Level badge
			const level = document.createElement('span');
			level.className = `gw-logs-level gw-logs-level-${entry.level.toLowerCase()}`;
			level.textContent = `[${entry.level}]`;
			line.appendChild(level);

			// Message
			const message = document.createElement('span');
			message.className = 'gw-logs-message';
			message.textContent = ` ${entry.message}`;
			line.appendChild(message);

			output.appendChild(line);
		}

		this.container.appendChild(output);
	}
}

// ---------------------------------------------------------------------------
// Scoped styles
// ---------------------------------------------------------------------------

const LOGS_EDITOR_STYLES = `
	.gw-logs-root {
		background: #0d0d1a;
		color: #e0e0e0;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		overflow-y: auto;
		padding: 24px;
		box-sizing: border-box;
	}

	.gw-logs-header {
		color: #00d4ff;
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid #2a2a3e;
		letter-spacing: 0.3px;
	}

	.gw-logs-output {
		background: #0a0a14;
		border: 1px solid #1a1a2e;
		border-radius: 6px;
		padding: 16px;
		overflow-y: auto;
	}

	.gw-logs-line {
		padding: 3px 0;
		font-size: 13px;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.gw-logs-timestamp {
		color: #555570;
	}

	.gw-logs-level {
		margin-left: 4px;
		font-weight: 600;
	}

	.gw-logs-level-info {
		color: #808080;
	}

	.gw-logs-level-debug {
		color: #00bcd4;
	}

	.gw-logs-level-warn {
		color: #ffb300;
	}

	.gw-logs-level-error {
		color: #f44336;
	}

	.gw-logs-message {
		color: #c0c0c0;
	}

	.gw-loading, .gw-error {
		padding: 32px;
		text-align: center;
		font-size: 13px;
	}
	.gw-loading { color: #808080; }
	.gw-error { color: #f44336; }
`;
