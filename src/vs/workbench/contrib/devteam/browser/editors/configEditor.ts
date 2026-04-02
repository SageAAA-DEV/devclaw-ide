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
import { GatewayConfigResult } from '../../common/gatewayTypes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigEntry {
	key: string;
	value: string | number;
	category: 'Model' | 'Execution' | 'Preferences';
}

// ---------------------------------------------------------------------------
// EditorInput — the "identity" of the tab
// ---------------------------------------------------------------------------

export class ConfigEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.configEditor';

	readonly resource = URI.from({ scheme: 'devclaw-config', path: 'default' });

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override get typeId(): string { return ConfigEditorInput.ID; }

	override getName(): string { return 'Config'; }

	override matches(other: unknown): boolean {
		return other instanceof ConfigEditorInput;
	}
}

// ---------------------------------------------------------------------------
// EditorPane — renders into the main editor area
// ---------------------------------------------------------------------------

export class ConfigEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.configEditor';

	private container!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IGatewayRpcService private readonly rpcService: IGatewayRpcService,
	) {
		super(ConfigEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// -- lifecycle -----------------------------------------------------------

	protected createEditor(parent: HTMLElement): void {
		this.container = document.createElement('div');
		this.container.className = 'gw-config-root';
		parent.appendChild(this.container);

		// Inject scoped styles
		const style = document.createElement('style');
		style.textContent = CONFIG_EDITOR_STYLES;
		this.container.appendChild(style);

		// Header
		const header = document.createElement('div');
		header.className = 'gw-config-header';
		header.textContent = 'Config \u2014 OpenClaw Gateway';
		this.container.appendChild(header);

		// Loading indicator
		const loading = document.createElement('div');
		loading.className = 'gw-loading';
		loading.textContent = 'Loading...';
		this.container.appendChild(loading);

		this._loadLiveData();
	}

	override async setInput(
		input: ConfigEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		// Future: fetch live config from OpenClaw RPC here
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
			const result = await this.rpcService.call<GatewayConfigResult>('config.get', {});
			const entries: ConfigEntry[] = [];
			for (const [key, value] of Object.entries(result.config)) {
				let category: ConfigEntry['category'];
				switch (typeof value) {
					case 'string': category = 'Preferences'; break;
					case 'number': category = 'Execution'; break;
					default: category = 'Model'; break;
				}
				const displayValue = (typeof value === 'object' && value !== null)
					? JSON.stringify(value, null, 2)
					: value as string | number;
				entries.push({ key, value: displayValue, category });
			}

			if (!this.container) {
				return;
			}

			// Clear container and rebuild style + header + sections
			while (this.container.firstChild) {
				this.container.removeChild(this.container.firstChild);
			}

			const style = document.createElement('style');
			style.textContent = CONFIG_EDITOR_STYLES;
			this.container.appendChild(style);

			const header = document.createElement('div');
			header.className = 'gw-config-header';
			header.textContent = 'Config \u2014 OpenClaw Gateway';
			this.container.appendChild(header);

			this.renderSections(entries);
		} catch {
			if (!this.container) {
				return;
			}
			while (this.container.firstChild) {
				this.container.removeChild(this.container.firstChild);
			}

			const style = document.createElement('style');
			style.textContent = CONFIG_EDITOR_STYLES;
			this.container.appendChild(style);

			const header = document.createElement('div');
			header.className = 'gw-config-header';
			header.textContent = 'Config \u2014 OpenClaw Gateway';
			this.container.appendChild(header);

			const error = document.createElement('div');
			error.className = 'gw-error';
			error.textContent = 'Unable to connect to gateway';
			this.container.appendChild(error);
		}
	}

	// -- rendering -----------------------------------------------------------

	private renderSections(entries: ConfigEntry[]): void {
		const categories: Array<'Model' | 'Execution' | 'Preferences'> = ['Model', 'Execution', 'Preferences'];

		for (const category of categories) {
			const group = entries.filter(e => e.category === category);
			if (group.length === 0) {
				continue;
			}

			// Section label
			const sectionLabel = document.createElement('div');
			sectionLabel.className = 'gw-config-section-label';
			sectionLabel.textContent = category;
			this.container.appendChild(sectionLabel);

			// Table for this category
			const table = document.createElement('table');
			table.className = 'gw-config-table';

			const tbody = document.createElement('tbody');
			for (const entry of group) {
				const tr = document.createElement('tr');
				tr.className = 'gw-config-row';

				// Key cell
				const tdKey = document.createElement('td');
				tdKey.className = 'gw-config-td gw-config-key';
				tdKey.textContent = entry.key;
				tr.appendChild(tdKey);

				// Value cell
				const tdValue = document.createElement('td');
				tdValue.className = 'gw-config-td gw-config-value';
				tdValue.textContent = String(entry.value);
				tr.appendChild(tdValue);

				tbody.appendChild(tr);
			}
			table.appendChild(tbody);

			this.container.appendChild(table);
		}
	}
}

// ---------------------------------------------------------------------------
// Scoped styles
// ---------------------------------------------------------------------------

const CONFIG_EDITOR_STYLES = `
	.gw-config-root {
		background: #0f1a1e;
		color: #e0e0e0;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		overflow-y: auto;
		padding: 24px;
		box-sizing: border-box;
	}

	.gw-config-header {
		color: #e85555;
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid #2a3a3e;
		letter-spacing: 0.3px;
	}

	.gw-config-section-label {
		color: #808080;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		padding: 16px 0 6px 0;
		border-bottom: 1px solid #2a3a3e;
		margin-bottom: 2px;
	}

	.gw-config-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
		margin-bottom: 8px;
	}

	.gw-config-row {
		transition: background 0.15s;
	}

	.gw-config-row:hover {
		background: #e8555508;
	}

	.gw-config-td {
		padding: 10px 12px;
		border-bottom: 1px solid #1a2a2e;
	}

	.gw-config-key {
		color: #e85555;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		font-size: 13px;
		width: 200px;
		white-space: nowrap;
	}

	.gw-config-value {
		color: #e0e0e0;
		font-size: 13px;
	}

	.gw-loading, .gw-error {
		padding: 32px;
		text-align: center;
		font-size: 13px;
	}
	.gw-loading { color: #808080; }
	.gw-error { color: #f44336; }
`;
