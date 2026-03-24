/*---------------------------------------------------------------------------------------------
 *  DevTeam IDE - CTRL-A Client
 *  Handles all communication with the CTRL-A backend via REST API + WebSocket.
 *--------------------------------------------------------------------------------------------*/

export interface CtrlAConfig {
	baseUrl: string;      // e.g. http://localhost:3000
	apiKey: string;
}

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export interface ChatResponse {
	response: string;
	agentId: string;
	conversationId: string;
	toolCalls?: ToolCallResult[];
	sentiment?: { type: string; intensity: number };
}

export interface ToolCallResult {
	name: string;
	result: unknown;
}

export interface AgentInfo {
	id: string;
	name: string;
	role: string;
	vertical: string;
	status: string;
	description?: string;
}

export type StreamEventType = 'response' | 'tool-start' | 'tool-complete' | 'error' | 'pong' | 'agent-selected';

export interface StreamEvent {
	type: StreamEventType;
	data: unknown;
	timestamp: number;
}

type StreamListener = (event: StreamEvent) => void;

export class CtrlAClient {

	private ws: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly listeners: Map<StreamEventType, Set<StreamListener>> = new Map();
	private readonly allListeners: Set<StreamListener> = new Set();
	private connected = false;

	constructor(private config: CtrlAConfig) {}

	// --- Configuration ---

	updateConfig(config: Partial<CtrlAConfig>): void {
		this.config = { ...this.config, ...config };
	}

	getConfig(): Readonly<CtrlAConfig> {
		return this.config;
	}

	// --- REST API ---

	async chat(agentId: string, message: string, conversationId?: string): Promise<ChatResponse> {
		const body: Record<string, unknown> = { message, agentId };
		if (conversationId) {
			body.conversationId = conversationId;
		}
		return this.post<ChatResponse>('/api/chat', body);
	}

	async listAgents(): Promise<AgentInfo[]> {
		return this.get<AgentInfo[]>('/api/agents');
	}

	async getHealth(): Promise<{ status: string; version: string }> {
		return this.get<{ status: string; version: string }>('/api/health');
	}

	private async get<T>(path: string): Promise<T> {
		const res = await fetch(`${this.config.baseUrl}${path}`, {
			headers: this.headers(),
		});
		if (!res.ok) {
			throw new Error(`CTRL-A API error: ${res.status} ${res.statusText}`);
		}
		return res.json() as Promise<T>;
	}

	private async post<T>(path: string, body: unknown): Promise<T> {
		const res = await fetch(`${this.config.baseUrl}${path}`, {
			method: 'POST',
			headers: { ...this.headers(), 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			throw new Error(`CTRL-A API error: ${res.status} ${res.statusText}`);
		}
		return res.json() as Promise<T>;
	}

	private headers(): Record<string, string> {
		return { 'x-api-key': this.config.apiKey };
	}

	// --- WebSocket ---

	connectWs(): void {
		if (this.ws && this.connected) {
			return;
		}

		this.clearReconnect();

		const wsUrl = this.config.baseUrl.replace(/^http/, 'ws') + '/ws';
		this.ws = new WebSocket(wsUrl);

		this.ws.onopen = () => {
			this.connected = true;
			// Authenticate
			this.wsSend({ type: 'auth', apiKey: this.config.apiKey });
		};

		this.ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data as string);
				const streamEvent: StreamEvent = {
					type: data.type ?? 'response',
					data: data,
					timestamp: Date.now(),
				};
				this.emit(streamEvent);
			} catch {
				// Ignore malformed messages
			}
		};

		this.ws.onclose = () => {
			this.connected = false;
			this.ws = null;
			this.scheduleReconnect();
		};

		this.ws.onerror = () => {
			// onclose will fire after this
		};
	}

	sendChat(content: string): void {
		this.wsSend({ type: 'chat', content });
	}

	selectAgent(agentId: string): void {
		this.wsSend({ type: 'select-agent', agentId });
	}

	disconnect(): void {
		this.clearReconnect();
		if (this.ws) {
			this.ws.onclose = null; // Prevent reconnect
			this.ws.close();
			this.ws = null;
		}
		this.connected = false;
	}

	isConnected(): boolean {
		return this.connected;
	}

	// --- Event System ---

	on(type: StreamEventType, listener: StreamListener): () => void {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, new Set());
		}
		this.listeners.get(type)!.add(listener);
		return () => this.listeners.get(type)?.delete(listener);
	}

	onAll(listener: StreamListener): () => void {
		this.allListeners.add(listener);
		return () => this.allListeners.delete(listener);
	}

	private emit(event: StreamEvent): void {
		// Type-specific listeners
		const typed = this.listeners.get(event.type);
		if (typed) {
			for (const listener of typed) {
				listener(event);
			}
		}
		// All-event listeners
		for (const listener of this.allListeners) {
			listener(event);
		}
	}

	// --- Internal ---

	private wsSend(data: unknown): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(data));
		}
	}

	private scheduleReconnect(): void {
		this.clearReconnect();
		this.reconnectTimer = setTimeout(() => this.connectWs(), 3000);
	}

	private clearReconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	dispose(): void {
		this.disconnect();
		this.listeners.clear();
		this.allListeners.clear();
	}
}
