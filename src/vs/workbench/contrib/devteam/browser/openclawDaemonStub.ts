/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Browser-safe stub for IOpenClawDaemonService.
// The real implementation (openclawDaemonManager.ts) uses Node.js APIs
// (child_process, fs) and can only run in the main/utility process.
// This stub lets the settings pane render in the renderer process.

import { Emitter } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IOpenClawDaemonConfig, IOpenClawDaemonService } from '../../../../platform/openclaw/common/openclawDaemon.js';

class OpenClawDaemonStub implements IOpenClawDaemonService {
	declare readonly _serviceBrand: undefined;

	readonly isReady = false;

	private readonly _onReady = new Emitter<void>();
	readonly onReady = this._onReady.event;

	private readonly _onError = new Emitter<string>();
	readonly onError = this._onError.event;

	async install(): Promise<IOpenClawDaemonConfig> {
		return { port: 18789, token: '' };
	}

	async start(): Promise<boolean> {
		return false;
	}

	async stop(): Promise<void> { }

	async updateKeys(_keys: Partial<Pick<IOpenClawDaemonConfig, 'anthropicKey' | 'openaiKey' | 'minimaxKey' | 'openrouterKey' | 'provider'>>): Promise<void> { }

	async upgrade(): Promise<boolean> {
		return false;
	}

	getPort(): number { return 18789; }
	getToken(): string { return ''; }
	getBaseUrl(): string { return 'http://127.0.0.1:18789'; }
}

registerSingleton(IOpenClawDaemonService, OpenClawDaemonStub, InstantiationType.Delayed);
