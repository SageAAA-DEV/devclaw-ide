/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SageAAA, Inc. All rights reserved.
 *  Licensed under the Proprietary License.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IProductService } from '../../../../platform/product/common/productService.js';

const PRIVACY_CONSENT_SHOWN_KEY = 'devclaw.privacyConsentShown';
const PRIVACY_ANALYTICS_KEY = 'devclaw.privacy.analyticsEnabled';
const PRIVACY_CRASH_KEY = 'devclaw.privacy.crashReportsEnabled';

class DevClawPrivacyConsent implements IWorkbenchContribution {

	static readonly ID = 'devclaw.privacyConsent';

	constructor(
		@IDialogService private readonly dialogService: IDialogService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
	) {
		this.showConsentIfNeeded();
	}

	private async showConsentIfNeeded(): Promise<void> {
		// Only show once
		if (this.storageService.get(PRIVACY_CONSENT_SHOWN_KEY, StorageScope.APPLICATION)) {
			return;
		}

		// Don't show if telemetry is disabled at the product level
		if (this.productService.enableTelemetry === false) {
			// Still mark as shown and save defaults (both off since telemetry is disabled)
			this.storageService.store(PRIVACY_CONSENT_SHOWN_KEY, 'true', StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.storageService.store(PRIVACY_ANALYTICS_KEY, 'false', StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.storageService.store(PRIVACY_CRASH_KEY, 'false', StorageScope.APPLICATION, StorageTarget.MACHINE);
			return;
		}

		const { confirmed } = await this.dialogService.confirm({
			type: 'info',
			title: 'DevClaw Respects Your Data',
			message: 'Help improve DevClaw?',
			detail: [
				'DevClaw can collect anonymous usage analytics and crash reports to improve the product.',
				'',
				'What we collect:',
				'  - Which features you use (never your code or file contents)',
				'  - Crash reports with stack traces (never file paths or code)',
				'',
				'What we NEVER collect:',
				'  - Your code, file contents, or project names',
				'  - Chat messages or agent responses',
				'  - API keys or credentials',
				'',
				'You can change this anytime in Settings > Privacy.',
				'',
				'Learn exactly what we collect: https://devclaw.sageaaa.com/telemetry',
			].join('\n'),
			primaryButton: 'Accept Analytics & Crash Reports',
			cancelButton: 'No Thanks',
		});

		// Save consent
		this.storageService.store(PRIVACY_CONSENT_SHOWN_KEY, 'true', StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.storageService.store(PRIVACY_ANALYTICS_KEY, confirmed ? 'true' : 'false', StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.storageService.store(PRIVACY_CRASH_KEY, confirmed ? 'true' : 'false', StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}

registerWorkbenchContribution2(DevClawPrivacyConsent.ID, DevClawPrivacyConsent, WorkbenchPhase.Eventually);
