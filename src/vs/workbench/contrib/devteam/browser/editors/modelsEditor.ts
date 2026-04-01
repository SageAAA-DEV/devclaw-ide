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
// Mock data
// ---------------------------------------------------------------------------

const MOCK_MODELS: IModelEntry[] = [
	{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'Anthropic', isDefault: true },
	{ id: 'claude-haiku-3-5', name: 'Claude Haiku 3.5', provider: 'Anthropic', isDefault: false },
	{ id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', isDefault: false },
	{ id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', isDefault: false },
	{ id: 'MiniMax-M2.5', name: 'MiniMax M2.5', provider: 'MiniMax', isDefault: false },
];

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

const STYLES = `
.gw-models-root {
	background: #0d0d1a;
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
	color: #00d4ff;
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
	border-color: #00d4ff66;
	background: #1a1a32;
}

.gw-models-card--default {
	border-color: #00d4ff;
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
	color: #0d0d1a;
	background: #00d4ff;
	padding: 2px 6px;
	border-radius: 4px;
	line-height: 1;
}

.gw-models-card-id {
	font-size: 11px;
	color: #666;
	font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}
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

		this._renderContent();
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

	// --- rendering -----------------------------------------------------------

	private _renderContent(): void {
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
		const grouped = this._groupByProvider(MOCK_MODELS);

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
