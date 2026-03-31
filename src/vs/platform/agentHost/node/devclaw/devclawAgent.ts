/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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

interface DevClawConfig {
	// OpenClaw only
	openclawUrl: string;
	openclawToken: string;
}

/**
 * Agent provider backed by OpenClaw (embedded AI gateway).
 * OpenClaw: POST /v1/chat/completions (OpenAI-compatible), Bearer token auth.
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
			description: 'AI agent team via OpenClaw (embedded) or OpenClaw (cloud)',
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
		return {
			openclawUrl: `http://127.0.0.1:${process.env['OPENCLAW_PORT'] || '18789'}`,
			openclawToken: process.env['OPENCLAW_TOKEN'] || '',
		};
	}

	private _isConfigured(): boolean {
		return true; // OpenClaw is always available (local daemon)
	}

	// ---- session management --------------------------------------------------

	async listSessions(): Promise<IAgentSessionMetadata[]> {
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
			{ provider: this.id, id: 'openclaw', name: 'OpenClaw', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
		];
	}

	async createSession(config?: IAgentCreateSessionConfig): Promise<URI> {
		const sessionId = config?.session ? AgentSession.id(config.session) : generateUuid();
		this._logService.info(`[DevClaw] Creating session: ${sessionId}`);

		const session = new DevClawSession(sessionId, config?.model || 'openclaw');
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
			const backendName = 'OpenClaw';
			const hint = 'Set `OPENCLAW_PORT` and `OPENCLAW_TOKEN` environment variables, or configure your connection in Settings.';
			this._onDidSessionProgress.fire({
				session: sessionUri,
				type: 'delta',
				messageId: generateUuid(),
				content: `${backendName} is not connected. ${hint}`,
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

			// --- OpenClaw path (OpenAI-compatible /v1/chat/completions) ---
			const url = new URL(`${config.openclawUrl}/v1/chat/completions`);
			const transport = url.protocol === 'https:' ? https : http;

			const body = JSON.stringify({
				model: `openclaw:${session.agentId}`,
				messages: [{ role: 'user', content: fullMessage }],
				user: session.sessionId,
			});

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			if (config.openclawToken) {
				headers['Authorization'] = `Bearer ${config.openclawToken}`;
			}

			const response = await new Promise<string>((resolve, reject) => {
				const req = transport.request(url, { method: 'POST', headers }, (res) => {
					let data = '';
					res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
					res.on('end', () => {
						if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
							resolve(data);
						} else {
							reject(new Error(`OpenClaw API ${res.statusCode}: ${data || res.statusMessage}`));
						}
					});
				});
				req.on('error', reject);
				req.write(body);
				req.end();
			});

			const data = JSON.parse(response);
			const content = data.choices?.[0]?.message?.content || 'No response from OpenClaw.';

			this._onDidSessionProgress.fire({
				session: sessionUri,
				type: 'delta',
				messageId: generateUuid(),
				content,
			});

			this._logService.info(`[DevClaw:${sessionId}] OpenClaw response via model openclaw:${session.agentId}`);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[DevClaw:${sessionId}] Error: ${errorMsg}`);

			let displayMsg: string;
			if (errorMsg.includes('ECONNREFUSED')) {
				displayMsg = `Cannot reach OpenClaw at ${config.openclawUrl}. Make sure OpenClaw is running.`;
			} else if (errorMsg.includes('OpenClaw API')) {
				// Try to extract the JSON error body
				try {
					const jsonStart = errorMsg.indexOf('{');
					if (jsonStart >= 0) {
						const parsed = JSON.parse(errorMsg.substring(jsonStart));
						displayMsg = parsed.error || parsed.message || errorMsg;
						if (parsed.details) {
							displayMsg += ': ' + parsed.details.map((d: { field: string; message: string }) => `${d.field} — ${d.message}`).join(', ');
						}
					} else {
						displayMsg = errorMsg;
					}
				} catch {
					displayMsg = errorMsg;
				}
			} else {
				displayMsg = errorMsg;
			}

			this._onDidSessionProgress.fire({
				session: sessionUri,
				type: 'error',
				errorType: 'connection',
				message: displayMsg,
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

/** Session state — tracks conversationId for multi-turn persistence. */
class DevClawSession {
	readonly startTime = Date.now();
	lastMessage = '';
	/** OpenClaw conversationId, set after first response. */
	conversationId: string | undefined;

	constructor(
		readonly sessionId: string,
		public agentId: string,
	) { }

	dispose(): void { }
}
