/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SageAAA LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryAppender } from './telemetryUtils.js';

// Kept as an empty interface so consumer code and tests that reference
// IAppInsightsCore continue to compile without changes.
export interface IAppInsightsCore { }

export abstract class AbstractOneDataSystemAppender implements ITelemetryAppender {

	constructor(
		_isInternalTelemetry: boolean,
		_eventPrefix: string,
		_defaultData: { [key: string]: unknown } | null,
		_iKeyOrClientFactory: string | (() => IAppInsightsCore),
		_xhrOverride?: unknown
	) { }

	log(): void {
		// no-op — telemetry disabled
	}

	flush(): Promise<void> {
		return Promise.resolve();
	}
}
