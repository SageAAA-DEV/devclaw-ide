/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';

export interface IOpenClawDaemonConfig {
	port: number;
	token: string;
	provider?: string;
	anthropicKey?: string;
	openaiKey?: string;
	minimaxKey?: string;
	openrouterKey?: string;
}

export const IOpenClawDaemonService = createDecorator<IOpenClawDaemonService>('openClawDaemonService');

export interface IOpenClawDaemonService {
	readonly _serviceBrand: undefined;

	readonly isReady: boolean;
	readonly onReady: Event<void>;
	readonly onError: Event<string>;

	install(): Promise<IOpenClawDaemonConfig>;
	start(): Promise<boolean>;
	stop(): Promise<void>;
	updateKeys(keys: Partial<Pick<IOpenClawDaemonConfig, 'anthropicKey' | 'openaiKey' | 'minimaxKey' | 'openrouterKey' | 'provider'>>): Promise<void>;
	upgrade(): Promise<boolean>;

	getPort(): number;
	getToken(): string;
	getBaseUrl(): string;
}
