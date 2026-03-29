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
	baseUrl: string;
	appKey: string;
}

/**
 * Agent provider backed by the CTRL-A backend via REST API.
 * Authenticates using the CTRL-A App Registry (`x-app-key` header).
 * Parses the full CTRL-A response: thinking, toolCalls, sources, tokens.
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
		const baseUrl = process.env['DEVCLAW_CTRL_A_URL'] || 'http://localhost:3000';
		const appKey = process.env['DEVCLAW_CTRL_A_APP_KEY'] || '';
		return { baseUrl, appKey };
	}

	private _isConfigured(): boolean {
		const config = this._getConfig();
		return !!config.baseUrl;
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
				type: 'delta',
				messageId: generateUuid(),
				content: 'CTRL-A is not connected. Set `DEVCLAW_CTRL_A_URL` and `DEVCLAW_CTRL_A_APP_KEY` environment variables, or configure your connection in DevClaw Settings.',
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

			const payload: Record<string, string> = {
				message: fullMessage,
				agentId: session.agentId,
			};
			if (session.conversationId) {
				payload.conversationId = session.conversationId;
			}
			const body = JSON.stringify(payload);

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			if (config.appKey) {
				headers['x-app-key'] = config.appKey;
			}

			const response = await new Promise<string>((resolve, reject) => {
				const req = transport.request(url, {
					method: 'POST',
					headers,
				}, (res) => {
					let data = '';
					res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
					res.on('end', () => {
						if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
							resolve(data);
						} else {
							// Include response body for better error diagnostics
							reject(new Error(`CTRL-A API ${res.statusCode}: ${data || res.statusMessage}`));
						}
					});
				});
				req.on('error', reject);
				req.write(body);
				req.end();
			});

			const data = JSON.parse(response);

			// Persist conversationId for multi-turn conversations
			if (data.conversationId) {
				session.conversationId = data.conversationId;
			}

			// Emit thinking/reasoning if present
			if (data.thinking) {
				this._onDidSessionProgress.fire({
					session: sessionUri,
					type: 'reasoning',
					content: data.thinking,
				});
			}

			// Emit tool calls as tool_start + tool_complete events
			if (data.toolCalls && Array.isArray(data.toolCalls)) {
				for (const tc of data.toolCalls) {
					const toolCallId = generateUuid();
					this._onDidSessionProgress.fire({
						session: sessionUri,
						type: 'tool_start',
						toolCallId,
						toolName: tc.tool,
						displayName: tc.tool,
						invocationMessage: `Running \`${tc.tool}\``,
						toolInput: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input),
					});
					this._onDidSessionProgress.fire({
						session: sessionUri,
						type: 'tool_complete',
						toolCallId,
						success: true,
						pastTenseMessage: `Ran \`${tc.tool}\``,
						toolOutput: typeof tc.result === 'string' ? tc.result.substring(0, 2000) : JSON.stringify(tc.result).substring(0, 2000),
					});
				}
			}

			// Emit the main response content
			const content = data.response || data.message || 'No response from agent.';
			this._onDidSessionProgress.fire({
				session: sessionUri,
				type: 'delta',
				messageId: generateUuid(),
				content,
			});

			// Emit token usage if available
			if (data.inputTokens || data.outputTokens) {
				this._onDidSessionProgress.fire({
					session: sessionUri,
					type: 'usage',
					inputTokens: data.inputTokens,
					outputTokens: data.outputTokens,
					model: data.model,
				});
			}

			this._logService.info(`[DevClaw:${sessionId}] Response from ${data.agentName || data.agentId} (${data.model}), ${data.toolCalls?.length || 0} tool calls`);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[DevClaw:${sessionId}] Error: ${errorMsg}`);

			// Parse structured error from CTRL-A if available
			let displayMsg: string;
			if (errorMsg.includes('ECONNREFUSED')) {
				displayMsg = `Cannot reach CTRL-A at ${config.baseUrl}. Make sure CTRL-A is running.`;
			} else if (errorMsg.includes('CTRL-A API')) {
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
	/** CTRL-A conversationId, set after first response. */
	conversationId: string | undefined;

	constructor(
		readonly sessionId: string,
		public agentId: string,
	) { }

	dispose(): void { }
}
