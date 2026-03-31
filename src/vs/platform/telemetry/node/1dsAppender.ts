/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbstractOneDataSystemAppender } from '../common/1dsAppender.js';

export class OneDataSystemAppender extends AbstractOneDataSystemAppender {

	constructor(
		_requestService: unknown,
		isInternalTelemetry: boolean,
		eventPrefix: string,
		defaultData: { [key: string]: unknown } | null,
		iKeyOrClientFactory: string
	) {
		super(isInternalTelemetry, eventPrefix, defaultData, iKeyOrClientFactory);
	}
}
