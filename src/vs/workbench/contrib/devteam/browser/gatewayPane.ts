/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Gateway sidebar panel — navigation items that open editor tabs in the main area.

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
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { OpenClawRpcClient } from '../common/openClawRpcClient.js';
import type { GatewayHealthResult } from '../common/gatewayTypes.js';
import { AgentsEditorInput } from './editors/agentsEditor.js';
import { SkillsEditorInput } from './editors/skillsEditor.js';
import { ToolsEditorInput } from './editors/toolsEditor.js';
import { SessionsEditorInput } from './editors/sessionsEditor.js';
import { ModelsEditorInput } from './editors/modelsEditor.js';

interface NavItem {
	label: string;
	icon: string;
	createInput: () => AgentsEditorInput | SkillsEditorInput | ToolsEditorInput | SessionsEditorInput | ModelsEditorInput;
}

export class GatewayPane extends ViewPane {

	static readonly ID = 'devteam.gatewayView';

	private rpcClient: OpenClawRpcClient | null = null;
	private statusDot!: HTMLElement;
	private statusText!: HTMLElement;

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
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.style.cssText = 'display:flex;flex-direction:column;background:#0d0d1a;height:100%;overflow-y:auto;font-family:"Cascadia Code","Fira Code",Consolas,monospace;';

		const style = document.createElement('style');
		style.textContent = GATEWAY_STYLES;
		container.appendChild(style);

		const content = document.createElement('div');
		content.className = 'gw-content';

		// Status bar
		content.appendChild(this.createStatusSection());

		// Navigation items — each opens an editor tab
		const navItems: NavItem[] = [
			{ label: 'Agents', icon: '\uD83E\uDD16', createInput: () => new AgentsEditorInput() },
			{ label: 'Skills', icon: '\u26A1', createInput: () => new SkillsEditorInput() },
			{ label: 'Tools', icon: '\uD83D\uDD27', createInput: () => new ToolsEditorInput() },
			{ label: 'Sessions', icon: '\uD83D\uDCCB', createInput: () => new SessionsEditorInput() },
			{ label: 'Models', icon: '\uD83E\uDDE0', createInput: () => new ModelsEditorInput() },
		];

		const nav = document.createElement('div');
		nav.className = 'gw-nav';

		for (const item of navItems) {
			const btn = document.createElement('button');
			btn.className = 'gw-nav-item';

			const icon = document.createElement('span');
			icon.className = 'gw-nav-icon';
			icon.textContent = item.icon;

			const label = document.createElement('span');
			label.className = 'gw-nav-label';
			label.textContent = item.label;

			const arrow = document.createElement('span');
			arrow.className = 'gw-nav-arrow';
			arrow.textContent = '\u203A'; // single right angle

			btn.appendChild(icon);
			btn.appendChild(label);
			btn.appendChild(arrow);

			btn.addEventListener('click', () => {
				this.editorService.openEditor(item.createInput());
			});

			nav.appendChild(btn);
		}

		content.appendChild(nav);
		container.appendChild(content);

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

		this.rpcClient.onDidDisconnect(() => this.updateStatus(false, 'Disconnected'));
		this.rpcClient.onDidConnect(() => { this.updateStatus(true); this.loadHealth(); });
	}

	// ---- Status ----

	private createStatusSection(): HTMLElement {
		const section = document.createElement('div');
		section.className = 'gw-status';

		this.statusDot = document.createElement('span');
		this.statusDot.className = 'gw-dot offline';

		this.statusText = document.createElement('span');
		this.statusText.className = 'gw-status-text';
		this.statusText.textContent = 'Connecting...';

		const refreshBtn = document.createElement('button');
		refreshBtn.className = 'gw-refresh-btn';
		refreshBtn.textContent = 'Refresh';
		refreshBtn.addEventListener('click', () => this.tryConnect());

		section.appendChild(this.statusDot);
		section.appendChild(this.statusText);
		section.appendChild(refreshBtn);
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
			this.statusText.textContent = `Connected \u2014 v${health.version ?? 'unknown'}`;
		} catch {
			this.statusText.textContent = 'Connected (health check failed)';
		}
	}

	override dispose(): void {
		this.rpcClient?.dispose();
		super.dispose();
	}
}

const GATEWAY_STYLES = `
	.gw-content { padding: 8px 12px; }

	.gw-status {
		display: flex; align-items: center; gap: 8px;
		padding: 10px 0; border-bottom: 1px solid #2a2a3e; margin-bottom: 12px;
	}

	.gw-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.gw-dot.online { background: #4caf50; box-shadow: 0 0 6px #4caf5088; }
	.gw-dot.offline { background: #f44336; box-shadow: 0 0 6px #f4433688; }

	.gw-status-text { color: #e0e0e0; font-size: 12px; flex: 1; }

	.gw-refresh-btn {
		padding: 2px 8px; background: transparent; border: 1px solid #2a2a3e;
		border-radius: 3px; color: #808080; font-size: 11px; cursor: pointer;
	}
	.gw-refresh-btn:hover { border-color: #00d4ff; color: #00d4ff; }

	.gw-nav { display: flex; flex-direction: column; gap: 2px; }

	.gw-nav-item {
		display: flex; align-items: center; gap: 10px;
		padding: 10px 8px; background: transparent; border: none;
		border-radius: 4px; cursor: pointer; width: 100%; text-align: left;
		transition: background 0.15s;
	}
	.gw-nav-item:hover { background: #1a1a2e; }

	.gw-nav-icon { font-size: 16px; width: 24px; text-align: center; }
	.gw-nav-label { color: #e0e0e0; font-size: 13px; flex: 1; font-weight: 500; }
	.gw-nav-arrow { color: #555; font-size: 16px; }
	.gw-nav-item:hover .gw-nav-arrow { color: #00d4ff; }
	.gw-nav-item:hover .gw-nav-label { color: #00d4ff; }
`;
