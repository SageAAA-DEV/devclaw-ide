/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { OpenClawRpcClient } from '../common/openClawRpcClient.js';
import type {
	GatewayHealthResult, GatewayAgentsListResult, GatewaySkillsStatusResult,
	GatewayToolsCatalogResult, GatewayModelsListResult,
	GatewayAgentSummary, GatewaySkillEntry, GatewayToolGroup, GatewayModelEntry,
} from '../common/gatewayTypes.js';

export class GatewayPane extends ViewPane {

	static readonly ID = 'devteam.gatewayView';

	private rpcClient: OpenClawRpcClient | null = null;
	private contentEl!: HTMLElement;
	private statusDot!: HTMLElement;
	private statusText!: HTMLElement;

	// Section data containers (populated on expand)
	private agentsList!: HTMLElement;
	private skillsList!: HTMLElement;
	private toolsList!: HTMLElement;
	private sessionsList!: HTMLElement;
	private modelsList!: HTMLElement;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.style.cssText = 'display:flex;flex-direction:column;background:#0d0d1a;height:100%;overflow-y:auto;font-family:"Cascadia Code","Fira Code",Consolas,monospace;';

		const style = document.createElement('style');
		style.textContent = GATEWAY_STYLES;
		container.appendChild(style);

		this.contentEl = document.createElement('div');
		this.contentEl.className = 'gw-content';

		// Status section (always visible)
		this.contentEl.appendChild(this.createStatusSection());

		// Collapsible sections
		this.agentsList = this.createCollapsibleSection('Agents', () => this.loadAgents());
		this.skillsList = this.createCollapsibleSection('Skills', () => this.loadSkills());
		this.toolsList = this.createCollapsibleSection('Tools', () => this.loadTools());
		this.sessionsList = this.createCollapsibleSection('Sessions', () => this.loadSessions());
		this.modelsList = this.createCollapsibleSection('Models', () => this.loadModels());

		container.appendChild(this.contentEl);

		// Auto-connect
		this.tryConnect();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	// ---- Connection ----

	private async tryConnect(): Promise<void> {
		const port = this.storageService.get('devteam.openclaw.port', StorageScope.APPLICATION, '18789');
		const token = this.storageService.get('devteam.openclaw.token', StorageScope.APPLICATION, '');
		const url = `http://127.0.0.1:${port}`;

		this.rpcClient?.dispose();
		this.rpcClient = new OpenClawRpcClient();

		try {
			await this.rpcClient.connect(url, token);
			this.updateStatus(true);
			this.loadHealth();
		} catch {
			this.updateStatus(false, 'Not connected');
		}

		this.rpcClient.onDidDisconnect(() => {
			this.updateStatus(false, 'Disconnected');
		});

		this.rpcClient.onDidConnect(() => {
			this.updateStatus(true);
			this.loadHealth();
		});
	}

	// ---- Status Section ----

	private createStatusSection(): HTMLElement {
		const section = document.createElement('div');
		section.className = 'gw-section';

		const header = document.createElement('div');
		header.className = 'gw-status-header';

		this.statusDot = document.createElement('span');
		this.statusDot.className = 'gw-dot offline';

		this.statusText = document.createElement('span');
		this.statusText.className = 'gw-status-text';
		this.statusText.textContent = 'Connecting...';

		const refreshBtn = document.createElement('button');
		refreshBtn.className = 'gw-refresh-btn';
		refreshBtn.textContent = 'Refresh';
		refreshBtn.addEventListener('click', () => this.tryConnect());

		header.appendChild(this.statusDot);
		header.appendChild(this.statusText);
		header.appendChild(refreshBtn);
		section.appendChild(header);

		return section;
	}

	private updateStatus(connected: boolean, text?: string): void {
		if (this.statusDot) {
			this.statusDot.className = `gw-dot ${connected ? 'online' : 'offline'}`;
		}
		if (this.statusText && text) {
			this.statusText.textContent = text;
		}
	}

	private async loadHealth(): Promise<void> {
		if (!this.rpcClient?.isConnected) { return; }
		try {
			const health = await this.rpcClient.call<GatewayHealthResult>('health', {});
			const version = health.version ?? 'unknown';
			this.statusText.textContent = `Connected \u2014 v${version}`;
		} catch {
			this.statusText.textContent = 'Connected (health check failed)';
		}
	}

	// ---- Collapsible Sections ----

	private createCollapsibleSection(title: string, loader: () => Promise<void>): HTMLElement {
		const section = document.createElement('div');
		section.className = 'gw-section';

		const header = document.createElement('div');
		header.className = 'gw-section-header';

		const arrow = document.createElement('span');
		arrow.className = 'gw-arrow collapsed';
		arrow.textContent = '\u25B6'; // right triangle

		const label = document.createElement('span');
		label.className = 'gw-section-label';
		label.textContent = title;

		const body = document.createElement('div');
		body.className = 'gw-section-body';
		body.style.display = 'none';

		let loaded = false;

		header.addEventListener('click', async () => {
			const isOpen = body.style.display !== 'none';
			body.style.display = isOpen ? 'none' : 'block';
			arrow.textContent = isOpen ? '\u25B6' : '\u25BC'; // right / down triangle
			arrow.className = `gw-arrow ${isOpen ? 'collapsed' : 'expanded'}`;

			if (!isOpen && !loaded && this.rpcClient?.isConnected) {
				body.textContent = 'Loading...';
				try {
					await loader();
					loaded = true;
				} catch (err) {
					body.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
				}
			}
		});

		header.appendChild(arrow);
		header.appendChild(label);
		section.appendChild(header);
		section.appendChild(body);
		this.contentEl.appendChild(section);

		return body;
	}

	// ---- Data Loaders ----

	private async loadAgents(): Promise<void> {
		const result = await this.rpcClient!.call<GatewayAgentsListResult>('agents.list', {});
		this.agentsList.textContent = '';
		if (!result.agents?.length) {
			this.agentsList.textContent = 'No agents found';
			return;
		}
		for (const agent of result.agents) {
			this.agentsList.appendChild(this.renderAgentRow(agent));
		}
	}

	private renderAgentRow(agent: GatewayAgentSummary): HTMLElement {
		const row = document.createElement('div');
		row.className = 'gw-row';
		const name = document.createElement('span');
		name.className = 'gw-row-name';
		name.textContent = agent.name || agent.agentId;
		const detail = document.createElement('span');
		detail.className = 'gw-row-detail';
		detail.textContent = agent.model ?? '';
		row.appendChild(name);
		row.appendChild(detail);
		return row;
	}

	private async loadSkills(): Promise<void> {
		const result = await this.rpcClient!.call<GatewaySkillsStatusResult>('skills.status', {});
		this.skillsList.textContent = '';
		const skills = result.workspace?.skills ?? [];
		if (!skills.length) {
			this.skillsList.textContent = 'No skills installed';
			return;
		}
		for (const skill of skills) {
			this.skillsList.appendChild(this.renderSkillRow(skill));
		}
	}

	private renderSkillRow(skill: GatewaySkillEntry): HTMLElement {
		const row = document.createElement('div');
		row.className = 'gw-row';
		const name = document.createElement('span');
		name.className = 'gw-row-name';
		name.textContent = `${skill.emoji ?? ''} ${skill.name}`.trim();
		const status = document.createElement('span');
		status.className = `gw-badge ${skill.enabled !== false ? 'enabled' : 'disabled'}`;
		status.textContent = skill.enabled !== false ? 'ON' : 'OFF';
		row.appendChild(name);
		row.appendChild(status);
		return row;
	}

	private async loadTools(): Promise<void> {
		const result = await this.rpcClient!.call<GatewayToolsCatalogResult>('tools.catalog', {});
		this.toolsList.textContent = '';
		const groups = result.groups ?? [];
		if (!groups.length) {
			this.toolsList.textContent = 'No tools available';
			return;
		}
		for (const group of groups) {
			this.toolsList.appendChild(this.renderToolGroup(group));
		}
	}

	private renderToolGroup(group: GatewayToolGroup): HTMLElement {
		const el = document.createElement('div');
		el.className = 'gw-tool-group';
		const header = document.createElement('div');
		header.className = 'gw-group-header';
		header.textContent = `${group.name} (${group.tools.length})`;
		el.appendChild(header);
		for (const tool of group.tools) {
			const row = document.createElement('div');
			row.className = 'gw-row gw-row-indent';
			row.textContent = tool.name;
			row.title = tool.description;
			el.appendChild(row);
		}
		return el;
	}

	private async loadSessions(): Promise<void> {
		// sessions.resolve lists active sessions when called without specific key
		try {
			const result = await this.rpcClient!.call<{ sessions: Array<{ sessionKey: string; agentId?: string; model?: string; totalTokens?: number }> }>('sessions.usage', {});
			this.sessionsList.textContent = '';
			const sessions = result.sessions ?? [];
			if (!sessions.length) {
				this.sessionsList.textContent = 'No active sessions';
				return;
			}
			for (const s of sessions) {
				const row = document.createElement('div');
				row.className = 'gw-row';
				const name = document.createElement('span');
				name.className = 'gw-row-name';
				name.textContent = s.sessionKey || s.agentId || 'Unknown';
				const detail = document.createElement('span');
				detail.className = 'gw-row-detail';
				const tokens = s.totalTokens ? `${Math.round(s.totalTokens / 1000)}k tokens` : '';
				detail.textContent = [s.model, tokens].filter(Boolean).join(' \u2014 ');
				row.appendChild(name);
				row.appendChild(detail);
				this.sessionsList.appendChild(row);
			}
		} catch {
			this.sessionsList.textContent = 'Could not load sessions';
		}
	}

	private async loadModels(): Promise<void> {
		const result = await this.rpcClient!.call<GatewayModelsListResult>('models.list', {});
		this.modelsList.textContent = '';
		const models = result.models ?? [];
		if (!models.length) {
			this.modelsList.textContent = 'No models available';
			return;
		}
		for (const model of models) {
			this.modelsList.appendChild(this.renderModelRow(model));
		}
	}

	private renderModelRow(model: GatewayModelEntry): HTMLElement {
		const row = document.createElement('div');
		row.className = 'gw-row';
		const name = document.createElement('span');
		name.className = 'gw-row-name';
		name.textContent = model.name || model.id;
		if (model.isDefault) {
			const badge = document.createElement('span');
			badge.className = 'gw-badge enabled';
			badge.textContent = 'DEFAULT';
			name.appendChild(document.createTextNode(' '));
			name.appendChild(badge);
		}
		const detail = document.createElement('span');
		detail.className = 'gw-row-detail';
		detail.textContent = model.provider ?? '';
		row.appendChild(name);
		row.appendChild(detail);
		return row;
	}

	override dispose(): void {
		this.rpcClient?.dispose();
		super.dispose();
	}
}

const GATEWAY_STYLES = `
	.gw-content { padding: 8px 12px; }

	.gw-section { margin-bottom: 8px; }

	.gw-status-header {
		display: flex; align-items: center; gap: 8px;
		padding: 8px 0; border-bottom: 1px solid #2a2a3e;
	}

	.gw-dot {
		width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
	}
	.gw-dot.online { background: #4caf50; box-shadow: 0 0 6px #4caf5088; }
	.gw-dot.offline { background: #f44336; box-shadow: 0 0 6px #f4433688; }

	.gw-status-text { color: #e0e0e0; font-size: 12px; flex: 1; }

	.gw-refresh-btn {
		padding: 2px 8px; background: transparent; border: 1px solid #2a2a3e;
		border-radius: 3px; color: #808080; font-size: 11px; cursor: pointer;
	}
	.gw-refresh-btn:hover { border-color: #00d4ff; color: #00d4ff; }

	.gw-section-header {
		display: flex; align-items: center; gap: 6px;
		padding: 6px 0; cursor: pointer; user-select: none;
	}
	.gw-section-header:hover { color: #00d4ff; }

	.gw-arrow { color: #808080; font-size: 10px; width: 12px; text-align: center; }
	.gw-section-label {
		color: #00d4ff; font-size: 12px; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.5px;
	}

	.gw-section-body {
		padding: 4px 0 4px 18px; font-size: 12px; color: #c0c0c0;
	}

	.gw-row {
		display: flex; justify-content: space-between; align-items: center;
		padding: 4px 0; border-bottom: 1px solid #1a1a2e;
	}
	.gw-row:last-child { border-bottom: none; }
	.gw-row-indent { padding-left: 12px; }

	.gw-row-name { color: #e0e0e0; font-size: 12px; }
	.gw-row-detail { color: #666; font-size: 11px; }

	.gw-badge {
		display: inline-block; padding: 1px 6px; border-radius: 3px;
		font-size: 10px; font-weight: 600; text-transform: uppercase;
	}
	.gw-badge.enabled { background: #4caf5022; color: #4caf50; }
	.gw-badge.disabled { background: #f4433622; color: #f44336; }

	.gw-tool-group { margin-bottom: 6px; }
	.gw-group-header {
		color: #808080; font-size: 11px; font-weight: 600;
		text-transform: uppercase; padding: 4px 0; letter-spacing: 0.3px;
	}
`;
