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
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IDevClawService } from './devclawService.js';
import { IOpenClawDaemonService } from '../../../../platform/openclaw/common/openclawDaemon.js';

const PROVIDERS = ['CTRL-A', 'Anthropic', 'OpenAI', 'MiniMax', 'OpenRouter'] as const;
type Provider = typeof PROVIDERS[number];

const PROVIDER_PLACEHOLDERS: Record<Provider, string> = {
	'CTRL-A': 'app_...',
	'Anthropic': 'sk-ant-...',
	'OpenAI': 'sk-...',
	'MiniMax': 'eyJ...',
	'OpenRouter': 'sk-or-...',
};

export class DevTeamSettingsPane extends ViewPane {

	static readonly ID = 'devteam.settingsView';

	private readonly STORAGE_KEYS = {
		// Backend selection
		backend: 'devteam.backend',
		// OpenClaw daemon
		openclawPort: 'devteam.openclaw.port',
		openclawToken: 'devteam.openclaw.token',
		openclawProvider: 'devteam.openclaw.provider',
		// OpenClaw Cloud
		openclawUrl: 'devteam.openclaw.url',
		openclawApiKey: 'devteam.openclaw.apiKey',
		// Git Integration
		gitAutoCommit: 'devteam.git.autoCommit',
		gitAutoPush: 'devteam.git.autoPush',
		gitRemoteUrl: 'devteam.git.remoteUrl',
		gitBranch: 'devteam.git.branch',
		// Database
		dbType: 'devteam.db.type',
		dbConnectionString: 'devteam.db.connectionString',
		dbAuthToken: 'devteam.db.authToken',
		// MCP Servers
		mcpServers: 'devteam.mcp.servers',
		// Legacy (kept for migration compat)
		openclawMode: 'devteam.openclaw.mode',
		openclawCloudUrl: 'devteam.openclaw.cloudUrl',
		openclawCloudApiKey: 'devteam.openclaw.cloudApiKey',
		openclawLocalUrl: 'devteam.openclaw.localUrl',
		openclawLocalApiKey: 'devteam.openclaw.localApiKey',
		keyAnthropic: 'devteam.key.anthropic',
		keyOpenAI: 'devteam.key.openai',
		keyMiniMax: 'devteam.key.minimax',
		keyOpenRouter: 'devteam.key.openrouter',
	};

	// Section containers toggled by backend switch
	private openclawLocalSection!: HTMLElement;
	private openclawCloudSection!: HTMLElement;

	// Direct element references (avoid DOM queries)
	private openclawApiKeyInput!: HTMLInputElement;
	private backendToggleBtns: HTMLButtonElement[] = [];

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
		@IDevClawService private readonly devClawService: IDevClawService,
		@IOpenClawDaemonService private readonly daemonService: IOpenClawDaemonService,
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

		// --- Section: Backend Toggle ---
		content.appendChild(this.createSection('Backend', [
			this.createBackendToggle(),
		]));

		// --- Section: OpenClaw (local daemon) ---
		this.openclawLocalSection = this.createSection('OpenClaw (Local Daemon)', [
			this.createDaemonStatus(),
			this.createProviderDropdown(),
			this.createOpenClawApiKeyInput(),
			this.createRestartDaemonButton(),
			this.createPortDisplay(),
		]);
		content.appendChild(this.openclawLocalSection);

		// --- Section: OpenClaw Cloud ---
		this.openclawCloudSection = this.createSection('OpenClaw Cloud', [
			this.createInput('Server URL', 'openclawUrl', 'https://your-openclaw.onrender.com', 'text'),
			this.createInput('API Key', 'openclawApiKey', 'Enter OpenClaw API key', 'password'),
			this.createTestButton(),
		]);
		content.appendChild(this.openclawCloudSection);

		// Apply initial visibility
		this.applyBackendVisibility();

		// --- Section: Git Integration ---
		content.appendChild(this.createSection('Git Integration', [
			this.createInput('Remote URL', 'gitRemoteUrl', 'https://github.com/user/repo.git', 'text'),
			this.createInput('Branch', 'gitBranch', 'main', 'text'),
			this.createToggleRow('Auto-commit', 'gitAutoCommit'),
			this.createToggleRow('Auto-push', 'gitAutoPush'),
		]));

		// --- Section: Database ---
		content.appendChild(this.createSection('Database', [
			this.createDbTypeDropdown(),
			this.createInput('Connection String', 'dbConnectionString', 'libsql://your-db.turso.io', 'text'),
			this.createInput('Auth Token', 'dbAuthToken', 'eyJ... (database auth token)', 'password'),
			this.createTestDbButton(),
		]));

		// --- Section: MCP Servers ---
		content.appendChild(this.createSection('MCP Servers', [
			this.createMcpServerList(),
			this.createAddMcpButton(),
		]));

		container.appendChild(content);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	// ---------------------------------------------------------------------------
	// Backend toggle
	// ---------------------------------------------------------------------------

	private applyBackendVisibility(): void {
		const backend = this.storageService.get(this.STORAGE_KEYS.backend, StorageScope.APPLICATION, 'openclaw');
		if (this.openclawLocalSection && this.openclawCloudSection) {
			this.openclawLocalSection.style.display = backend === 'openclaw' ? 'block' : 'none';
			this.openclawCloudSection.style.display = backend === 'openclaw' ? 'none' : 'block';
		}
	}

	private createBackendToggle(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const labelEl = document.createElement('label');
		labelEl.className = 'devteam-settings-label';
		labelEl.textContent = 'Active Backend';
		row.appendChild(labelEl);

		const toggleContainer = document.createElement('div');
		toggleContainer.className = 'devteam-toggle-container';

		const currentBackend = this.storageService.get(this.STORAGE_KEYS.backend, StorageScope.APPLICATION, 'openclaw');

		const options: Array<{ value: string; label: string }> = [
			{ value: 'openclaw', label: 'OpenClaw' },
			{ value: 'openclaw', label: 'OpenClaw Cloud' },
		];

		this.backendToggleBtns = [];
		for (const opt of options) {
			const btn = document.createElement('button');
			btn.className = `devteam-toggle-btn ${currentBackend === opt.value ? 'active' : ''}`;
			btn.textContent = opt.label;
			btn.addEventListener('click', () => {
				this.storageService.store(this.STORAGE_KEYS.backend, opt.value, StorageScope.APPLICATION, StorageTarget.USER);
				for (const b of this.backendToggleBtns) {
					b.classList.remove('active');
				}
				btn.classList.add('active');
				this.applyBackendVisibility();
				// Reconnect with new backend
				try {
					this.devClawService.reconnect();
				} catch {
					// Service may not be available yet — silently ignore
				}
			});
			this.backendToggleBtns.push(btn);
			toggleContainer.appendChild(btn);
		}

		row.appendChild(toggleContainer);
		return row;
	}

	// ---------------------------------------------------------------------------
	// OpenClaw section helpers
	// ---------------------------------------------------------------------------

	private createDaemonStatus(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const labelEl = document.createElement('label');
		labelEl.className = 'devteam-settings-label';
		labelEl.textContent = 'Daemon Status';
		row.appendChild(labelEl);

		const statusRow = document.createElement('div');
		statusRow.className = 'devteam-daemon-status-row';

		const dot = document.createElement('span');
		const isReady = this.daemonService?.isReady ?? false;
		dot.className = `devteam-daemon-dot ${isReady ? 'running' : 'stopped'}`;

		const text = document.createElement('span');
		text.className = 'devteam-daemon-status-text';
		text.textContent = isReady ? 'Running' : 'Stopped';

		statusRow.appendChild(dot);
		statusRow.appendChild(text);
		row.appendChild(statusRow);
		return row;
	}

	private createProviderDropdown(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const labelEl = document.createElement('label');
		labelEl.className = 'devteam-settings-label';
		labelEl.textContent = 'Provider';
		row.appendChild(labelEl);

		const select = document.createElement('select');
		select.className = 'devteam-settings-select';

		const savedProvider = this.storageService.get(this.STORAGE_KEYS.openclawProvider, StorageScope.APPLICATION, 'Anthropic') as Provider;

		for (const provider of PROVIDERS) {
			const option = document.createElement('option');
			option.value = provider;
			option.textContent = provider;
			option.selected = provider === savedProvider;
			select.appendChild(option);
		}

		select.addEventListener('change', () => {
			const provider = select.value as Provider;
			this.storageService.store(this.STORAGE_KEYS.openclawProvider, provider, StorageScope.APPLICATION, StorageTarget.USER);
			// Update the API key placeholder via direct reference (no DOM query)
			if (this.openclawApiKeyInput) {
				this.openclawApiKeyInput.placeholder = PROVIDER_PLACEHOLDERS[provider] ?? '';
			}
			// Restart daemon with new provider env vars
			try {
				this.daemonService.updateKeys({ provider: provider.toLowerCase() });
			} catch {
				// Service may not be available yet
			}
		});

		row.appendChild(select);
		return row;
	}

	private createOpenClawApiKeyInput(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const labelEl = document.createElement('label');
		labelEl.className = 'devteam-settings-label';
		labelEl.textContent = 'API Key';
		row.appendChild(labelEl);

		const input = document.createElement('input');
		input.className = 'devteam-settings-input';
		input.type = 'password';
		input.spellcheck = false;

		const savedProvider = this.storageService.get(this.STORAGE_KEYS.openclawProvider, StorageScope.APPLICATION, 'Anthropic') as Provider;
		input.placeholder = PROVIDER_PLACEHOLDERS[savedProvider] ?? 'Enter API key';

		const saved = this.storageService.get(this.STORAGE_KEYS.openclawToken, StorageScope.APPLICATION, '');
		if (saved) {
			input.value = saved;
		}

		// Store direct reference for provider dropdown to update placeholder
		this.openclawApiKeyInput = input;

		input.addEventListener('change', () => {
			this.storageService.store(this.STORAGE_KEYS.openclawToken, input.value, StorageScope.APPLICATION, StorageTarget.USER);
			// Restart daemon with new key
			try {
				const provider = this.storageService.get(this.STORAGE_KEYS.openclawProvider, StorageScope.APPLICATION, 'Anthropic') as Provider;
				this.daemonService.updateKeys({ provider: provider.toLowerCase() });
			} catch {
				// Service may not be available yet
			}
		});

		row.appendChild(input);
		return row;
	}

	private createRestartDaemonButton(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const btn = document.createElement('button');
		btn.className = 'devteam-btn devteam-btn-test';
		btn.textContent = 'Restart Daemon';

		const status = document.createElement('span');
		status.className = 'devteam-connection-status';
		status.textContent = '';

		btn.addEventListener('click', async () => {
			btn.disabled = true;
			btn.textContent = 'Restarting...';
			status.textContent = '';
			try {
				const provider = this.storageService.get(this.STORAGE_KEYS.openclawProvider, StorageScope.APPLICATION, 'Anthropic') as Provider;
				await this.daemonService.updateKeys({ provider: provider.toLowerCase() });
				status.textContent = 'Daemon restarted';
				status.className = 'devteam-connection-status success';
			} catch {
				status.textContent = 'Restart failed';
				status.className = 'devteam-connection-status error';
			}
			btn.disabled = false;
			btn.textContent = 'Restart Daemon';
		});

		row.appendChild(btn);
		row.appendChild(status);
		return row;
	}

	private createPortDisplay(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const labelEl = document.createElement('label');
		labelEl.className = 'devteam-settings-label';
		labelEl.textContent = 'Daemon Port';
		row.appendChild(labelEl);

		const input = document.createElement('input');
		input.className = 'devteam-settings-input';
		input.type = 'number';
		input.spellcheck = false;
		input.placeholder = '18789';

		const savedPort = this.storageService.get(this.STORAGE_KEYS.openclawPort, StorageScope.APPLICATION, '18789');
		input.value = savedPort;

		input.addEventListener('change', () => {
			const val = input.value.trim() || '18789';
			this.storageService.store(this.STORAGE_KEYS.openclawPort, val, StorageScope.APPLICATION, StorageTarget.USER);
		});

		row.appendChild(input);
		return row;
	}

	// ---------------------------------------------------------------------------
	// Shared helpers
	// ---------------------------------------------------------------------------

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

			const url = this.storageService.get(this.STORAGE_KEYS.openclawUrl, StorageScope.APPLICATION, '');
			if (!url) {
				status.textContent = 'No URL configured';
				status.className = 'devteam-connection-status error';
				btn.disabled = false;
				btn.textContent = 'Test Connection';
				return;
			}

			try {
				// Use Electron's net module to bypass CORS restrictions
				const gFetch = globalThis.fetch as typeof fetch;
				const res = await gFetch(`${url}/api/health`, {
					signal: AbortSignal.timeout(10000),
					headers: { 'x-api-key': this.storageService.get(this.STORAGE_KEYS.openclawApiKey, StorageScope.APPLICATION, '') },
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

	private createToggleRow(label: string, storageKey: keyof typeof this.STORAGE_KEYS): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row devteam-settings-toggle-row';

		const labelEl = document.createElement('label');
		labelEl.className = 'devteam-settings-label';
		labelEl.textContent = label;

		const toggle = document.createElement('button');
		const isOn = this.storageService.get(this.STORAGE_KEYS[storageKey], StorageScope.APPLICATION, 'false') === 'true';
		toggle.className = `devteam-toggle-pill ${isOn ? 'on' : 'off'}`;
		toggle.textContent = isOn ? 'ON' : 'OFF';

		toggle.addEventListener('click', () => {
			const current = this.storageService.get(this.STORAGE_KEYS[storageKey], StorageScope.APPLICATION, 'false') === 'true';
			const next = !current;
			this.storageService.store(this.STORAGE_KEYS[storageKey], String(next), StorageScope.APPLICATION, StorageTarget.USER);
			toggle.className = `devteam-toggle-pill ${next ? 'on' : 'off'}`;
			toggle.textContent = next ? 'ON' : 'OFF';
		});

		row.appendChild(labelEl);
		row.appendChild(toggle);
		return row;
	}

	private createDbTypeDropdown(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const labelEl = document.createElement('label');
		labelEl.className = 'devteam-settings-label';
		labelEl.textContent = 'Database Type';
		row.appendChild(labelEl);

		const select = document.createElement('select');
		select.className = 'devteam-settings-select';

		const dbTypes = ['Turso (libSQL)', 'SQLite', 'PostgreSQL', 'MySQL', 'Supabase'];
		const savedType = this.storageService.get(this.STORAGE_KEYS.dbType, StorageScope.APPLICATION, 'Turso (libSQL)');

		for (const dbType of dbTypes) {
			const option = document.createElement('option');
			option.value = dbType;
			option.textContent = dbType;
			option.selected = dbType === savedType;
			select.appendChild(option);
		}

		select.addEventListener('change', () => {
			this.storageService.store(this.STORAGE_KEYS.dbType, select.value, StorageScope.APPLICATION, StorageTarget.USER);
		});

		row.appendChild(select);
		return row;
	}

	private createTestDbButton(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'devteam-settings-row';

		const btn = document.createElement('button');
		btn.className = 'devteam-btn devteam-btn-test';
		btn.textContent = 'Test Connection';

		const status = document.createElement('span');
		status.className = 'devteam-connection-status';

		btn.addEventListener('click', async () => {
			btn.disabled = true;
			btn.textContent = 'Testing...';
			status.textContent = '';

			const connStr = this.storageService.get(this.STORAGE_KEYS.dbConnectionString, StorageScope.APPLICATION, '');
			if (!connStr) {
				status.textContent = 'No connection string configured';
				status.className = 'devteam-connection-status error';
				btn.disabled = false;
				btn.textContent = 'Test Connection';
				return;
			}

			// For now, just validate the format
			try {
				if (connStr.startsWith('libsql://') || connStr.startsWith('sqlite://') || connStr.startsWith('postgres') || connStr.startsWith('mysql')) {
					status.textContent = 'Format valid — connection test requires running gateway';
					status.className = 'devteam-connection-status success';
				} else {
					status.textContent = 'Unrecognized connection string format';
					status.className = 'devteam-connection-status error';
				}
			} catch {
				status.textContent = 'Invalid connection string';
				status.className = 'devteam-connection-status error';
			}

			btn.disabled = false;
			btn.textContent = 'Test Connection';
		});

		row.appendChild(btn);
		row.appendChild(status);
		return row;
	}

	private createMcpServerList(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'devteam-mcp-list';

		const savedServers = this.storageService.get(this.STORAGE_KEYS.mcpServers, StorageScope.APPLICATION, '');
		let servers: Array<{ name: string; url: string }> = [];
		try {
			if (savedServers) { servers = JSON.parse(savedServers); }
		} catch { /* ignore */ }

		if (servers.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'devteam-settings-stub';
			empty.textContent = 'No MCP servers configured.';
			container.appendChild(empty);
		} else {
			for (const server of servers) {
				const row = document.createElement('div');
				row.className = 'devteam-mcp-server-row';

				const name = document.createElement('span');
				name.className = 'devteam-mcp-server-name';
				name.textContent = server.name;

				const url = document.createElement('span');
				url.className = 'devteam-mcp-server-url';
				url.textContent = server.url;

				const removeBtn = document.createElement('button');
				removeBtn.className = 'devteam-mcp-remove-btn';
				removeBtn.textContent = '\u00D7'; // multiplication sign (x)
				removeBtn.addEventListener('click', () => {
					const updated = servers.filter(s => s.name !== server.name);
					this.storageService.store(this.STORAGE_KEYS.mcpServers, JSON.stringify(updated), StorageScope.APPLICATION, StorageTarget.USER);
					row.remove();
				});

				row.appendChild(name);
				row.appendChild(url);
				row.appendChild(removeBtn);
				container.appendChild(row);
			}
		}

		return container;
	}

	private createAddMcpButton(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'devteam-mcp-add-form';

		// Name input
		const nameRow = document.createElement('div');
		nameRow.className = 'devteam-settings-row';
		const nameLabel = document.createElement('label');
		nameLabel.className = 'devteam-settings-label';
		nameLabel.textContent = 'Server Name';
		const nameInput = document.createElement('input');
		nameInput.className = 'devteam-settings-input';
		nameInput.type = 'text';
		nameInput.placeholder = 'my-mcp-server';
		nameInput.spellcheck = false;
		nameRow.appendChild(nameLabel);
		nameRow.appendChild(nameInput);

		// URL input
		const urlRow = document.createElement('div');
		urlRow.className = 'devteam-settings-row';
		const urlLabel = document.createElement('label');
		urlLabel.className = 'devteam-settings-label';
		urlLabel.textContent = 'Server URL';
		const urlInput = document.createElement('input');
		urlInput.className = 'devteam-settings-input';
		urlInput.type = 'text';
		urlInput.placeholder = 'http://localhost:3001';
		urlInput.spellcheck = false;
		urlRow.appendChild(urlLabel);
		urlRow.appendChild(urlInput);

		// Add button + status
		const btnRow = document.createElement('div');
		btnRow.className = 'devteam-settings-row';
		const btn = document.createElement('button');
		btn.className = 'devteam-btn devteam-btn-test';
		btn.textContent = '+ Add MCP Server';

		const status = document.createElement('span');
		status.className = 'devteam-connection-status';

		// Reference to the MCP list container so we can update it
		const listContainer = container.parentElement?.querySelector('.devteam-mcp-list');

		btn.addEventListener('click', () => {
			const name = nameInput.value.trim();
			const url = urlInput.value.trim();

			if (!name || !url) {
				status.textContent = 'Name and URL are required';
				status.className = 'devteam-connection-status error';
				return;
			}

			const savedServers = this.storageService.get(this.STORAGE_KEYS.mcpServers, StorageScope.APPLICATION, '');
			let servers: Array<{ name: string; url: string }> = [];
			try { if (savedServers) { servers = JSON.parse(savedServers); } } catch { /* ignore */ }

			if (servers.some(s => s.name === name)) {
				status.textContent = 'Server with this name already exists';
				status.className = 'devteam-connection-status error';
				return;
			}

			servers.push({ name, url });
			this.storageService.store(this.STORAGE_KEYS.mcpServers, JSON.stringify(servers), StorageScope.APPLICATION, StorageTarget.USER);

			// Add row to the list visually
			if (listContainer) {
				// Remove "No MCP servers" stub if present
				const stub = listContainer.querySelector('.devteam-settings-stub');
				if (stub) { stub.remove(); }

				const row = document.createElement('div');
				row.className = 'devteam-mcp-server-row';
				const nameEl = document.createElement('span');
				nameEl.className = 'devteam-mcp-server-name';
				nameEl.textContent = name;
				const urlEl = document.createElement('span');
				urlEl.className = 'devteam-mcp-server-url';
				urlEl.textContent = url;
				const removeBtn = document.createElement('button');
				removeBtn.className = 'devteam-mcp-remove-btn';
				// allow-any-unicode-next-line
				removeBtn.textContent = '\u00D7';
				removeBtn.addEventListener('click', () => {
					const updated = servers.filter(s => s.name !== name);
					this.storageService.store(this.STORAGE_KEYS.mcpServers, JSON.stringify(updated), StorageScope.APPLICATION, StorageTarget.USER);
					row.remove();
				});
				row.appendChild(nameEl);
				row.appendChild(urlEl);
				row.appendChild(removeBtn);
				listContainer.appendChild(row);
			}

			// Clear inputs
			nameInput.value = '';
			urlInput.value = '';
			status.textContent = `Added ${name}`;
			status.className = 'devteam-connection-status success';
		});

		btnRow.appendChild(btn);
		btnRow.appendChild(status);

		container.appendChild(nameRow);
		container.appendChild(urlRow);
		container.appendChild(btnRow);
		return container;
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

	.devteam-settings-select {
		background: #1a1a2e;
		border: 1px solid #2a2a3e;
		border-radius: 4px;
		padding: 8px 10px;
		color: #e0e0e0;
		font-family: inherit;
		font-size: 12px;
		outline: none;
		cursor: pointer;
		transition: border-color 0.15s;
		appearance: none;
		-webkit-appearance: none;
	}

	.devteam-settings-select:focus {
		border-color: #00d4ff;
	}

	.devteam-settings-select option {
		background: #1a1a2e;
		color: #e0e0e0;
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

	.devteam-daemon-status-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.devteam-daemon-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.devteam-daemon-dot.running {
		background: #4caf50;
		box-shadow: 0 0 6px #4caf5088;
	}

	.devteam-daemon-dot.stopped {
		background: #f44336;
		box-shadow: 0 0 6px #f4433688;
	}

	.devteam-daemon-status-text {
		color: #e0e0e0;
		font-size: 12px;
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

	.devteam-settings-toggle-row {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}

	.devteam-toggle-pill {
		padding: 3px 12px;
		border-radius: 12px;
		font-family: inherit;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		border: none;
		transition: all 0.15s;
	}

	.devteam-toggle-pill.on {
		background: #4caf5022;
		color: #4caf50;
	}

	.devteam-toggle-pill.off {
		background: #f4433622;
		color: #f44336;
	}

	.devteam-toggle-pill:hover {
		opacity: 0.8;
	}

	.devteam-mcp-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.devteam-mcp-server-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		background: #1a1a2e;
		border: 1px solid #2a2a3e;
		border-radius: 4px;
	}

	.devteam-mcp-server-name {
		color: #00d4ff;
		font-size: 12px;
		font-weight: 600;
		min-width: 80px;
	}

	.devteam-mcp-server-url {
		color: #808080;
		font-size: 11px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.devteam-mcp-remove-btn {
		background: transparent;
		border: none;
		color: #f44336;
		font-size: 16px;
		cursor: pointer;
		padding: 0 4px;
		line-height: 1;
	}

	.devteam-mcp-remove-btn:hover {
		color: #ff6659;
	}
`;

