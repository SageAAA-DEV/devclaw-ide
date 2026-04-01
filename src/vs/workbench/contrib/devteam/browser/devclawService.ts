/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  DevClaw - Shared Service
 *  Central service that holds the active AI backend client, selected agent state,
 *  and bridges communication between Chat, Agents, and Settings panes.
 *
 *  Backend: OpenClaw (local daemon) via OpenAI-compatible API.
 */

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IBackendClient, type ChatResponse } from '../common/backendClient.js';
import { OpenClawClient } from '../common/openClawClient.js';
import { IGatewayRpcService } from './gatewayRpcService.js';

export type BackendType = 'openclaw';

/** Generic stream event — placeholder for future SSE/streaming support. */
export interface StreamEvent {
	type: string;
	data?: unknown;
}

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

	/** Active backend client — OpenClawClient (local daemon). */
	private client: IBackendClient;

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
		@IGatewayRpcService private readonly gatewayRpc: IGatewayRpcService,
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
		const port = this.storageService.get('devteam.openclaw.port', StorageScope.APPLICATION, '18789');
		const token = this.storageService.get('devteam.openclaw.token', StorageScope.APPLICATION, '');
		const baseUrl = `http://localhost:${port || '18789'}`;

		return new OpenClawClient({ baseUrl, token: token || '' });
	}

	// ---------------------------------------------------------------------------
	// Agent selection
	// ---------------------------------------------------------------------------

	selectAgent(agentId: string): void {
		this._selectedAgentId = agentId;
		this._onAgentSelected.fire(agentId);
	}

	// ---------------------------------------------------------------------------
	// Messaging
	// ---------------------------------------------------------------------------

	async sendMessage(message: string): Promise<ChatResponse | null> {
		this._onChatMessage.fire({ role: 'user', content: message });

		if (!this._isConnected) {
			// Try to reconnect via gateway RPC
			try {
				await this.gatewayRpc.ensureConnected();
				this._isConnected = true;
				this._onConnectionChanged.fire(true);
			} catch {
				this._onChatMessage.fire({
					role: 'system',
					content: 'Not connected to OpenClaw. Configure your connection in DevClaw Settings.',
				});
				return null;
			}
		}

		try {
			const agentId = this._selectedAgentId === 'openclaw' ? 'main' : this._selectedAgentId;
			const sessionKey = `agent:${agentId}:devclaw`;
			const idempotencyKey = crypto.randomUUID();

			// Send chat message via WebSocket RPC — async, returns runId
			const sendResult = await this.gatewayRpc.call<{ runId: string; status: string }>('chat.send', {
				sessionKey,
				idempotencyKey,
				message,
			});

			// Poll for completion by checking session preview
			// The gateway fires events but we can't listen to them from this service easily,
			// so we poll with a short delay
			let content = '';
			for (let attempt = 0; attempt < 60; attempt++) {
				await new Promise(r => setTimeout(r, 500));
				try {
					const preview = await this.gatewayRpc.call<{
						previews?: Array<{
							key: string;
							items?: Array<{ role: string; text: string }>;
						}>;
					}>('sessions.preview', { keys: [sessionKey] });

					const items = preview.previews?.[0]?.items ?? [];
					// Find the last assistant message
					const lastAssistant = [...items].reverse().find(i => i.role === 'assistant');
					if (lastAssistant?.text) {
						content = lastAssistant.text;
						break;
					}
				} catch {
					// Preview not ready yet — keep polling
				}
			}

			if (!content) {
				content = '(No response received — the agent may still be processing)';
			}

			this._onChatMessage.fire({
				role: 'assistant',
				content,
				agentId: this._selectedAgentId,
			});
			return {
				response: content,
				agentId: this._selectedAgentId,
				conversationId: sessionKey,
			};
		} catch (err) {
			this._onChatMessage.fire({
				role: 'system',
				content: `Error: ${err instanceof Error ? err.message : String(err)}`,
			});
			return null;
		}
	}

	async sendMessageStream(message: string, onChunk: (text: string) => void): Promise<string | null> {
		// WebSocket RPC doesn't support streaming — fall back to regular send
		const result = await this.sendMessage(message);
		if (result) {
			onChunk(result.response);
			return result.response;
		}
		return null;
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
		this._isConnected = false;

		this._backendType = 'openclaw';
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
			// Use the shared WebSocket RPC service for health check
			await this.gatewayRpc.ensureConnected();
			await this.gatewayRpc.call('health', {});
			this._isConnected = true;
			this._onConnectionChanged.fire(true);
		} catch {
			this._isConnected = false;
			this._onConnectionChanged.fire(false);
		}

		// Also listen for gateway connection state changes
		this.gatewayRpc.onDidConnect(() => {
			this._isConnected = true;
			this._onConnectionChanged.fire(true);
		});
		this.gatewayRpc.onDidDisconnect(() => {
			this._isConnected = false;
			this._onConnectionChanged.fire(false);
		});
	}

	override dispose(): void {
		this.client.dispose();
		super.dispose();
	}
}

registerSingleton(IDevClawService, DevClawService, InstantiationType.Delayed);
