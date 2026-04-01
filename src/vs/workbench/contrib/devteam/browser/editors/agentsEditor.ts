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

// ---------------------------------------------------------------------------
// Mock data — will be replaced by OpenClaw RPC client
// ---------------------------------------------------------------------------

interface AgentRow {
	agentId: string;
	name: string;
	model: string;
	status: 'idle' | 'running';
}

const MOCK_AGENTS: AgentRow[] = [
	{ agentId: 'main', name: 'Main Agent', model: 'claude-sonnet-4-20250514', status: 'idle' },
	{ agentId: 'coder', name: 'Coder', model: 'claude-sonnet-4-20250514', status: 'idle' },
];

// ---------------------------------------------------------------------------
// EditorInput — the "identity" of the tab
// ---------------------------------------------------------------------------

export class AgentsEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.agentsEditor';

	readonly resource = URI.from({ scheme: 'devclaw-agents', path: 'default' });

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override get typeId(): string { return AgentsEditorInput.ID; }

	override getName(): string { return 'Agents'; }

	override matches(other: unknown): boolean {
		return other instanceof AgentsEditorInput;
	}
}

// ---------------------------------------------------------------------------
// EditorPane — renders into the main editor area
// ---------------------------------------------------------------------------

export class AgentsEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.agentsEditor';

	private container!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super(AgentsEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// -- lifecycle -----------------------------------------------------------

	protected createEditor(parent: HTMLElement): void {
		this.container = document.createElement('div');
		this.container.className = 'gw-agents-root';
		parent.appendChild(this.container);

		// Inject scoped styles
		const style = document.createElement('style');
		style.textContent = AGENTS_EDITOR_STYLES;
		this.container.appendChild(style);

		// Header
		const header = document.createElement('div');
		header.className = 'gw-agents-header';
		header.textContent = 'Agents \u2014 OpenClaw Gateway';
		this.container.appendChild(header);

		// Table
		this.renderTable(MOCK_AGENTS);
	}

	override async setInput(
		input: AgentsEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		// Future: fetch live agent list from OpenClaw RPC here
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

	private renderTable(agents: AgentRow[]): void {
		const table = document.createElement('table');
		table.className = 'gw-agents-table';

		// Header row
		const thead = document.createElement('thead');
		const headerRow = document.createElement('tr');
		for (const col of ['Name', 'Model', 'Status']) {
			const th = document.createElement('th');
			th.className = 'gw-agents-th';
			th.textContent = col;
			headerRow.appendChild(th);
		}
		thead.appendChild(headerRow);
		table.appendChild(thead);

		// Body rows
		const tbody = document.createElement('tbody');
		for (const agent of agents) {
			const tr = document.createElement('tr');
			tr.className = 'gw-agents-row';

			// Name cell
			const tdName = document.createElement('td');
			tdName.className = 'gw-agents-td';
			tdName.textContent = agent.name;
			tr.appendChild(tdName);

			// Model cell
			const tdModel = document.createElement('td');
			tdModel.className = 'gw-agents-td gw-agents-model';
			tdModel.textContent = agent.model;
			tr.appendChild(tdModel);

			// Status cell with badge
			const tdStatus = document.createElement('td');
			tdStatus.className = 'gw-agents-td';
			const badge = document.createElement('span');
			badge.className = `gw-agents-badge ${agent.status}`;
			badge.textContent = agent.status;
			tdStatus.appendChild(badge);
			tr.appendChild(tdStatus);

			tbody.appendChild(tr);
		}
		table.appendChild(tbody);

		this.container.appendChild(table);
	}
}

// ---------------------------------------------------------------------------
// Scoped styles
// ---------------------------------------------------------------------------

const AGENTS_EDITOR_STYLES = `
	.gw-agents-root {
		background: #0d0d1a;
		color: #e0e0e0;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		overflow-y: auto;
		padding: 24px;
		box-sizing: border-box;
	}

	.gw-agents-header {
		color: #00d4ff;
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid #2a2a3e;
		letter-spacing: 0.3px;
	}

	.gw-agents-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	.gw-agents-th {
		text-align: left;
		color: #808080;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		padding: 8px 12px;
		border-bottom: 1px solid #2a2a3e;
	}

	.gw-agents-row {
		transition: background 0.15s;
	}

	.gw-agents-row:hover {
		background: #00d4ff08;
	}

	.gw-agents-td {
		padding: 10px 12px;
		border-bottom: 1px solid #1a1a2e;
		color: #e0e0e0;
	}

	.gw-agents-model {
		color: #808080;
		font-size: 12px;
	}

	.gw-agents-badge {
		display: inline-block;
		padding: 2px 10px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 500;
		text-transform: capitalize;
	}

	.gw-agents-badge.idle {
		background: #4caf5022;
		color: #4caf50;
		border: 1px solid #4caf5044;
	}

	.gw-agents-badge.running {
		background: #ff980022;
		color: #ff9800;
		border: 1px solid #ff980044;
	}
`;
