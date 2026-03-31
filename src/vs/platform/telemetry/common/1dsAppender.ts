/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryAppender } from './telemetryUtils.js';

// Kept as an empty interface so consumer code and tests that reference
// IAppInsightsCore continue to compile without changes.
export interface IAppInsightsCore { }

export interface BufferedTelemetryEvent {
	eventName: string;
	timestamp: number;
	data?: { [key: string]: unknown };
}

export abstract class AbstractOneDataSystemAppender implements ITelemetryAppender {

	private static _enabled: boolean = false;
	private static _buffer: BufferedTelemetryEvent[] = [];

	static setEnabled(enabled: boolean): void {
		AbstractOneDataSystemAppender._enabled = enabled;
	}

	static get enabled(): boolean {
		return AbstractOneDataSystemAppender._enabled;
	}

	static get buffer(): readonly BufferedTelemetryEvent[] {
		return AbstractOneDataSystemAppender._buffer;
	}

	constructor(
		_isInternalTelemetry: boolean,
		_eventPrefix: string,
		_defaultData: { [key: string]: unknown } | null,
		_iKeyOrClientFactory: string | (() => IAppInsightsCore),
		_xhrOverride?: unknown
	) { }

	log(eventName: string, data?: { [key: string]: unknown }): void {
		if (!AbstractOneDataSystemAppender._enabled) {
			return; // no-op — user has not consented to telemetry
		}
		AbstractOneDataSystemAppender._buffer.push({
			eventName,
			timestamp: Date.now(),
			data,
		});
	}

	flush(): Promise<void> {
		AbstractOneDataSystemAppender._buffer = [];
		return Promise.resolve();
	}
}
