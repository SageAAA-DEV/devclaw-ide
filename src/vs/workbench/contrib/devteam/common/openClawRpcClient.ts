/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';

export interface RpcError {
	code: string;
	message: string;
	details?: unknown;
}

export class OpenClawRpcClient extends Disposable {

	private ws: WebSocket | null = null;
	private readonly pending = new Map<string, {
		resolve: (result: unknown) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}>();

	private _isConnected = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private url = '';
	private token = '';

	private readonly _onDidConnect = this._register(new Emitter<void>());
	readonly onDidConnect: Event<void> = this._onDidConnect.event;

	private readonly _onDidDisconnect = this._register(new Emitter<void>());
	readonly onDidDisconnect: Event<void> = this._onDidDisconnect.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	get isConnected(): boolean { return this._isConnected; }

	async connect(url: string, token: string): Promise<void> {
		this.url = url;
		this.token = token;
		this.clearReconnect();

		return new Promise<void>((resolve, reject) => {
			try {
				const wsUrl = url.replace(/^http/, 'ws');
				this.ws = new WebSocket(wsUrl);

				const timeout = setTimeout(() => {
					reject(new Error('WebSocket connection timeout'));
					this.ws?.close();
				}, 10000);

				this.ws.onopen = () => {
					clearTimeout(timeout);
					this.sendRaw({
						method: 'connect',
						params: {
							clientId: generateUuid(),
							role: 'operator',
							scopes: ['operator.*'],
							auth: token ? { token } : undefined,
						},
					});
					this._isConnected = true;
					this._onDidConnect.fire();
					resolve();
				};

				this.ws.onmessage = (event) => {
					this.handleMessage(event.data as string);
				};

				this.ws.onclose = () => {
					const wasConnected = this._isConnected;
					this._isConnected = false;
					this.rejectAllPending('Connection closed');
					if (wasConnected) {
						this._onDidDisconnect.fire();
						this.scheduleReconnect();
					}
				};

				this.ws.onerror = () => {
					clearTimeout(timeout);
					if (!this._isConnected) {
						reject(new Error('WebSocket connection failed'));
					}
				};
			} catch (err) {
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		if (!this.ws || !this._isConnected) {
			throw new Error('Not connected to OpenClaw gateway');
		}

		const id = generateUuid();
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC timeout: ${method}`));
			}, 30000);

			this.pending.set(id, {
				resolve: resolve as (result: unknown) => void,
				reject,
				timer,
			});

			this.sendRaw({ id, method, params });
		});
	}

	disconnect(): void {
		this.clearReconnect();
		this.rejectAllPending('Disconnected');
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.close();
			this.ws = null;
		}
		this._isConnected = false;
	}

	private handleMessage(raw: string): void {
		try {
			const msg = JSON.parse(raw);
			const id = msg.id;
			if (id && this.pending.has(id)) {
				const entry = this.pending.get(id)!;
				this.pending.delete(id);
				clearTimeout(entry.timer);
				if (msg.ok === false && msg.error) {
					entry.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
				} else {
					entry.resolve(msg.result ?? msg);
				}
			}
		} catch {
			// Ignore malformed messages
		}
	}

	private sendRaw(data: unknown): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(data));
		}
	}

	private rejectAllPending(reason: string): void {
		for (const [id, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.reject(new Error(reason));
			this.pending.delete(id);
		}
	}

	private scheduleReconnect(): void {
		this.clearReconnect();
		this.reconnectTimer = setTimeout(() => {
			if (!this._isConnected && this.url) {
				this.connect(this.url, this.token).catch(() => {
					// Will retry on next schedule
				});
			}
		}, 5000);
	}

	private clearReconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	override dispose(): void {
		this.disconnect();
		super.dispose();
	}
}
