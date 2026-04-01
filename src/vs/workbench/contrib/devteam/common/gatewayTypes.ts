/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Types for OpenClaw Gateway WebSocket RPC responses (Phase 1)

export interface GatewayHealthResult {
	ok: boolean;
	status: 'live' | 'ready';
	version?: string;
	uptime?: number;
}

export interface GatewayAgentSummary {
	agentId: string;
	name?: string;
	model?: string;
	provider?: string;
	status?: string;
}

export interface GatewayAgentsListResult {
	agents: GatewayAgentSummary[];
}

export interface GatewaySkillEntry {
	name: string;
	skillKey?: string;
	enabled?: boolean;
	primaryEnv?: string;
	emoji?: string;
}

export interface GatewaySkillsStatusResult {
	agentId: string;
	workspace: {
		skills: GatewaySkillEntry[];
	};
}

export interface GatewayToolEntry {
	name: string;
	description: string;
	group?: string;
}

export interface GatewayToolGroup {
	name: string;
	tools: GatewayToolEntry[];
}

export interface GatewayToolsCatalogResult {
	agentId: string;
	groups: GatewayToolGroup[];
}

export interface GatewaySessionEntry {
	sessionId: string;
	sessionKey?: string;
	agentId?: string;
	model?: string;
	totalTokens?: number;
	contextTokens?: number;
	updatedAt?: number;
}

export interface GatewayModelEntry {
	id: string;
	name?: string;
	provider?: string;
	isDefault?: boolean;
}

export interface GatewayModelsListResult {
	models: GatewayModelEntry[];
	defaults?: Record<string, string>;
}

export interface GatewayConfigResult {
	config: Record<string, unknown>;
	hash: string;
	format: string;
}
