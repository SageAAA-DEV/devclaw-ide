/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SageAAA, Inc. All rights reserved.
 *  Licensed under the Proprietary License.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import type { IAuthorizationProtectedResourceMetadata } from '../../../../base/common/oauth.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import {
	AgentSession, IAgent, IAgentAttachment, IAgentCreateSessionConfig,
	IAgentDescriptor, IAgentMessageEvent, IAgentModelInfo,
	IAgentProgressEvent, IAgentSessionMetadata,
	IAgentToolCompleteEvent, IAgentToolStartEvent,
} from '../../common/agentService.js';
import { PermissionKind } from '../../common/state/sessionState.js';
import { getInvocationMessage, getPastTenseMessage, getShellLanguage, getToolDisplayName, getToolKind, getToolInputString, isHiddenTool } from './devclawToolDisplay.js';

function tryStringify(value: unknown): string | undefined {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}

interface DevClawConfig {
	baseUrl: string;
	apiKey: string;
}

/**
 * Agent provider backed by the CTRL-A backend via REST API.
 * Replaces CopilotAgent as the registered IAgent in the agent host.
 */
export class DevClawAgent extends Disposable implements IAgent {
	readonly id = 'devclaw' as const;

	private readonly _onDidSessionProgress = this._register(new Emitter<IAgentProgressEvent>());
	readonly onDidSessionProgress = this._onDidSessionProgress.event;

	private readonly _sessions = this._register(new DisposableMap<string, DevClawSession>());
	private readonly _pendingPermissions = new Map<string, { sessionId: string; deferred: DeferredPromise<boolean> }>();

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	// ---- descriptor & auth ---------------------------------------------------

	getDescriptor(): IAgentDescriptor {
		return {
			provider: 'devclaw',
			displayName: 'Agent Host - DevClaw',
			description: 'CTRL-A agent team running via REST API',
			requiresAuth: false,
		};
	}

	getProtectedResources(): IAuthorizationProtectedResourceMetadata[] {
		return [];
	}

	async authenticate(_resource: string, _token: string): Promise<boolean> {
		return true;
	}

	// ---- config --------------------------------------------------------------

	private _getConfig(): DevClawConfig {
		// Read from environment or .devclaw config
		const baseUrl = process.env['DEVCLAW_CTRL_A_URL'] || 'http://localhost:3000';
		const apiKey = process.env['DEVCLAW_CTRL_A_API_KEY'] || '';
		return { baseUrl, apiKey };
	}

	private _isConfigured(): boolean {
		const config = this._getConfig();
		return !!config.baseUrl && config.baseUrl !== 'http://localhost:3000';
	}

	// ---- session management --------------------------------------------------

	async listSessions(): Promise<IAgentSessionMetadata[]> {
		// In-memory sessions only for now — no persistence
		const result: IAgentSessionMetadata[] = [];
		for (const [id, session] of this._sessions) {
			result.push({
				session: AgentSession.uri(this.id, id),
				startTime: session.startTime,
				modifiedTime: Date.now(),
				summary: session.lastMessage,
			});
		}
		return result;
	}

	async listModels(): Promise<IAgentModelInfo[]> {
		return [
			{ provider: this.id, id: 'ctrl-a', name: 'CTRL-A (Router)', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
			{ provider: this.id, id: 'devin', name: 'Devin (Lead Engineer)', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
			{ provider: this.id, id: 'scout', name: 'Scout (Researcher)', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
			{ provider: this.id, id: 'sage', name: 'Sage (Code Reviewer)', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
			{ provider: this.id, id: 'ink', name: 'Ink (Technical Writer)', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
		];
	}

	async createSession(config?: IAgentCreateSessionConfig): Promise<URI> {
		const sessionId = config?.session ? AgentSession.id(config.session) : generateUuid();
		this._logService.info(`[DevClaw] Creating session: ${sessionId}`);

		const session = new DevClawSession(sessionId, config?.model || 'ctrl-a');
		this._sessions.set(sessionId, session);

		const uri = AgentSession.uri(this.id, sessionId);
		this._logService.info(`[DevClaw] Session created: ${uri.toString()}`);
		return uri;
	}

	async sendMessage(sessionUri: URI, prompt: string, attachments?: IAgentAttachment[]): Promise<void> {
		const sessionId = AgentSession.id(sessionUri);
		const session = this._sessions.get(sessionId);
		if (!session) {
			this._logService.error(`[DevClaw:${sessionId}] Session not found`);
			return;
		}

		const config = this._getConfig();
		if (!this._isConfigured()) {
			this._onDidSessionProgress.fire({
				session: sessionUri,
				type: 'message',
				role: 'assistant',
				messageId: generateUuid(),
				content: 'CTRL-A is not connected. Set the `DEVCLAW_CTRL_A_URL` and `DEVCLAW_CTRL_A_API_KEY` environment variables, or configure your connection in DevClaw Settings.',
			});
			this._onDidSessionProgress.fire({ session: sessionUri, type: 'idle' });
			return;
		}

		// Build context from attachments
		let fullMessage = prompt;
		if (attachments?.length) {
			const parts = attachments.map(a => {
				if (a.type === 'selection' && a.text) {
					return `[Selection from ${a.path}]:\n${a.text}`;
				}
				return `[File: ${a.path}]`;
			});
			fullMessage += '\n\n' + parts.join('\n');
		}

		session.lastMessage = prompt.substring(0, 200);

		try {
			const { default: http } = await import('http');
			const { default: https } = await import('https');
			const url = new URL(`${config.baseUrl}/api/chat`);
			const transport = url.protocol === 'https:' ? https : http;

			const body = JSON.stringify({
				message: fullMessage,
				agentId: session.agentId,
			});

			const response = await new Promise<string>((resolve, reject) => {
				const req = transport.request(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-api-key': config.apiKey,
					},
				}, (res) => {
					let data = '';
					res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
					res.on('end', () => {
						if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
							resolve(data);
						} else {
							reject(new Error(`CTRL-A API error: ${res.statusCode} ${res.statusMessage}`));
						}
					});
				});
				req.on('error', reject);
				req.write(body);
				req.end();
			});

			const data = JSON.parse(response);
			const content = data.response || data.message || 'No response from agent.';

			this._onDidSessionProgress.fire({
				session: sessionUri,
				type: 'message',
				role: 'assistant',
				messageId: generateUuid(),
				content,
			});
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[DevClaw:${sessionId}] Error: ${errorMsg}`);
			this._onDidSessionProgress.fire({
				session: sessionUri,
				type: 'error',
				errorType: 'connection',
				message: `Connection error: ${errorMsg}. Check your CTRL-A connection.`,
			});
		}

		this._onDidSessionProgress.fire({ session: sessionUri, type: 'idle' });
	}

	async getSessionMessages(_session: URI): Promise<(IAgentMessageEvent | IAgentToolStartEvent | IAgentToolCompleteEvent)[]> {
		return [];
	}

	async disposeSession(session: URI): Promise<void> {
		const sessionId = AgentSession.id(session);
		this._sessions.deleteAndDispose(sessionId);
		this._denyPendingPermissionsForSession(sessionId);
	}

	async abortSession(_session: URI): Promise<void> {
		// No long-running requests to abort in REST mode
	}

	async changeModel(session: URI, model: string): Promise<void> {
		const sessionId = AgentSession.id(session);
		const entry = this._sessions.get(sessionId);
		if (entry) {
			this._logService.info(`[DevClaw:${sessionId}] Changing agent to: ${model}`);
			entry.agentId = model;
		}
	}

	respondToPermissionRequest(requestId: string, approved: boolean): void {
		const entry = this._pendingPermissions.get(requestId);
		if (entry) {
			this._pendingPermissions.delete(requestId);
			entry.deferred.complete(approved);
		}
	}

	hasSession(session: URI): boolean {
		return this._sessions.has(AgentSession.id(session));
	}

	async shutdown(): Promise<void> {
		this._logService.info('[DevClaw] Shutting down...');
		this._sessions.clearAndDisposeAll();
		this._denyPendingPermissions();
	}

	// ---- internal ------------------------------------------------------------

	private _denyPendingPermissions(): void {
		for (const [, entry] of this._pendingPermissions) {
			entry.deferred.complete(false);
		}
		this._pendingPermissions.clear();
	}

	private _denyPendingPermissionsForSession(sessionId: string): void {
		for (const [requestId, entry] of this._pendingPermissions) {
			if (entry.sessionId === sessionId) {
				entry.deferred.complete(false);
				this._pendingPermissions.delete(requestId);
			}
		}
	}

	override dispose(): void {
		this._denyPendingPermissions();
		super.dispose();
	}
}

/** Lightweight session state. */
class DevClawSession {
	readonly startTime = Date.now();
	lastMessage = '';

	constructor(
		readonly sessionId: string,
		public agentId: string,
	) { }

	dispose(): void { }
}
