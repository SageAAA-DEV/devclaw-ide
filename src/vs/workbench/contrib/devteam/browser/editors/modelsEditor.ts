/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorInputCapabilities, IEditorOpenContext } from '../../../../common/editor.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { URI } from '../../../../../base/common/uri.js';
import { IGatewayRpcService } from '../../browser/gatewayRpcService.js';
import { GatewayModelsListResult } from '../../common/gatewayTypes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IModelEntry {
	id: string;
	name: string;
	provider: string;
	isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

const STYLES = `
.gw-models-root {
	background: #0f1a1e;
	color: #e0e0e0;
	height: 100%;
	overflow-y: auto;
	padding: 24px 32px;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
	box-sizing: border-box;
}

.gw-models-header {
	margin-bottom: 28px;
}

.gw-models-title {
	font-size: 22px;
	font-weight: 600;
	color: #ffffff;
	margin: 0 0 6px 0;
}

.gw-models-subtitle {
	font-size: 13px;
	color: #888;
	margin: 0;
}

.gw-models-provider-section {
	margin-bottom: 24px;
}

.gw-models-provider-label {
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.8px;
	color: #e85555;
	margin: 0 0 10px 0;
}

.gw-models-grid {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
}

.gw-models-card {
	background: #161628;
	border: 1px solid #2a2a40;
	border-radius: 8px;
	padding: 14px 18px;
	min-width: 240px;
	max-width: 320px;
	cursor: pointer;
	transition: border-color 0.15s ease, background 0.15s ease;
}

.gw-models-card:hover {
	border-color: #e8555566;
	background: #1a1a32;
}

.gw-models-card--default {
	border-color: #e85555;
	background: #12122a;
}

.gw-models-card-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 4px;
}

.gw-models-card-name {
	font-size: 14px;
	font-weight: 500;
	color: #ffffff;
}

.gw-models-badge {
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: #0f1a1e;
	background: #e85555;
	padding: 2px 6px;
	border-radius: 4px;
	line-height: 1;
}

.gw-models-card-id {
	font-size: 11px;
	color: #666;
	font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.gw-loading, .gw-error {
	padding: 32px;
	text-align: center;
	font-size: 13px;
}
.gw-loading { color: #808080; }
.gw-error { color: #f44336; }
`;

// ---------------------------------------------------------------------------
// ModelsEditorInput
// ---------------------------------------------------------------------------

export class ModelsEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.modelsEditor';

	override get typeId(): string {
		return ModelsEditorInput.ID;
	}

	readonly resource = URI.from({ scheme: 'devclaw-models', path: 'default' });

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return 'Models';
	}

	override matches(other: unknown): boolean {
		return other instanceof ModelsEditorInput;
	}
}

// ---------------------------------------------------------------------------
// ModelsEditorPane
// ---------------------------------------------------------------------------

export class ModelsEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.modelsEditor';

	private _root: HTMLDivElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IGatewayRpcService private readonly rpcService: IGatewayRpcService,
	) {
		super(ModelsEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// --- lifecycle -----------------------------------------------------------

	protected override createEditor(parent: HTMLElement): void {
		this._root = document.createElement('div');
		this._root.classList.add('gw-models-root');
		parent.appendChild(this._root);

		// Inject scoped styles
		const style = document.createElement('style');
		style.textContent = STYLES;
		this._root.appendChild(style);

		// Header
		const header = document.createElement('div');
		header.classList.add('gw-models-header');
		const title = document.createElement('h1');
		title.classList.add('gw-models-title');
		title.textContent = 'Models';
		const subtitle = document.createElement('p');
		subtitle.classList.add('gw-models-subtitle');
		subtitle.textContent = 'Available LLM models organized by provider. Click a model to set it as the default.';
		header.appendChild(title);
		header.appendChild(subtitle);
		this._root.appendChild(header);

		// Loading indicator
		const loading = document.createElement('div');
		loading.className = 'gw-loading';
		loading.textContent = 'Loading...';
		this._root.appendChild(loading);

		this._loadLiveData();
	}

	override async setInput(
		input: ModelsEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
	}

	override layout(dimension: Dimension): void {
		if (this._root) {
			this._root.style.width = `${dimension.width}px`;
			this._root.style.height = `${dimension.height}px`;
		}
	}

	// --- live data -----------------------------------------------------------

	private async _loadLiveData(): Promise<void> {
		try {
			const result = await this.rpcService.call<GatewayModelsListResult>('models.list', {});
			const models: IModelEntry[] = result.models.map(m => ({
				id: m.id,
				name: m.name || m.id,
				provider: m.provider || 'Unknown',
				isDefault: m.isDefault ?? false,
			}));

			if (!this._root) {
				return;
			}

			// Clear and re-render with style + header + live data
			while (this._root.firstChild) {
				this._root.removeChild(this._root.firstChild);
			}

			const style = document.createElement('style');
			style.textContent = STYLES;
			this._root.appendChild(style);

			this._renderContent(models);
		} catch {
			if (!this._root) {
				return;
			}
			while (this._root.firstChild) {
				this._root.removeChild(this._root.firstChild);
			}

			const style = document.createElement('style');
			style.textContent = STYLES;
			this._root.appendChild(style);

			// Header
			const header = document.createElement('div');
			header.classList.add('gw-models-header');
			const title = document.createElement('h1');
			title.classList.add('gw-models-title');
			title.textContent = 'Models';
			const subtitle = document.createElement('p');
			subtitle.classList.add('gw-models-subtitle');
			subtitle.textContent = 'Available LLM models organized by provider. Click a model to set it as the default.';
			header.appendChild(title);
			header.appendChild(subtitle);
			this._root.appendChild(header);

			// Error
			const error = document.createElement('div');
			error.className = 'gw-error';
			error.textContent = 'Unable to connect to gateway';
			this._root.appendChild(error);
		}
	}

	// --- rendering -----------------------------------------------------------

	private _renderContent(models: IModelEntry[]): void {
		if (!this._root) {
			return;
		}

		// Header
		const header = document.createElement('div');
		header.classList.add('gw-models-header');

		const title = document.createElement('h1');
		title.classList.add('gw-models-title');
		title.textContent = 'Models';

		const subtitle = document.createElement('p');
		subtitle.classList.add('gw-models-subtitle');
		subtitle.textContent = 'Available LLM models organized by provider. Click a model to set it as the default.';

		header.appendChild(title);
		header.appendChild(subtitle);
		this._root.appendChild(header);

		// Group models by provider
		const grouped = this._groupByProvider(models);

		for (const [provider, models] of grouped) {
			const section = document.createElement('div');
			section.classList.add('gw-models-provider-section');

			const label = document.createElement('h2');
			label.classList.add('gw-models-provider-label');
			label.textContent = provider;
			section.appendChild(label);

			const grid = document.createElement('div');
			grid.classList.add('gw-models-grid');

			for (const model of models) {
				grid.appendChild(this._createModelCard(model));
			}

			section.appendChild(grid);
			this._root.appendChild(section);
		}
	}

	private _createModelCard(model: IModelEntry): HTMLElement {
		const card = document.createElement('div');
		card.classList.add('gw-models-card');
		if (model.isDefault) {
			card.classList.add('gw-models-card--default');
		}

		// Card header row (name + badge)
		const cardHeader = document.createElement('div');
		cardHeader.classList.add('gw-models-card-header');

		const name = document.createElement('span');
		name.classList.add('gw-models-card-name');
		name.textContent = model.name;
		cardHeader.appendChild(name);

		if (model.isDefault) {
			const badge = document.createElement('span');
			badge.classList.add('gw-models-badge');
			badge.textContent = 'DEFAULT';
			cardHeader.appendChild(badge);
		}

		card.appendChild(cardHeader);

		// Model ID
		const idEl = document.createElement('span');
		idEl.classList.add('gw-models-card-id');
		idEl.textContent = model.id;
		card.appendChild(idEl);

		return card;
	}

	private _groupByProvider(models: IModelEntry[]): Map<string, IModelEntry[]> {
		const map = new Map<string, IModelEntry[]>();
		for (const model of models) {
			const list = map.get(model.provider);
			if (list) {
				list.push(model);
			} else {
				map.set(model.provider, [model]);
			}
		}
		return map;
	}
}
