/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorInputCapabilities, Verbosity } from '../../../../common/editor.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { URI } from '../../../../../base/common/uri.js';

// ---------------------------------------------------------------------------
// SessionsEditorInput
// ---------------------------------------------------------------------------

export class SessionsEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.sessionsEditor';

	override get typeId(): string {
		return SessionsEditorInput.ID;
	}

	override get resource(): URI | undefined {
		return undefined;
	}

	override getName(): string {
		return 'Sessions';
	}

	override getTitle(_verbosity?: Verbosity): string {
		return 'Sessions';
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override matches(other: EditorInput | unknown): boolean {
		return other instanceof SessionsEditorInput;
	}
}

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

interface SessionEntry {
	sessionKey: string;
	agentId: string;
	model: string;
	totalTokens: number;
	contextTokens: number;
	updatedAt: number;
}

function getMockSessions(): SessionEntry[] {
	return [
		{ sessionKey: 'main', agentId: 'main', model: 'claude-sonnet-4', totalTokens: 45000, contextTokens: 200000, updatedAt: Date.now() },
		{ sessionKey: 'whatsapp:user1', agentId: 'main', model: 'gpt-4o', totalTokens: 12000, contextTokens: 128000, updatedAt: Date.now() - 3600000 },
		{ sessionKey: 'telegram:dev', agentId: 'coder', model: 'claude-sonnet-4', totalTokens: 89000, contextTokens: 200000, updatedAt: Date.now() - 7200000 },
	];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) {
		return 'just now';
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function formatTokens(n: number): string {
	if (n >= 1000) {
		return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
	}
	return String(n);
}

// ---------------------------------------------------------------------------
// Styles (injected once)
// ---------------------------------------------------------------------------

const STYLES = `
.gw-sessions-root {
	background: #0d0d1a;
	color: #e0e0e0;
	height: 100%;
	overflow-y: auto;
	padding: 24px 32px;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	box-sizing: border-box;
}

.gw-sessions-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 24px;
}

.gw-sessions-title {
	font-size: 20px;
	font-weight: 600;
	color: #ffffff;
}

.gw-sessions-badge {
	background: rgba(0, 212, 255, 0.15);
	color: #00d4ff;
	font-size: 12px;
	padding: 2px 10px;
	border-radius: 12px;
	font-weight: 500;
}

.gw-sessions-table {
	width: 100%;
	border-collapse: collapse;
}

.gw-sessions-table th {
	text-align: left;
	padding: 10px 12px;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: #888;
	border-bottom: 1px solid #1a1a2e;
}

.gw-sessions-table td {
	padding: 12px;
	font-size: 13px;
	border-bottom: 1px solid #12122a;
	vertical-align: middle;
}

.gw-sessions-table tr:hover td {
	background: rgba(0, 212, 255, 0.04);
}

.gw-sessions-key {
	color: #00d4ff;
	font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
	font-size: 12px;
}

.gw-sessions-model {
	color: #a0a0c0;
	font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
	font-size: 12px;
}

.gw-sessions-tokens-cell {
	display: flex;
	align-items: center;
	gap: 10px;
}

.gw-sessions-token-bar-bg {
	width: 80px;
	height: 6px;
	background: #1a1a2e;
	border-radius: 3px;
	overflow: hidden;
	flex-shrink: 0;
}

.gw-sessions-token-bar-fill {
	height: 100%;
	border-radius: 3px;
	transition: width 0.3s ease;
}

.gw-sessions-token-label {
	white-space: nowrap;
	font-size: 12px;
	color: #a0a0c0;
}

.gw-sessions-time {
	color: #666;
	font-size: 12px;
}

.gw-sessions-empty {
	text-align: center;
	color: #555;
	padding: 48px 0;
	font-size: 14px;
}
`;

let stylesInjected = false;

function ensureStyles(doc: Document): void {
	if (stylesInjected) {
		return;
	}
	const style = doc.createElement('style');
	style.textContent = STYLES;
	doc.head.appendChild(style);
	stylesInjected = true;
}

// ---------------------------------------------------------------------------
// SessionsEditorPane
// ---------------------------------------------------------------------------

export class SessionsEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.sessionsEditor';

	private container: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super('sessionsEditor', group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		ensureStyles(parent.ownerDocument);

		this.container = parent.ownerDocument.createElement('div');
		this.container.className = 'gw-sessions-root';
		parent.appendChild(this.container);

		this.renderContent();
	}

	override async setInput(
		input: SessionsEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		this.renderContent();
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

	// -----------------------------------------------------------------------
	// Rendering
	// -----------------------------------------------------------------------

	private renderContent(): void {
		if (!this.container) {
			return;
		}

		const sessions = getMockSessions();
		const doc = this.container.ownerDocument;

		// Clear existing content safely
		while (this.container.firstChild) {
			this.container.removeChild(this.container.firstChild);
		}

		// Header
		const header = doc.createElement('div');
		header.className = 'gw-sessions-header';

		const title = doc.createElement('div');
		title.className = 'gw-sessions-title';
		title.textContent = 'Sessions';
		header.appendChild(title);

		const badge = doc.createElement('span');
		badge.className = 'gw-sessions-badge';
		badge.textContent = `${sessions.length} active`;
		header.appendChild(badge);

		this.container.appendChild(header);

		if (sessions.length === 0) {
			const empty = doc.createElement('div');
			empty.className = 'gw-sessions-empty';
			empty.textContent = 'No active sessions';
			this.container.appendChild(empty);
			return;
		}

		// Table
		const table = doc.createElement('table');
		table.className = 'gw-sessions-table';

		// Thead
		const thead = doc.createElement('thead');
		const headRow = doc.createElement('tr');
		for (const col of ['Session Key', 'Agent', 'Model', 'Tokens', 'Last Active']) {
			const th = doc.createElement('th');
			th.textContent = col;
			headRow.appendChild(th);
		}
		thead.appendChild(headRow);
		table.appendChild(thead);

		// Tbody
		const tbody = doc.createElement('tbody');
		for (const session of sessions) {
			const tr = doc.createElement('tr');

			// Session Key
			const tdKey = doc.createElement('td');
			const keySpan = doc.createElement('span');
			keySpan.className = 'gw-sessions-key';
			keySpan.textContent = session.sessionKey;
			tdKey.appendChild(keySpan);
			tr.appendChild(tdKey);

			// Agent
			const tdAgent = doc.createElement('td');
			tdAgent.textContent = session.agentId;
			tr.appendChild(tdAgent);

			// Model
			const tdModel = doc.createElement('td');
			const modelSpan = doc.createElement('span');
			modelSpan.className = 'gw-sessions-model';
			modelSpan.textContent = session.model;
			tdModel.appendChild(modelSpan);
			tr.appendChild(tdModel);

			// Tokens (bar + label)
			const tdTokens = doc.createElement('td');
			const tokensWrap = doc.createElement('div');
			tokensWrap.className = 'gw-sessions-tokens-cell';

			const barBg = doc.createElement('div');
			barBg.className = 'gw-sessions-token-bar-bg';
			const barFill = doc.createElement('div');
			barFill.className = 'gw-sessions-token-bar-fill';
			const pct = Math.min((session.totalTokens / session.contextTokens) * 100, 100);
			barFill.style.width = `${pct}%`;
			// Color gradient: cyan < 50%, orange 50-80%, red > 80%
			if (pct < 50) {
				barFill.style.background = '#00d4ff';
			} else if (pct < 80) {
				barFill.style.background = '#f0a030';
			} else {
				barFill.style.background = '#ff4060';
			}
			barBg.appendChild(barFill);
			tokensWrap.appendChild(barBg);

			const label = doc.createElement('span');
			label.className = 'gw-sessions-token-label';
			label.textContent = `${formatTokens(session.totalTokens)} / ${formatTokens(session.contextTokens)}`;
			tokensWrap.appendChild(label);

			tdTokens.appendChild(tokensWrap);
			tr.appendChild(tdTokens);

			// Last Active
			const tdTime = doc.createElement('td');
			const timeSpan = doc.createElement('span');
			timeSpan.className = 'gw-sessions-time';
			timeSpan.textContent = formatRelativeTime(session.updatedAt);
			tdTime.appendChild(timeSpan);
			tr.appendChild(tdTime);

			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		this.container.appendChild(table);
	}
}
