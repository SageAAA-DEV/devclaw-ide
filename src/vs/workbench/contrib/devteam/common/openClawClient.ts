/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IBackendClient, type ChatResponse, type AgentInfo } from './backendClient.js';

export interface OpenClawConfig {
	baseUrl: string;   // e.g. http://localhost:18789
	token: string;
}

/** Hardcoded agent roster — OpenClaw has no agent discovery endpoint. */
const OPENCLAW_AGENTS: AgentInfo[] = [
	{ id: 'openclaw', name: 'OpenClaw', role: 'General Assistant', vertical: 'platform', status: 'available', description: 'Core OpenClaw platform agent' },
	{ id: 'devin', name: 'Devin', role: 'Senior Engineer', vertical: 'dev', status: 'available', description: 'Full-stack development & architecture' },
	{ id: 'scout', name: 'Scout', role: 'Research Analyst', vertical: 'research', status: 'available', description: 'Market research & competitive analysis' },
	{ id: 'sage', name: 'Sage', role: 'Business Strategist', vertical: 'strategy', status: 'available', description: 'Business strategy & product decisions' },
	{ id: 'ink', name: 'Ink', role: 'Content Specialist', vertical: 'content', status: 'available', description: 'Copywriting, docs & creative content' },
];

interface OpenAIMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

interface OpenAIChoice {
	message?: { content: string };
	delta?: { content?: string };
}

interface OpenAIResponse {
	choices: OpenAIChoice[];
}

export class OpenClawClient implements IBackendClient {

	private config: OpenClawConfig;
	private connected = false;
	/** Active conversation IDs keyed by agentId. */
	private readonly conversations: Map<string, string> = new Map();

	constructor(config: OpenClawConfig) {
		this.config = { ...config };
	}

	// --- Configuration ---

	updateConfig(config: Partial<OpenClawConfig>): void {
		this.config = { ...this.config, ...config };
	}

	getConfig(): Readonly<OpenClawConfig> {
		return this.config;
	}

	// --- Connection state ---

	isConnected(): boolean {
		return this.connected;
	}

	setConnected(value: boolean): void {
		this.connected = value;
	}

	resetConversation(agentId?: string): void {
		if (agentId) {
			this.conversations.delete(agentId);
		} else {
			this.conversations.clear();
		}
	}

	// --- IBackendClient ---

	async chat(agentId: string, message: string, conversationId?: string): Promise<ChatResponse> {
		// Reuse existing conversation or accept caller-supplied one
		const convId = conversationId ?? this.conversations.get(agentId) ?? crypto.randomUUID();
		this.conversations.set(agentId, convId);

		const messages: OpenAIMessage[] = [
			{ role: 'user', content: message },
		];

		const res = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify({
				model: `openclaw:${agentId}`,
				messages,
				user: convId,
			}),
		});

		if (!res.ok) {
			throw new Error(`OpenClaw error: ${res.status} ${res.statusText}`);
		}

		const data = await res.json() as OpenAIResponse;
		const content = data.choices?.[0]?.message?.content ?? '';

		return {
			response: content,
			agentId,
			conversationId: convId,
		};
	}

	async chatStream(agentId: string, message: string, onChunk: (text: string) => void): Promise<string> {
		const convId = this.conversations.get(agentId) ?? crypto.randomUUID();
		this.conversations.set(agentId, convId);

		const messages: OpenAIMessage[] = [
			{ role: 'user', content: message },
		];

		const res = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify({
				model: `openclaw:${agentId}`,
				messages,
				user: convId,
				stream: true,
			}),
		});

		if (!res.ok) {
			throw new Error(`OpenClaw stream error: ${res.status} ${res.statusText}`);
		}

		if (!res.body) {
			// Fallback: non-streaming response
			const data = await res.json() as OpenAIResponse;
			const content = data.choices?.[0]?.message?.content ?? '';
			onChunk(content);
			return content;
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let fullResponse = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			const chunk = decoder.decode(value, { stream: true });
			const lines = chunk.split('\n');

			for (const line of lines) {
				if (!line.startsWith('data: ')) {
					continue;
				}

				const payload = line.slice(6).trim();
				if (payload === '[DONE]') {
					continue;
				}

				try {
					const parsed = JSON.parse(payload) as OpenAIResponse;
					const text = parsed.choices?.[0]?.delta?.content ?? '';
					if (text) {
						fullResponse += text;
						onChunk(text);
					}
				} catch {
					// Ignore malformed SSE lines
				}
			}
		}

		return fullResponse;
	}

	async listAgents(): Promise<AgentInfo[]> {
		// OpenClaw has no agent discovery endpoint — return hardcoded roster.
		return Promise.resolve([...OPENCLAW_AGENTS]);
	}

	async getHealth(): Promise<{ status: string; version: string }> {
		const res = await fetch(`${this.config.baseUrl}/health`, {
			headers: this.headers(),
		});

		if (!res.ok) {
			throw new Error(`OpenClaw health check failed: ${res.status} ${res.statusText}`);
		}

		const data = await res.json() as { status?: string; version?: string };
		return {
			status: data.status ?? 'ok',
			version: data.version ?? 'unknown',
		};
	}

	dispose(): void {
		this.conversations.clear();
		this.connected = false;
	}

	// --- Private ---

	private headers(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${this.config.token}`,
		};
	}
}
