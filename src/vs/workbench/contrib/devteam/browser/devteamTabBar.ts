/*---------------------------------------------------------------------------------------------
 *  DevTeam IDE - Tab Bar Component
 *  Renders a horizontal tab bar with Code/Chat/Agents/Settings tabs.
 *  Sits above the main workbench, controls panel switching.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';

export type DevTeamTab = 'code' | 'chat' | 'agents' | 'settings';

export interface IDevTeamTabBarOptions {
	onTabChange: (tab: DevTeamTab) => void;
}

export class DevTeamTabBar extends Disposable {

	private readonly container: HTMLElement;
	private activeTab: DevTeamTab = 'code';
	private readonly tabElements: Map<DevTeamTab, HTMLElement> = new Map();

	private static readonly TABS: { id: DevTeamTab; label: string; icon: string }[] = [
		{ id: 'code', label: 'Code', icon: '$(code)' },
		{ id: 'chat', label: 'Chat', icon: '$(comment-discussion)' },
		{ id: 'agents', label: 'Agents', icon: '$(organization)' },
		{ id: 'settings', label: 'Settings', icon: '$(gear)' },
	];

	constructor(
		parent: HTMLElement,
		private readonly options: IDevTeamTabBarOptions
	) {
		super();

		this.container = document.createElement('div');
		this.container.className = 'devteam-tab-bar';
		this.container.setAttribute('role', 'tablist');
		this.applyStyles();

		// Build tabs
		for (const tab of DevTeamTabBar.TABS) {
			const tabEl = document.createElement('div');
			tabEl.className = 'devteam-tab';
			tabEl.setAttribute('role', 'tab');
			tabEl.setAttribute('aria-selected', tab.id === 'code' ? 'true' : 'false');
			tabEl.setAttribute('tabindex', tab.id === 'code' ? '0' : '-1');
			tabEl.textContent = tab.label;
			tabEl.dataset.tab = tab.id;

			if (tab.id === 'code') {
				tabEl.classList.add('active');
			}

			tabEl.addEventListener('click', () => this.setActiveTab(tab.id));
			tabEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					this.setActiveTab(tab.id);
				}
			});

			this.container.appendChild(tabEl);
			this.tabElements.set(tab.id, tabEl);
		}

		parent.prepend(this.container);
	}

	setActiveTab(tab: DevTeamTab): void {
		if (tab === this.activeTab) {
			return;
		}

		// Update visual state
		for (const [id, el] of this.tabElements) {
			if (id === tab) {
				el.classList.add('active');
				el.setAttribute('aria-selected', 'true');
				el.setAttribute('tabindex', '0');
			} else {
				el.classList.remove('active');
				el.setAttribute('aria-selected', 'false');
				el.setAttribute('tabindex', '-1');
			}
		}

		this.activeTab = tab;
		this.options.onTabChange(tab);
	}

	getActiveTab(): DevTeamTab {
		return this.activeTab;
	}

	getElement(): HTMLElement {
		return this.container;
	}

	private applyStyles(): void {
		const style = document.createElement('style');
		style.textContent = `
			.devteam-tab-bar {
				display: flex;
				align-items: center;
				height: 36px;
				background: #1a2a2e;
				border-bottom: 1px solid #2a3a3e;
				padding: 0 8px;
				flex-shrink: 0;
				z-index: 100;
				user-select: none;
				-webkit-app-region: no-drag;
			}

			.devteam-tab {
				display: flex;
				align-items: center;
				height: 100%;
				padding: 0 16px;
				color: #808080;
				font-size: 12px;
				font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
				font-weight: 500;
				letter-spacing: 0.3px;
				cursor: pointer;
				border-bottom: 2px solid transparent;
				transition: color 0.15s, border-color 0.15s;
			}

			.devteam-tab:hover {
				color: #c0c0c0;
			}

			.devteam-tab.active {
				color: #e85555;
				border-bottom-color: #e85555;
			}
		`;
		this.container.appendChild(style);
	}

	override dispose(): void {
		this.container.remove();
		super.dispose();
	}
}
