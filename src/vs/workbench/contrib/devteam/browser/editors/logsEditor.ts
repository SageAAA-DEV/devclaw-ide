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

interface LogEntry {
	timestamp: string;
	level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR';
	message: string;
}

const MOCK_LOG_ENTRIES: LogEntry[] = [
	{ timestamp: '2026-04-01 09:00:01', level: 'INFO', message: 'Gateway started on port 18789' },
	{ timestamp: '2026-04-01 09:00:02', level: 'INFO', message: "Agent 'main' loaded (claude-sonnet-4)" },
	{ timestamp: '2026-04-01 09:00:03', level: 'INFO', message: 'Skills loaded: 12 active, 3 disabled' },
	{ timestamp: '2026-04-01 09:00:05', level: 'INFO', message: 'WhatsApp connected (account: default)' },
	{ timestamp: '2026-04-01 09:00:05', level: 'INFO', message: 'Telegram connected (account: default)' },
	{ timestamp: '2026-04-01 09:01:15', level: 'INFO', message: 'Chat: main session started' },
	{ timestamp: '2026-04-01 09:01:18', level: 'DEBUG', message: 'Tool call: web_search("latest news")' },
	{ timestamp: '2026-04-01 09:01:22', level: 'INFO', message: 'Chat: response sent (1.2k tokens)' },
	{ timestamp: '2026-04-01 09:05:00', level: 'WARN', message: 'Rate limit approaching (80%)' },
	{ timestamp: '2026-04-01 09:10:00', level: 'INFO', message: 'Heartbeat: all systems normal' },
];

// ---------------------------------------------------------------------------
// EditorInput — the "identity" of the tab
// ---------------------------------------------------------------------------

export class LogsEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.logsEditor';

	readonly resource = undefined;

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

		// Log output
		this.renderLogOutput(MOCK_LOG_ENTRIES);
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
`;
