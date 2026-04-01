/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared singleton service that manages the WebSocket RPC connection to the
 * OpenClaw gateway.  All editor panes inject this to fetch live data.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { OpenClawRpcClient } from '../common/openClawRpcClient.js';

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export const IGatewayRpcService = createDecorator<IGatewayRpcService>('gatewayRpcService');

export interface IGatewayRpcService {
	readonly _serviceBrand: undefined;

	readonly isConnected: boolean;
	readonly onDidConnect: Event<void>;
	readonly onDidDisconnect: Event<void>;

	/** Call an RPC method on the gateway. Rejects if not connected. */
	call<T>(method: string, params?: Record<string, unknown>): Promise<T>;

	/** Ensure the WebSocket is connected (idempotent). */
	ensureConnected(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class GatewayRpcServiceImpl extends Disposable implements IGatewayRpcService {

	declare readonly _serviceBrand: undefined;

	private readonly _client: OpenClawRpcClient;
	private _connectPromise: Promise<void> | null = null;

	private readonly _onDidConnect = this._register(new Emitter<void>());
	readonly onDidConnect: Event<void> = this._onDidConnect.event;

	private readonly _onDidDisconnect = this._register(new Emitter<void>());
	readonly onDidDisconnect: Event<void> = this._onDidDisconnect.event;

	get isConnected(): boolean {
		return this._client.isConnected;
	}

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this._client = this._register(new OpenClawRpcClient());
		this._client.onDidConnect(() => this._onDidConnect.fire());
		this._client.onDidDisconnect(() => {
			this._connectPromise = null;
			this._onDidDisconnect.fire();
		});

		// Auto-connect on creation
		this.ensureConnected().catch(() => { /* silent — panels will retry */ });
	}

	async ensureConnected(): Promise<void> {
		if (this._client.isConnected) {
			return;
		}
		if (this._connectPromise) {
			return this._connectPromise;
		}

		const port = this.storageService.get('devteam.openclaw.port', StorageScope.APPLICATION, '18789');
		let token = this.storageService.get('devteam.openclaw.token', StorageScope.APPLICATION, '');

		// If no token in storage, try reading from ~/.openclaw/openclaw.json
		if (!token) {
			token = await this._resolveGatewayToken();
			if (token) {
				this.storageService.store('devteam.openclaw.token', token, StorageScope.APPLICATION, StorageTarget.MACHINE);
			}
		}

		const url = `http://127.0.0.1:${port}`;

		this._connectPromise = this._client.connect(url, token).catch((err) => {
			this._connectPromise = null;
			throw err;
		});

		return this._connectPromise;
	}

	private async _resolveGatewayToken(): Promise<string> {
		// TODO: Replace with CTRL-A auth — hardcoded local gateway token for dev
		return 'c7a095bd76e135d413c6bd6ba920ac122da0c52ce464cb8f';
	}

	async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		await this.ensureConnected();
		return this._client.call<T>(method, params);
	}
}

registerSingleton(IGatewayRpcService, GatewayRpcServiceImpl, InstantiationType.Delayed);
