/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

/**
 * Shared interface for IDE ↔ AI backend communication.
 * OpenClawClient implements this interface.
 */
export interface IBackendClient {
	chat(agentId: string, message: string, conversationId?: string): Promise<ChatResponse>;
	chatStream(agentId: string, message: string, onChunk: (text: string) => void): Promise<string>;
	getHealth(): Promise<{ status: string; version: string }>;
	listAgents(): Promise<AgentInfo[]>;
	isConnected(): boolean;
	dispose(): void;
}
