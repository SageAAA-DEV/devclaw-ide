/*---------------------------------------------------------------------------------------------
 *  DevClaw - Shared Service
 *  Central service that holds the CTRL-A client, selected agent state,
 *  and bridges communication between Chat, Agents, and Settings panes.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { CtrlAClient, type StreamEvent, type ChatResponse } from '../common/ctrlAClient.js';

export const IDevClawService = createDecorator<IDevClawService>('devClawService');

export interface IDevClawService {
	readonly _serviceBrand: undefined;

	// State
	readonly selectedAgentId: string;
	readonly isConnected: boolean;

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
	getClient(): CtrlAClient;
}

export class DevClawService extends Disposable implements IDevClawService {

	declare readonly _serviceBrand: undefined;

	private client: CtrlAClient;
	private _selectedAgentId = 'ctrl-a';
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

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		// Initialize client from saved settings
		const url = this.storageService.get('devteam.ctrlA.url', StorageScope.APPLICATION, '');
		const apiKey = this.storageService.get('devteam.ctrlA.apiKey', StorageScope.APPLICATION, '');

		this.client = new CtrlAClient({
			baseUrl: url || 'http://localhost:3000',
			apiKey: apiKey || '',
		});

		// Wire up WebSocket events
		this.client.onAll((event) => {
			this._onStreamEvent.fire(event);
		});

		// Auto-connect if URL is configured
		if (url) {
			this.tryConnect();
		}
	}

	selectAgent(agentId: string): void {
		this._selectedAgentId = agentId;
		this._onAgentSelected.fire(agentId);

		// Tell CTRL-A via WebSocket
		if (this._isConnected) {
			this.client.selectAgent(agentId);
		}
	}

	async sendMessage(message: string): Promise<ChatResponse | null> {
		// Fire user message event
		this._onChatMessage.fire({ role: 'user', content: message });

		if (!this._isConnected) {
			// Not connected — fire a system message
			this._onChatMessage.fire({
				role: 'system',
				content: 'Not connected to CTRL-A. Configure your connection in DevClaw Settings.',
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
			this._onChatMessage.fire({
				role: 'system',
				content: 'Not connected to CTRL-A. Configure your connection in DevClaw Settings.',
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

	reconnect(): void {
		const url = this.storageService.get('devteam.ctrlA.url', StorageScope.APPLICATION, '');
		const apiKey = this.storageService.get('devteam.ctrlA.apiKey', StorageScope.APPLICATION, '');

		this.client.disconnect();
		this.client.updateConfig({
			baseUrl: url || 'http://localhost:3000',
			apiKey: apiKey || '',
		});

		if (url) {
			this.tryConnect();
		}
	}

	getClient(): CtrlAClient {
		return this.client;
	}

	private async tryConnect(): Promise<void> {
		try {
			await this.client.getHealth();
			this._isConnected = true;
			this._onConnectionChanged.fire(true);

			// Also connect WebSocket
			this.client.connectWs();
		} catch {
			this._isConnected = false;
			this._onConnectionChanged.fire(false);
		}
	}

	override dispose(): void {
		this.client.dispose();
		super.dispose();
	}
}

registerSingleton(IDevClawService, DevClawService, InstantiationType.Delayed);
