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

interface ChannelRow {
	id: string;
	label: string;
	connected: boolean;
	lastMessageAt: number | null;
}

const MOCK_CHANNELS: ChannelRow[] = [
	{ id: 'whatsapp', label: 'WhatsApp', connected: true, lastMessageAt: Date.now() - 300000 },
	{ id: 'telegram', label: 'Telegram', connected: true, lastMessageAt: Date.now() - 7200000 },
	{ id: 'slack', label: 'Slack', connected: false, lastMessageAt: null },
	{ id: 'discord', label: 'Discord', connected: false, lastMessageAt: null },
	{ id: 'imessage', label: 'iMessage', connected: true, lastMessageAt: Date.now() - 60000 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number | null): string {
	if (timestamp === null) {
		return 'Never';
	}
	const diffMs = Date.now() - timestamp;
	const diffSec = Math.floor(diffMs / 1000);
	if (diffSec < 60) {
		return `${diffSec}s ago`;
	}
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) {
		return `${diffMin}m ago`;
	}
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) {
		return `${diffHr}h ago`;
	}
	const diffDay = Math.floor(diffHr / 24);
	return `${diffDay}d ago`;
}

// ---------------------------------------------------------------------------
// EditorInput — the "identity" of the tab
// ---------------------------------------------------------------------------

export class ChannelsEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.channelsEditor';

	readonly resource = undefined;

	override get typeId(): string { return ChannelsEditorInput.ID; }

	override getName(): string { return 'Channels'; }

	override matches(other: unknown): boolean {
		return other instanceof ChannelsEditorInput;
	}
}

// ---------------------------------------------------------------------------
// EditorPane — renders into the main editor area
// ---------------------------------------------------------------------------

export class ChannelsEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.channelsEditor';

	private container!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super(ChannelsEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// -- lifecycle -----------------------------------------------------------

	protected createEditor(parent: HTMLElement): void {
		this.container = document.createElement('div');
		this.container.className = 'gw-channels-root';
		parent.appendChild(this.container);

		// Inject scoped styles
		const style = document.createElement('style');
		style.textContent = CHANNELS_EDITOR_STYLES;
		this.container.appendChild(style);

		// Header
		const header = document.createElement('div');
		header.className = 'gw-channels-header';
		header.textContent = 'Channels \u2014 Messaging Integrations';
		this.container.appendChild(header);

		// Cards
		this.renderCards(MOCK_CHANNELS);
	}

	override async setInput(
		input: ChannelsEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		// Future: fetch live channel list from OpenClaw RPC here
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

	private renderCards(channels: ChannelRow[]): void {
		const grid = document.createElement('div');
		grid.className = 'gw-channels-grid';

		// Sort: connected first, disconnected last
		const sorted = [...channels].sort((a, b) => {
			if (a.connected === b.connected) {
				return 0;
			}
			return a.connected ? -1 : 1;
		});

		for (const channel of sorted) {
			const card = document.createElement('div');
			card.className = `gw-channels-card ${channel.connected ? 'connected' : 'disconnected'}`;

			// Channel name
			const name = document.createElement('div');
			name.className = 'gw-channels-name';
			name.textContent = channel.label;
			card.appendChild(name);

			// Status badge
			const badge = document.createElement('span');
			badge.className = `gw-channels-badge ${channel.connected ? 'connected' : 'disconnected'}`;
			badge.textContent = channel.connected ? 'Connected' : 'Disconnected';
			card.appendChild(badge);

			// Last message time
			const time = document.createElement('div');
			time.className = 'gw-channels-time';
			time.textContent = `Last message: ${formatRelativeTime(channel.lastMessageAt)}`;
			card.appendChild(time);

			grid.appendChild(card);
		}

		this.container.appendChild(grid);
	}
}

// ---------------------------------------------------------------------------
// Scoped styles
// ---------------------------------------------------------------------------

const CHANNELS_EDITOR_STYLES = `
	.gw-channels-root {
		background: #0d0d1a;
		color: #e0e0e0;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		overflow-y: auto;
		padding: 24px;
		box-sizing: border-box;
	}

	.gw-channels-header {
		color: #00d4ff;
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid #2a2a3e;
		letter-spacing: 0.3px;
	}

	.gw-channels-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 16px;
	}

	.gw-channels-card {
		background: #13132a;
		border: 1px solid #2a2a3e;
		border-radius: 8px;
		padding: 16px;
		transition: background 0.15s, border-color 0.15s;
	}

	.gw-channels-card:hover {
		background: #1a1a36;
		border-color: #3a3a5e;
	}

	.gw-channels-card.connected {
		border-left: 3px solid #4caf50;
	}

	.gw-channels-card.disconnected {
		border-left: 3px solid #f44336;
		opacity: 0.7;
	}

	.gw-channels-name {
		font-size: 14px;
		font-weight: 600;
		color: #e0e0e0;
		margin-bottom: 8px;
	}

	.gw-channels-badge {
		display: inline-block;
		padding: 2px 10px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 500;
	}

	.gw-channels-badge.connected {
		background: #4caf5022;
		color: #4caf50;
		border: 1px solid #4caf5044;
	}

	.gw-channels-badge.disconnected {
		background: #f4433622;
		color: #f44336;
		border: 1px solid #f4433644;
	}

	.gw-channels-time {
		margin-top: 10px;
		font-size: 11px;
		color: #808080;
	}
`;
