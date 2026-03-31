/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  DevClaw - Shared Service
 *  Central service that holds the active AI backend client, selected agent state,
 *  and bridges communication between Chat, Agents, and Settings panes.
 *
 *  Supports two backends:
 *    - 'openclaw' (default) — local OpenClaw gateway via OpenAI-compatible API
 *    - 'openclaw'             — OpenClaw Cloud via REST + WebSocket
 */

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IBackendClient, type ChatResponse } from '../common/backendClient.js';
import { OpenClawClient, type StreamEvent } from '../common/openclawClient.js';
import { OpenClawClient } from '../common/openClawClient.js';

export type BackendType = 'openclaw' | 'openclaw';

export const IDevClawService = createDecorator<IDevClawService>('devClawService');

export interface IDevClawService {
	readonly _serviceBrand: undefined;

	// State
	readonly selectedAgentId: string;
	readonly isConnected: boolean;
	readonly backendType: BackendType;

	// Events
	readonly onAgentSelected: Event<string>;
	readonly onStreamEvent: Event<StreamEvent>;
	readonly onConnectionChanged: Event<boolean>;
	readonly onChatMessage: Event<{ role: 'user' | 'assistant' | 'system'; content: string; agentId?: string }>;

	// Actions
	selectAgent(agentId: string): void;
	sendMessage(message: string): Promise<ChatResponse | null>;
	sendMessageStream(message: string, onChunk: (text: string) => void): Promise<string | null>;
	sendMessageWithContext(message: string, context: string, filePath?: string): Promise<ChatResponse | null>;
	reconnect(): void;
	getClient(): IBackendClient;
}

export class DevClawService extends Disposable implements IDevClawService {

	declare readonly _serviceBrand: undefined;

	/** Active backend client — either OpenClawClient or OpenClawClient. */
	private client: IBackendClient;

	/** Kept separately so WebSocket agent-select calls work when OpenClaw backend is active. */
	private openclawClient: OpenClawClient | null = null;

	private _backendType: BackendType;
	private _selectedAgentId = 'openclaw';
	private _isConnected = false;

	private readonly _onAgentSelected = this._register(new Emitter<string>());
	readonly onAgentSelected: Event<string> = this._onAgentSelected.event;

	private readonly _onStreamEvent = this._register(new Emitter<StreamEvent>());
	readonly onStreamEvent: Event<StreamEvent> = this._onStreamEvent.event;

	private readonly _onConnectionChanged = this._register(new Emitter<boolean>());
	readonly onConnectionChanged: Event<boolean> = this._onConnectionChanged.event;

	private readonly _onChatMessage = this._register(new Emitter<{ role: 'user' | 'assistant' | 'system'; content: string; agentId?: string }>());
	readonly onChatMessage: Event<{ role: 'user' | 'assistant' | 'system'; content: string; agentId?: string }> = this._onChatMessage.event;

	get selectedAgentId(): string { return this._selectedAgentId; }
	get isConnected(): boolean { return this._isConnected; }
	get backendType(): BackendType { return this._backendType; }

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		this._backendType = (this.storageService.get('devteam.backend', StorageScope.APPLICATION, 'openclaw') as BackendType) || 'openclaw';
		this.client = this.createClient();
		this.tryConnect();
	}

	// ---------------------------------------------------------------------------
	// Client factory
	// ---------------------------------------------------------------------------

	private createClient(): IBackendClient {
		if (this._backendType === 'openclaw') {
			const port = this.storageService.get('devteam.openclaw.port', StorageScope.APPLICATION, '18789');
			const token = this.storageService.get('devteam.openclaw.token', StorageScope.APPLICATION, '');
			const baseUrl = `http://localhost:${port || '18789'}`;

			this.openclawClient = null;
			return new OpenClawClient({ baseUrl, token: token || '' });
		}

		// 'openclaw' backend
		const url = this.storageService.get('devteam.openclaw.url', StorageScope.APPLICATION, '');
		const apiKey = this.storageService.get('devteam.openclaw.apiKey', StorageScope.APPLICATION, '');

		const openclaw = new OpenClawClient({
			baseUrl: url || 'http://localhost:3000',
			apiKey: apiKey || '',
		});

		// Wire WebSocket stream events through the service emitter
		openclaw.onAll((event) => {
			this._onStreamEvent.fire(event);
		});

		this.openclawClient = openclaw;
		return openclaw;
	}

	// ---------------------------------------------------------------------------
	// Agent selection
	// ---------------------------------------------------------------------------

	selectAgent(agentId: string): void {
		this._selectedAgentId = agentId;
		this._onAgentSelected.fire(agentId);

		// Notify OpenClaw backend via WebSocket if connected
		if (this._isConnected && this.openclawClient) {
			this.openclawClient.selectAgent(agentId);
		}
	}

	// ---------------------------------------------------------------------------
	// Messaging
	// ---------------------------------------------------------------------------

	async sendMessage(message: string): Promise<ChatResponse | null> {
		this._onChatMessage.fire({ role: 'user', content: message });

		if (!this._isConnected) {
			const backendName = this._backendType === 'openclaw' ? 'OpenClaw' : 'OpenClaw';
			this._onChatMessage.fire({
				role: 'system',
				content: `Not connected to ${backendName}. Configure your connection in DevClaw Settings.`,
			});
			return null;
		}

		try {
			const response = await this.client.chat(this._selectedAgentId, message);
			this._onChatMessage.fire({
				role: 'assistant',
				content: response.response,
				agentId: this._selectedAgentId,
			});
			return response;
		} catch (err) {
			this._onChatMessage.fire({
				role: 'system',
				content: `Error: ${err instanceof Error ? err.message : String(err)}`,
			});
			return null;
		}
	}

	async sendMessageStream(message: string, onChunk: (text: string) => void): Promise<string | null> {
		this._onChatMessage.fire({ role: 'user', content: message });

		if (!this._isConnected) {
			const backendName = this._backendType === 'openclaw' ? 'OpenClaw' : 'OpenClaw';
			this._onChatMessage.fire({
				role: 'system',
				content: `Not connected to ${backendName}. Configure your connection in DevClaw Settings.`,
			});
			return null;
		}

		try {
			const response = await this.client.chatStream(this._selectedAgentId, message, onChunk);
			this._onChatMessage.fire({
				role: 'assistant',
				content: response,
				agentId: this._selectedAgentId,
			});
			return response;
		} catch (err) {
			this._onChatMessage.fire({
				role: 'system',
				content: `Error: ${err instanceof Error ? err.message : String(err)}`,
			});
			return null;
		}
	}

	async sendMessageWithContext(message: string, context: string, filePath?: string): Promise<ChatResponse | null> {
		const fullMessage = filePath
			? `${message}\n\nFile: ${filePath}\n\`\`\`\n${context}\n\`\`\``
			: `${message}\n\n\`\`\`\n${context}\n\`\`\``;

		return this.sendMessage(fullMessage);
	}

	// ---------------------------------------------------------------------------
	// Reconnect
	// ---------------------------------------------------------------------------

	reconnect(): void {
		// Dispose the current client cleanly
		this.client.dispose();
		this.openclawClient = null;
		this._isConnected = false;

		// Re-read backend type in case it changed in settings
		this._backendType = (this.storageService.get('devteam.backend', StorageScope.APPLICATION, 'openclaw') as BackendType) || 'openclaw';
		this.client = this.createClient();
		this.tryConnect();
	}

	// ---------------------------------------------------------------------------
	// Accessors
	// ---------------------------------------------------------------------------

	getClient(): IBackendClient {
		return this.client;
	}

	// ---------------------------------------------------------------------------
	// Internal
	// ---------------------------------------------------------------------------

	private async tryConnect(): Promise<void> {
		try {
			await this.client.getHealth();
			this._isConnected = true;
			this._onConnectionChanged.fire(true);

			// Connect WebSocket only when OpenClaw backend is active
			if (this.openclawClient) {
				this.openclawClient.connectWs();
			}
		} catch {
			this._isConnected = false;
			this._onConnectionChanged.fire(false);
		}
	}

	override dispose(): void {
		this.client.dispose();
		this.openclawClient = null;
		super.dispose();
	}
}

registerSingleton(IDevClawService, DevClawService, InstantiationType.Delayed);
