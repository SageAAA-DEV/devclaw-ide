/*---------------------------------------------------------------------------------------------
 *  DevTeam IDE - Panel Manager
 *  Manages switching between Code (native workbench) and WebView panels.
 *  When Code tab is active, shows native VS Code workbench.
 *  When other tabs active, hides workbench and shows WebView container.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { type DevTeamTab } from './devteamTabBar.js';

export class DevTeamPanelManager extends Disposable {

	private readonly panelContainer: HTMLElement;
	private readonly panels: Map<DevTeamTab, HTMLElement> = new Map();
	private activeTab: DevTeamTab = 'code';

	constructor(
		private readonly workbenchContainer: HTMLElement
	) {
		super();

		// Create the panel container that sits alongside the workbench
		this.panelContainer = document.createElement('div');
		this.panelContainer.className = 'devteam-panel-container';
		this.panelContainer.style.cssText = `
			display: none;
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: #0f1a1e;
			z-index: 50;
		`;

		// Insert panel container as sibling of workbench grid
		this.workbenchContainer.appendChild(this.panelContainer);

		// Create placeholder panels for Chat, Agents, Settings
		this.createPanel('chat', 'Chat', 'Agent chat with cascading stream UI coming next...');
		this.createPanel('agents', 'Agents', 'Your AI agent team roster coming soon...');
		this.createPanel('settings', 'Settings', 'Connection settings and BYOK configuration coming soon...');
	}

	private createPanel(tab: DevTeamTab, title: string, placeholder: string): void {
		const panel = document.createElement('div');
		panel.className = `devteam-panel devteam-panel-${tab}`;
		panel.style.cssText = `
			display: none;
			width: 100%;
			height: 100%;
			padding: 40px;
			box-sizing: border-box;
			color: #c0c0c0;
			font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		`;

		const heading = document.createElement('h1');
		heading.textContent = title;
		heading.style.cssText = `
			color: #e85555;
			font-size: 24px;
			font-weight: 600;
			margin: 0 0 16px 0;
		`;

		const desc = document.createElement('p');
		desc.textContent = placeholder;
		desc.style.cssText = `
			color: #808080;
			font-size: 14px;
			margin: 0;
		`;

		panel.appendChild(heading);
		panel.appendChild(desc);
		this.panelContainer.appendChild(panel);
		this.panels.set(tab, panel);
	}

	switchTo(tab: DevTeamTab): void {
		if (tab === this.activeTab) {
			return;
		}

		this.activeTab = tab;

		if (tab === 'code') {
			// Show native workbench, hide panel container
			this.panelContainer.style.display = 'none';
			// Make sure the workbench grid is visible
			const grid = this.workbenchContainer.querySelector('.monaco-grid-view') as HTMLElement;
			if (grid) {
				grid.style.display = '';
			}
		} else {
			// Hide workbench grid, show panel container
			const grid = this.workbenchContainer.querySelector('.monaco-grid-view') as HTMLElement;
			if (grid) {
				grid.style.display = 'none';
			}
			this.panelContainer.style.display = 'block';

			// Show only the active panel
			for (const [id, panel] of this.panels) {
				panel.style.display = id === tab ? 'block' : 'none';
			}
		}
	}

	getPanelElement(tab: DevTeamTab): HTMLElement | undefined {
		return this.panels.get(tab);
	}

	override dispose(): void {
		this.panelContainer.remove();
		super.dispose();
	}
}
