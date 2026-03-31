/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IOpenClawDaemonService } from '../../../../platform/openclaw/common/openclawDaemon.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ChatViewId } from '../../chat/browser/chat.js';

const WIZARD_COMPLETE_KEY = 'devteam.wizardComplete';
const OPENCLAW_PORT_KEY = 'devteam.openclaw.port';
const OPENCLAW_TOKEN_KEY = 'devteam.openclaw.token';
const BACKEND_KEY = 'devteam.backend';

type Provider = 'anthropic' | 'openai' | 'minimax' | 'openrouter';

const PROVIDER_LABELS: Record<Provider, string> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	minimax: 'MiniMax',
	openrouter: 'OpenRouter',
};

const PROVIDER_PLACEHOLDERS: Record<Provider, string> = {
	anthropic: 'sk-ant-...',
	openai: 'sk-...',
	minimax: 'eyJ... (MiniMax API Key)',
	openrouter: 'sk-or-...',
};

const WIZARD_STYLES = `
.devteam-wizard-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.85);
	z-index: 9999;
	display: flex;
	align-items: center;
	justify-content: center;
	font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
	animation: devteam-fade-in 0.25s ease;
}

@keyframes devteam-fade-in {
	from { opacity: 0; }
	to   { opacity: 1; }
}

.devteam-wizard-card {
	background: #0d0d1a;
	border: 1px solid #2a2a3e;
	border-radius: 12px;
	padding: 40px 48px;
	width: 480px;
	max-width: calc(100vw - 48px);
	box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.devteam-wizard-header {
	color: #00d4ff;
	font-size: 24px;
	font-weight: 700;
	margin: 0;
	letter-spacing: -0.3px;
}

.devteam-wizard-subtitle {
	color: #808080;
	font-size: 13px;
	margin: -8px 0 0;
	line-height: 1.5;
}

.devteam-wizard-label {
	color: #e0e0e0;
	font-size: 12px;
	margin-bottom: 6px;
	display: block;
}

.devteam-wizard-select,
.devteam-wizard-input {
	width: 100%;
	background: #111125;
	border: 1px solid #2a2a3e;
	border-radius: 6px;
	color: #e0e0e0;
	font-family: inherit;
	font-size: 13px;
	padding: 10px 12px;
	box-sizing: border-box;
	outline: none;
	transition: border-color 0.15s ease;
	appearance: none;
	-webkit-appearance: none;
}

.devteam-wizard-select:focus,
.devteam-wizard-input:focus {
	border-color: #00d4ff;
}

.devteam-wizard-select option {
	background: #0d0d1a;
}

.devteam-wizard-btn {
	width: 100%;
	background: #00d4ff;
	color: #0d0d1a;
	border: none;
	border-radius: 6px;
	font-family: inherit;
	font-size: 14px;
	font-weight: 700;
	padding: 12px;
	cursor: pointer;
	transition: opacity 0.15s ease, transform 0.1s ease;
	letter-spacing: 0.3px;
}

.devteam-wizard-btn:hover:not(:disabled) {
	opacity: 0.88;
	transform: translateY(-1px);
}

.devteam-wizard-btn:active:not(:disabled) {
	transform: translateY(0);
}

.devteam-wizard-btn:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}

.devteam-wizard-status {
	font-size: 12px;
	min-height: 18px;
	color: #808080;
	text-align: center;
}

.devteam-wizard-status.error {
	color: #f44336;
}

.devteam-wizard-status.success {
	color: #00d4ff;
}

.devteam-wizard-footer {
	text-align: center;
}

.devteam-wizard-advanced {
	color: #808080;
	font-size: 12px;
	text-decoration: none;
	border-bottom: 1px dashed #2a2a3e;
	cursor: pointer;
	background: none;
	border-top: none;
	border-left: none;
	border-right: none;
	font-family: inherit;
	padding: 0;
	transition: color 0.15s ease;
}

.devteam-wizard-advanced:hover {
	color: #e0e0e0;
}

.devteam-wizard-retry-btn {
	background: none;
	border: 1px solid #f44336;
	border-radius: 5px;
	color: #f44336;
	font-family: inherit;
	font-size: 12px;
	padding: 5px 14px;
	cursor: pointer;
	margin-top: 6px;
	transition: background 0.15s ease;
}

.devteam-wizard-retry-btn:hover {
	background: rgba(244, 67, 54, 0.1);
}
`;

export class WelcomeWizardContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'devclaw.welcomeWizard';

	private overlay: HTMLElement | null = null;
	private retryBtn: HTMLButtonElement | null = null;
	private stylesInjected = false;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IOpenClawDaemonService private readonly daemonService: IOpenClawDaemonService,
		@IViewsService private readonly viewsService: IViewsService,
	) {
		super();
		this._checkAndShow();
	}

	private _checkAndShow(): void {
		const isComplete = this.storageService.get(WIZARD_COMPLETE_KEY, StorageScope.APPLICATION);
		if (!isComplete) {
			setTimeout(() => this._show(), 500);
		}
	}

	private _show(): void {
		this._injectStyles();

		const overlay = document.createElement('div');
		overlay.className = 'devteam-wizard-overlay';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-label', 'DevTeam first-launch setup');

		const card = document.createElement('div');
		card.className = 'devteam-wizard-card';

		// Header
		const header = document.createElement('h1');
		header.className = 'devteam-wizard-header';
		header.textContent = 'Welcome to DevClaw IDE';

		const subtitle = document.createElement('p');
		subtitle.className = 'devteam-wizard-subtitle';
		subtitle.textContent = 'Your OpenClaw gateway is ready. Add your API key to get started.';

		// Provider field
		const providerGroup = document.createElement('div');
		const providerLabel = document.createElement('label');
		providerLabel.className = 'devteam-wizard-label';
		providerLabel.textContent = 'AI Provider';
		providerLabel.setAttribute('for', 'devteam-provider-select');

		const providerSelect = document.createElement('select');
		providerSelect.className = 'devteam-wizard-select';
		providerSelect.id = 'devteam-provider-select';

		const providers: Provider[] = ['anthropic', 'openai', 'minimax', 'openrouter'];
		for (const p of providers) {
			const opt = document.createElement('option');
			opt.value = p;
			opt.textContent = PROVIDER_LABELS[p];
			if (p === 'anthropic') {
				opt.selected = true;
			}
			providerSelect.appendChild(opt);
		}

		providerGroup.appendChild(providerLabel);
		providerGroup.appendChild(providerSelect);

		// API Key field
		const keyGroup = document.createElement('div');
		const keyLabel = document.createElement('label');
		keyLabel.className = 'devteam-wizard-label';
		keyLabel.textContent = 'API Key';
		keyLabel.setAttribute('for', 'devteam-apikey-input');

		const keyInput = document.createElement('input');
		keyInput.className = 'devteam-wizard-input';
		keyInput.id = 'devteam-apikey-input';
		keyInput.type = 'password';
		keyInput.placeholder = PROVIDER_PLACEHOLDERS['anthropic'];
		keyInput.autocomplete = 'off';
		keyInput.spellcheck = false;

		keyGroup.appendChild(keyLabel);
		keyGroup.appendChild(keyInput);

		// Update placeholder when provider changes
		providerSelect.addEventListener('change', () => {
			const selected = providerSelect.value as Provider;
			keyInput.placeholder = PROVIDER_PLACEHOLDERS[selected];
		});

		// Status area
		const statusArea = document.createElement('div');
		statusArea.className = 'devteam-wizard-status';
		statusArea.setAttribute('aria-live', 'polite');

		// Start button
		const startBtn = document.createElement('button');
		startBtn.className = 'devteam-wizard-btn';
		startBtn.textContent = 'Start DevTeam';
		startBtn.type = 'button';

		startBtn.addEventListener('click', () => {
			this._handleStart(providerSelect, keyInput, startBtn, statusArea);
		});

		// Allow Enter key on input to trigger start
		keyInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this._handleStart(providerSelect, keyInput, startBtn, statusArea);
			}
		});

		// Footer / Advanced link
		const footer = document.createElement('div');
		footer.className = 'devteam-wizard-footer';
		const advancedLink = document.createElement('button');
		advancedLink.className = 'devteam-wizard-advanced';
		advancedLink.type = 'button';
		advancedLink.textContent = 'Advanced settings';
		advancedLink.addEventListener('click', () => {
			// Open settings with devteam filter
			this._dismiss();
		});
		footer.appendChild(advancedLink);

		card.appendChild(header);
		card.appendChild(subtitle);
		card.appendChild(providerGroup);
		card.appendChild(keyGroup);
		card.appendChild(startBtn);
		card.appendChild(statusArea);
		card.appendChild(footer);

		overlay.appendChild(card);
		mainWindow.document.body.appendChild(overlay);
		this.overlay = overlay;

		// Focus key input after render
		mainWindow.requestAnimationFrame(() => keyInput.focus());
	}

	private async _handleStart(
		providerSelect: HTMLSelectElement,
		keyInput: HTMLInputElement,
		startBtn: HTMLButtonElement,
		statusArea: HTMLDivElement,
	): Promise<void> {
		const provider = providerSelect.value as Provider;
		const apiKey = keyInput.value.trim();

		// Step 1 — validate
		if (!apiKey) {
			this._setStatus(statusArea, 'error', 'Please enter an API key before continuing.');
			keyInput.focus();
			return;
		}

		// Disable inputs while working
		startBtn.disabled = true;
		providerSelect.disabled = true;
		keyInput.disabled = true;
		this._setStatus(statusArea, '', 'Starting your agent...');

		try {
			// Step 3 — install daemon
			this._setStatus(statusArea, '', 'Installing OpenClaw daemon...');
			const daemonConfig = await this.daemonService.install();

			// Step 4 — persist API key for selected provider
			this._setStatus(statusArea, '', 'Saving API key...');
			const keyField = `${provider}Key` as keyof Pick<import('../../../../platform/openclaw/common/openclawDaemon.js').IOpenClawDaemonConfig, 'anthropicKey' | 'openaiKey' | 'minimaxKey' | 'openrouterKey'>;
			await this.daemonService.updateKeys({ provider, [keyField]: apiKey });

			// Step 5 — save backend preference
			this.storageService.store(BACKEND_KEY, 'openclaw', StorageScope.APPLICATION, StorageTarget.MACHINE);

			// Step 6 — persist port + token from install result
			if (daemonConfig?.port) {
				this.storageService.store(OPENCLAW_PORT_KEY, String(daemonConfig.port), StorageScope.APPLICATION, StorageTarget.MACHINE);
			}
			if (daemonConfig?.token) {
				this.storageService.store(OPENCLAW_TOKEN_KEY, daemonConfig.token, StorageScope.APPLICATION, StorageTarget.MACHINE);
			}

			// Step 7 — start daemon
			this._setStatus(statusArea, '', 'Starting agent daemon...');
			const started = await this.daemonService.start();

			// Step 8 — verify daemon started
			this._setStatus(statusArea, '', 'Verifying connection...');
			if (!started) {
				throw new Error('Daemon failed to start. The agent process may not have started correctly.');
			}

			// Mark wizard complete and open chat
			this.storageService.store(WIZARD_COMPLETE_KEY, 'true', StorageScope.APPLICATION, StorageTarget.MACHINE);
			this._setStatus(statusArea, 'success', 'Agent connected! Opening chat...');

			await new Promise<void>(resolve => setTimeout(resolve, 600));
			this._dismiss();
			await this.viewsService.openView(ChatViewId, true);

		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._showError(statusArea, startBtn, providerSelect, keyInput, message);
		}
	}

	private _setStatus(area: HTMLDivElement, cls: string, text: string): void {
		area.className = `devteam-wizard-status${cls ? ' ' + cls : ''}`;
		area.textContent = text;
	}

	private _showError(
		statusArea: HTMLDivElement,
		startBtn: HTMLButtonElement,
		providerSelect: HTMLSelectElement,
		keyInput: HTMLInputElement,
		message: string,
	): void {
		// Clear old retry button if present
		if (this.retryBtn) {
			this.retryBtn.remove();
			this.retryBtn = null;
		}

		this._setStatus(statusArea, 'error', `Error: ${message}`);

		// Re-enable inputs
		startBtn.disabled = false;
		providerSelect.disabled = false;
		keyInput.disabled = false;

		// Add Retry button below status
		const retryBtn = document.createElement('button');
		this.retryBtn = retryBtn;
		retryBtn.className = 'devteam-wizard-retry-btn';
		retryBtn.type = 'button';
		retryBtn.textContent = 'Retry';
		retryBtn.addEventListener('click', () => {
			this.retryBtn = null;
			retryBtn.remove();
			this._setStatus(statusArea, '', '');
			this._handleStart(providerSelect, keyInput, startBtn, statusArea);
		});

		statusArea.insertAdjacentElement('afterend', retryBtn);
	}

	private _dismiss(): void {
		if (this.overlay) {
			this.overlay.remove();
			this.overlay = null;
		}
	}

	private _injectStyles(): void {
		if (this.stylesInjected) {
			return;
		}
		this.stylesInjected = true;
		const style = mainWindow.document.createElement('style');
		style.textContent = WIZARD_STYLES;
		mainWindow.document.head.appendChild(style);
	}

	override dispose(): void {
		this._dismiss();
		super.dispose();
	}
}
