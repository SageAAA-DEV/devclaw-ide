/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SageAAA LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbstractOneDataSystemAppender, IAppInsightsCore } from '../common/1dsAppender.js';

export class OneDataSystemWebAppender extends AbstractOneDataSystemAppender {

	constructor(
		isInternalTelemetry: boolean,
		eventPrefix: string,
		defaultData: { [key: string]: unknown } | null,
		iKeyOrClientFactory: string | (() => IAppInsightsCore)
	) {
		super(isInternalTelemetry, eventPrefix, defaultData, iKeyOrClientFactory);
	}
}
