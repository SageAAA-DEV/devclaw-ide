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
import { IDevClawService } from './devclawService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ChatViewId, IChatWidgetService } from '../../chat/browser/chat.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';

interface AgentDisplay {
	id: string;
	name: string;
	role: string;
	status: 'online' | 'idle' | 'offline';
	icon: string;
	specialty?: string;
}

export class DevClawAgentsPane extends ViewPane {

	static readonly ID = 'devteam.agentsView';

	private listContainer!: HTMLElement;
	private statusLabel!: HTMLElement;

	private readonly defaultAgents: AgentDisplay[] = [
		// allow-any-unicode-next-line
		{ id: 'openclaw', name: 'OpenClaw', role: 'AI Assistant', status: 'idle', icon: '\uD83C\uDFAF', specialty: 'Your AI assistant — powered by your own keys' },
	];

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
		@IDevClawService private readonly devclawService: IDevClawService,
		@IViewsService private readonly viewsService: IViewsService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Listen for agent selection changes to update highlight
		this._register(this.devclawService.onAgentSelected((agentId) => {
			this.highlightActiveAgent(agentId);
		}));
	}

	private highlightActiveAgent(agentId: string): void {
		const cards = this.listContainer?.querySelectorAll('.devclaw-agent-card');
		if (!cards) { return; }
		cards.forEach((card) => {
			const el = card as HTMLElement;
			const cardAgentId = el.dataset.agentId;
			if (cardAgentId === agentId) {
				el.classList.add('active');
				// Update dot to green
				const dot = el.querySelector('.devclaw-agent-dot') as HTMLElement;
				if (dot) { dot.className = 'devclaw-agent-dot online'; }
			} else {
				el.classList.remove('active');
				// Reset dot to idle unless it has background activity
				const dot = el.querySelector('.devclaw-agent-dot') as HTMLElement;
				if (dot && !el.classList.contains('background-active')) {
					dot.className = 'devclaw-agent-dot idle';
				}
			}
		});
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.style.cssText = `
			display: flex;
			flex-direction: column;
			background: #0f1a1e;
			height: 100%;
			font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		`;

		const style = document.createElement('style');
		style.textContent = AGENTS_STYLES;
		container.appendChild(style);

		// Connection status bar
		const statusBar = document.createElement('div');
		statusBar.className = 'devclaw-agents-status';

		this.statusLabel = document.createElement('span');
		this.updateConnectionStatus();
		statusBar.appendChild(this.statusLabel);

		const refreshBtn = document.createElement('button');
		refreshBtn.className = 'devclaw-btn-refresh';
		refreshBtn.textContent = 'Refresh';
		refreshBtn.addEventListener('click', () => this.loadAgents());
		statusBar.appendChild(refreshBtn);

		container.appendChild(statusBar);

		// Agent list
		this.listContainer = document.createElement('div');
		this.listContainer.className = 'devclaw-agents-list';
		container.appendChild(this.listContainer);

		this.renderAgents(this.defaultAgents);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	private updateConnectionStatus(): void {
		const url = this.storageService.get('devteam.openclaw.url', StorageScope.APPLICATION, '');
		if (url) {
			this.statusLabel.textContent = 'Connected to OpenClaw';
			this.statusLabel.className = 'devclaw-status-text connected';
		} else {
			this.statusLabel.textContent = 'Not connected \u2014 showing default team';
			this.statusLabel.className = 'devclaw-status-text disconnected';
		}
	}

	private async loadAgents(): Promise<void> {
		const url = this.storageService.get('devteam.openclaw.url', StorageScope.APPLICATION, '');
		const apiKey = this.storageService.get('devteam.openclaw.apiKey', StorageScope.APPLICATION, '');

		if (!url) {
			this.renderAgents(this.defaultAgents);
			return;
		}

		try {
			const res = await fetch(`${url}/api/agents`, {
				headers: { 'x-api-key': apiKey },
				signal: AbortSignal.timeout(5000),
			});
			if (res.ok) {
				const agents = await res.json();
				const mapped: AgentDisplay[] = agents.map((a: { id: string; name: string; role?: string }) => ({
					id: a.id,
					name: a.name,
					role: a.role || 'Agent',
					status: 'online' as const,
					icon: '\uD83E\uDD16',
				}));
				this.renderAgents(mapped);
				this.statusLabel.textContent = `Connected \u2014 ${mapped.length} agents`;
				this.statusLabel.className = 'devclaw-status-text connected';
			}
		} catch {
			this.renderAgents(this.defaultAgents);
		}
	}

	private renderAgents(agents: AgentDisplay[]): void {
		// Clear existing children safely
		while (this.listContainer.firstChild) {
			this.listContainer.removeChild(this.listContainer.firstChild);
		}

		for (const agent of agents) {
			const card = document.createElement('div');
			card.className = 'devclaw-agent-card';
			card.dataset.agentId = agent.id;
			card.addEventListener('click', () => this.selectAgent(agent));

			const dot = document.createElement('span');
			dot.className = `devclaw-agent-dot ${agent.status}`;
			card.appendChild(dot);

			const info = document.createElement('div');
			info.className = 'devclaw-agent-info';

			const name = document.createElement('div');
			name.className = 'devclaw-agent-name';
			name.textContent = `${agent.icon} ${agent.name}`;
			info.appendChild(name);

			const role = document.createElement('div');
			role.className = 'devclaw-agent-role';
			role.textContent = agent.role;
			info.appendChild(role);

			if (agent.specialty) {
				const spec = document.createElement('div');
				spec.className = 'devclaw-agent-specialty';
				spec.textContent = agent.specialty;
				info.appendChild(spec);
			}

			card.appendChild(info);

			const chatBtn = document.createElement('button');
			chatBtn.className = 'devclaw-agent-chat-btn';
			chatBtn.textContent = 'Chat';
			chatBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.selectAgent(agent);
			});
			card.appendChild(chatBtn);

			this.listContainer.appendChild(card);
		}

		// Marketplace teaser
		const marketplace = document.createElement('div');
		marketplace.className = 'devclaw-marketplace-teaser';
		marketplace.textContent = '+ Browse Agent Marketplace';
		this.listContainer.appendChild(marketplace);
	}

	private async selectAgent(agent: AgentDisplay): Promise<void> {
		// Select the agent in the shared service
		this.devclawService.selectAgent(agent.id);
		// Open the native chat panel (right side)
		await this.viewsService.openView(ChatViewId, true);

		// Pre-fill the chat input with @agentname and a greeting
		const widgets = this.chatWidgetService.getWidgetsByLocations(ChatAgentLocation.Chat);
		if (widgets.length > 0) {
			const widget = widgets[0];
			// Set input with agent mention — ready for user to type
			const greeting = `@${agent.id} `;
			widget.setInput(greeting);
			widget.focusInput();
		}
	}
}

const AGENTS_STYLES = `
	.devclaw-agents-status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid #2a3a3e;
		flex-shrink: 0;
	}

	.devclaw-status-text { font-size: 11px; }
	.devclaw-status-text.connected { color: #4caf50; }
	.devclaw-status-text.disconnected { color: #808080; }

	.devclaw-btn-refresh {
		padding: 3px 10px;
		background: transparent;
		border: 1px solid #2a3a3e;
		border-radius: 3px;
		color: #808080;
		font-family: inherit;
		font-size: 11px;
		cursor: pointer;
	}
	.devclaw-btn-refresh:hover { color: #e85555; border-color: #e8555533; }

	.devclaw-agents-list { flex: 1; overflow-y: auto; padding: 8px; }

	.devclaw-agent-card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid #2a3a3e;
		border-radius: 6px;
		margin-bottom: 6px;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.devclaw-agent-card:hover { border-color: #e8555544; background: #e8555508; }
	.devclaw-agent-card.active { border-color: #4caf50; background: #4caf5010; }

	.devclaw-agent-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.devclaw-agent-dot.online { background: #4caf50; box-shadow: 0 0 4px #4caf5066; }
	.devclaw-agent-dot.idle { background: #ff9800; }
	.devclaw-agent-dot.offline { background: #555; }

	.devclaw-agent-info { flex: 1; min-width: 0; }
	.devclaw-agent-name { color: #e0e0e0; font-size: 13px; font-weight: 500; }
	.devclaw-agent-role { color: #666; font-size: 11px; margin-top: 2px; }
	.devclaw-agent-specialty { color: #555; font-size: 10px; margin-top: 3px; font-style: italic; }

	.devclaw-agent-dot.online {
		background: #4caf50;
		box-shadow: 0 0 6px #4caf5088;
	}

	.devclaw-agent-dot.background-active {
		background: #ff9800;
		animation: devclaw-pulse 1.5s ease-in-out infinite;
	}

	@keyframes devclaw-pulse {
		0%, 100% { opacity: 1; box-shadow: 0 0 4px #ff980066; }
		50% { opacity: 0.5; box-shadow: 0 0 8px #ff9800aa; }
	}

	.devclaw-agent-chat-btn {
		padding: 4px 12px;
		background: transparent;
		border: 1px solid #e8555533;
		border-radius: 3px;
		color: #e85555;
		font-family: inherit;
		font-size: 11px;
		cursor: pointer;
		flex-shrink: 0;
	}
	.devclaw-agent-chat-btn:hover { background: #e8555511; }

	.devclaw-marketplace-teaser {
		text-align: center;
		padding: 16px;
		color: #555;
		font-size: 12px;
		cursor: pointer;
		border: 1px dashed #2a3a3e;
		border-radius: 6px;
		margin-top: 8px;
		transition: color 0.15s, border-color 0.15s;
	}
	.devclaw-marketplace-teaser:hover { color: #e85555; border-color: #e8555544; }
`;
