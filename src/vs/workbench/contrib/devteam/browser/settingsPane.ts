/*---------------------------------------------------------------------------------------------
 *  DevTeam IDE - Settings Pane
 *  CTRL-A connection config, BYOK keys, future: Git/DB/MCP config.
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
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

export class DevTeamSettingsPane extends ViewPane {

	static readonly ID = 'devteam.settingsView';

	private readonly STORAGE_KEYS = {
		ctrlAUrl: 'devteam.ctrlA.url',
		ctrlAMode: 'devteam.ctrlA.mode',
		ctrlAApiKey: 'devteam.ctrlA.apiKey',
		ctrlACloudUrl: 'devteam.ctrlA.cloudUrl',
		ctrlACloudApiKey: 'devteam.ctrlA.cloudApiKey',
		ctrlALocalUrl: 'devteam.ctrlA.localUrl',
		ctrlALocalApiKey: 'devteam.ctrlA.localApiKey',
		keyAnthropic: 'devteam.key.anthropic',
		keyOpenAI: 'devteam.key.openai',
		keyMiniMax: 'devteam.key.minimax',
		keyOpenRouter: 'devteam.key.openrouter',
	};

	private urlInput!: HTMLInputElement;
	private apiKeyInput!: HTMLInputElement;

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

		container.style.cssText = `
			display: flex;
			flex-direction: column;
			background: #0d0d1a;
			height: 100%;
			overflow-y: auto;
			font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
		`;

		const style = document.createElement('style');
		style.textContent = SETTINGS_STYLES;
		container.appendChild(style);

		const content = document.createElement('div');
		content.className = 'devteam-settings';

		// --- Section: CTRL-A Instance ---
		const urlRow = this.createInput('Server URL', 'ctrlAUrl', 'https://your-ctrl-a.onrender.com', 'text');
		this.urlInput = urlRow.querySelector('.devteam-settings-input') as HTMLInputElement;

		const apiKeyRow = this.createInput('API Key', 'ctrlAApiKey', 'Enter CTRL-A API key', 'password');
		this.apiKeyInput = apiKeyRow.querySelector('.devteam-settings-input') as HTMLInputElement;

		const modeToggle = this.createModeToggle();

		content.appendChild(this.createSection('CTRL-A Instance', [
			modeToggle,
			urlRow,
			apiKeyRow,
			this.createTestButton(),
		]));

		// --- Section: BYOK Keys ---
		content.appendChild(this.createSection('Bring Your Own Keys', [
			this.createInput('Anthropic', 'keyAnthropic', 'sk-ant-...', 'password'),
			this.createInput('OpenAI', 'keyOpenAI', 'sk-...', 'password'),
			this.createInput('MiniMax', 'keyMiniMax', 'eyJ...', 'password'),
			this.createInput('OpenRouter', 'keyOpenRouter', 'sk-or-...', 'password'),
		]));

		// --- Section: Git (stub) ---
		content.appendChild(this.createSection('Git Integration', [
			this.createStub('Auto-commit, auto-push, PR creation — coming soon.'),
		]));

		// --- Section: Database (stub) ---
		content.appendChild(this.createSection('Database', [
			this.createStub('Connect any database for agent read/write — coming soon.'),
		]));

		// --- Section: MCP Servers (stub) ---
		content.appendChild(this.createSection('MCP Servers', [
			this.createStub('Add custom MCP servers for extended tool access — coming soon.'),
		]));

		container.appendChild(content);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	private createSection(title: string, children: HTMLElement[]): HTMLElement {
		const section = document.createElement('div');
		section.className = 'devteam-settings-section';

		const heading = document.createElement('h2');
		heading.className = 'devteam-settings-heading';
		heading.textContent = title;
		section.appendChild(heading);

		for (const child of children) {
			section.appendChild(child);
		}
		return section;
	}

	private createInput(label: string, storageKey: keyof typeof this.STORAGE_KEYS, placeholder: string, type: string): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const labelEl = document.createElement('label');
		labelEl.className = 'devteam-settings-label';
		labelEl.textContent = label;
		row.appendChild(labelEl);

		const input = document.createElement('input');
		input.className = 'devteam-settings-input';
		input.type = type;
		input.placeholder = placeholder;
		input.spellcheck = false;

		// Load saved value
		const saved = this.storageService.get(this.STORAGE_KEYS[storageKey], StorageScope.APPLICATION, '');
		if (saved) {
			input.value = saved;
		}

		// Save on change
		input.addEventListener('change', () => {
			this.storageService.store(this.STORAGE_KEYS[storageKey], input.value, StorageScope.APPLICATION, StorageTarget.USER);
		});

		row.appendChild(input);
		return row;
	}

	private createTestButton(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const btn = document.createElement('button');
		btn.className = 'devteam-btn devteam-btn-test';
		btn.textContent = 'Test Connection';

		const status = document.createElement('span');
		status.className = 'devteam-connection-status';
		status.textContent = '';

		btn.addEventListener('click', async () => {
			btn.disabled = true;
			btn.textContent = 'Testing...';
			status.textContent = '';

			const url = this.storageService.get(this.STORAGE_KEYS.ctrlAUrl, StorageScope.APPLICATION, '');
			if (!url) {
				status.textContent = 'No URL configured';
				status.className = 'devteam-connection-status error';
				btn.disabled = false;
				btn.textContent = 'Test Connection';
				return;
			}

			try {
				// Use Electron's net module to bypass CORS restrictions
				const electronFetch = (globalThis as any).fetch;
				const res = await electronFetch(`${url}/api/health`, {
					signal: AbortSignal.timeout(10000),
					headers: { 'x-api-key': this.storageService.get(this.STORAGE_KEYS.ctrlAApiKey, StorageScope.APPLICATION, '') },
				});
				if (res.ok) {
					const data = await res.json();
					status.textContent = `Connected — v${data.version || '?'}`;
					status.className = 'devteam-connection-status success';
				} else {
					status.textContent = `Error: ${res.status}`;
					status.className = 'devteam-connection-status error';
				}
			} catch {
				status.textContent = 'Connection failed';
				status.className = 'devteam-connection-status error';
			}

			btn.disabled = false;
			btn.textContent = 'Test Connection';
		});

		row.appendChild(btn);
		row.appendChild(status);
		return row;
	}

	private createModeToggle(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const labelEl = document.createElement('label');
		labelEl.className = 'devteam-settings-label';
		labelEl.textContent = 'Mode';
		row.appendChild(labelEl);

		const toggleContainer = document.createElement('div');
		toggleContainer.className = 'devteam-toggle-container';

		const currentMode = this.storageService.get(this.STORAGE_KEYS.ctrlAMode, StorageScope.APPLICATION, 'cloud');

		for (const opt of ['cloud', 'local']) {
			const btn = document.createElement('button');
			btn.className = `devteam-toggle-btn ${currentMode === opt ? 'active' : ''}`;
			btn.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
			btn.addEventListener('click', () => {
				// Save current values to the current mode's storage
				const oldMode = this.storageService.get(this.STORAGE_KEYS.ctrlAMode, StorageScope.APPLICATION, 'cloud');
				if (oldMode === 'cloud') {
					this.storageService.store(this.STORAGE_KEYS.ctrlACloudUrl, this.urlInput.value, StorageScope.APPLICATION, StorageTarget.USER);
					this.storageService.store(this.STORAGE_KEYS.ctrlACloudApiKey, this.apiKeyInput.value, StorageScope.APPLICATION, StorageTarget.USER);
				} else {
					this.storageService.store(this.STORAGE_KEYS.ctrlALocalUrl, this.urlInput.value, StorageScope.APPLICATION, StorageTarget.USER);
					this.storageService.store(this.STORAGE_KEYS.ctrlALocalApiKey, this.apiKeyInput.value, StorageScope.APPLICATION, StorageTarget.USER);
				}

				// Switch mode
				this.storageService.store(this.STORAGE_KEYS.ctrlAMode, opt, StorageScope.APPLICATION, StorageTarget.USER);
				toggleContainer.querySelectorAll('.devteam-toggle-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');

				// Load the new mode's values
				if (opt === 'cloud') {
					const cloudUrl = this.storageService.get(this.STORAGE_KEYS.ctrlACloudUrl, StorageScope.APPLICATION, '');
					const cloudKey = this.storageService.get(this.STORAGE_KEYS.ctrlACloudApiKey, StorageScope.APPLICATION, '');
					this.urlInput.value = cloudUrl;
					this.urlInput.placeholder = 'https://your-ctrl-a.onrender.com';
					this.apiKeyInput.value = cloudKey;
					// Update the active URL/key storage
					this.storageService.store(this.STORAGE_KEYS.ctrlAUrl, cloudUrl, StorageScope.APPLICATION, StorageTarget.USER);
					this.storageService.store(this.STORAGE_KEYS.ctrlAApiKey, cloudKey, StorageScope.APPLICATION, StorageTarget.USER);
				} else {
					const localUrl = this.storageService.get(this.STORAGE_KEYS.ctrlALocalUrl, StorageScope.APPLICATION, 'http://localhost:1045');
					const localKey = this.storageService.get(this.STORAGE_KEYS.ctrlALocalApiKey, StorageScope.APPLICATION, 'dev-key');
					this.urlInput.value = localUrl;
					this.urlInput.placeholder = 'http://localhost:1045';
					this.apiKeyInput.value = localKey;
					// Update the active URL/key storage
					this.storageService.store(this.STORAGE_KEYS.ctrlAUrl, localUrl, StorageScope.APPLICATION, StorageTarget.USER);
					this.storageService.store(this.STORAGE_KEYS.ctrlAApiKey, localKey, StorageScope.APPLICATION, StorageTarget.USER);
				}
			});
			toggleContainer.appendChild(btn);
		}

		row.appendChild(toggleContainer);
		return row;
	}

	private createStub(text: string): HTMLElement {
		const stub = document.createElement('div');
		stub.className = 'devteam-settings-stub';
		stub.textContent = text;
		return stub;
	}
}

const SETTINGS_STYLES = `
	.devteam-settings {
		padding: 12px;
	}

	.devteam-settings-section {
		margin-bottom: 24px;
	}

	.devteam-settings-heading {
		color: #00d4ff;
		font-size: 13px;
		font-weight: 600;
		margin: 0 0 12px 0;
		padding-bottom: 6px;
		border-bottom: 1px solid #2a2a3e;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.devteam-settings-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 12px;
	}

	.devteam-settings-label {
		color: #808080;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.3px;
	}

	.devteam-settings-input {
		background: #1a1a2e;
		border: 1px solid #2a2a3e;
		border-radius: 4px;
		padding: 8px 10px;
		color: #e0e0e0;
		font-family: inherit;
		font-size: 12px;
		outline: none;
		transition: border-color 0.15s;
	}

	.devteam-settings-input:focus {
		border-color: #00d4ff;
	}

	.devteam-settings-input::placeholder {
		color: #444;
	}

	.devteam-toggle-container {
		display: flex;
		gap: 0;
		border: 1px solid #2a2a3e;
		border-radius: 4px;
		overflow: hidden;
	}

	.devteam-toggle-btn {
		flex: 1;
		padding: 6px 12px;
		background: #1a1a2e;
		border: none;
		color: #808080;
		font-family: inherit;
		font-size: 12px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.devteam-toggle-btn:not(:last-child) {
		border-right: 1px solid #2a2a3e;
	}

	.devteam-toggle-btn.active {
		background: #00d4ff22;
		color: #00d4ff;
	}

	.devteam-btn-test {
		padding: 8px 16px;
		background: transparent;
		border: 1px solid #00d4ff33;
		border-radius: 4px;
		color: #00d4ff;
		font-family: inherit;
		font-size: 12px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.devteam-btn-test:hover {
		background: #00d4ff11;
	}

	.devteam-btn-test:disabled {
		opacity: 0.5;
		cursor: wait;
	}

	.devteam-connection-status {
		font-size: 11px;
		margin-top: 4px;
	}

	.devteam-connection-status.success {
		color: #4caf50;
	}

	.devteam-connection-status.error {
		color: #f44336;
	}

	.devteam-settings-stub {
		color: #555;
		font-size: 12px;
		font-style: italic;
		padding: 8px;
		background: #1a1a2e;
		border-radius: 4px;
		border: 1px dashed #2a2a3e;
	}
`;
