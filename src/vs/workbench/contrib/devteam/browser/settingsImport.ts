/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Settings import commands: VS Code, Cursor, Windsurf, Antigravity → DevClaw

import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEnvironmentService, INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { URI } from '../../../../base/common/uri.js';
import { isWindows } from '../../../../base/common/platform.js';

interface IDESource {
	name: string;
	/** Path segments relative to the platform appData directory to reach the User folder */
	settingsSegments: string[];
	/** Path segments relative to userHome for the extensions directory (optional) */
	extensionsSegments?: string[];
}

/**
 * Returns the IDE source definitions.
 * Paths are relative to the platform's application-data directory:
 *   Windows: %APPDATA%
 *   macOS:   ~/Library/Application Support
 *   Linux:   ~/.config
 */
function getIDESources(): Record<string, IDESource> {
	return {
		vscode: {
			name: 'VS Code',
			settingsSegments: ['Code', 'User'],
			extensionsSegments: ['.vscode', 'extensions'],
		},
		cursor: {
			name: 'Cursor',
			settingsSegments: ['Cursor', 'User'],
			extensionsSegments: ['.cursor', 'extensions'],
		},
		windsurf: {
			name: 'Windsurf',
			settingsSegments: ['Windsurf', 'User'],
			extensionsSegments: ['.windsurf', 'extensions'],
		},
		antigravity: {
			name: 'Antigravity',
			settingsSegments: isWindows
				? ['Antigravity', 'User']
				: ['.antigravity', 'User'],
		},
	};
}

/**
 * Resolves the appData base URI from the environment.
 * INativeEnvironmentService.appSettingsHome already points to our own User dir,
 * so we go up two levels to reach the appData root (e.g., %APPDATA% on Windows).
 */
function getAppDataRoot(environmentService: INativeEnvironmentService): URI {
	// appSettingsHome = <appData>/<productName>/User
	// We need <appData>
	return URI.joinPath(environmentService.appSettingsHome, '..', '..');
}

async function importSettings(
	sourceKey: string,
	fileService: IFileService,
	notificationService: INotificationService,
	environmentService: INativeEnvironmentService,
): Promise<void> {
	const sources = getIDESources();
	const source = sources[sourceKey];

	if (!source) {
		notificationService.notify({
			severity: Severity.Error,
			message: `Unknown IDE: ${sourceKey}`,
		});
		return;
	}

	const appDataRoot = getAppDataRoot(environmentService);
	const sourceUserDir = URI.joinPath(appDataRoot, ...source.settingsSegments);
	const devclawUserDir = environmentService.appSettingsHome; // Our own User dir

	let importedCount = 0;

	// Import settings.json
	try {
		const sourceUri = URI.joinPath(sourceUserDir, 'settings.json');
		if (await fileService.exists(sourceUri)) {
			const content = await fileService.readFile(sourceUri);
			const destUri = URI.joinPath(devclawUserDir, 'settings.json');
			await fileService.writeFile(destUri, content.value);
			importedCount++;
		}
	} catch {
		// Settings file not found or not readable — skip
	}

	// Import keybindings.json
	try {
		const sourceUri = URI.joinPath(sourceUserDir, 'keybindings.json');
		if (await fileService.exists(sourceUri)) {
			const content = await fileService.readFile(sourceUri);
			const destUri = URI.joinPath(devclawUserDir, 'keybindings.json');
			await fileService.writeFile(destUri, content.value);
			importedCount++;
		}
	} catch {
		// Keybindings not found — skip
	}

	if (importedCount > 0) {
		notificationService.notify({
			severity: Severity.Info,
			message: localize(
				'settingsImported',
				"Imported {0} file(s) from {1}. Restart DevClaw to apply changes.",
				importedCount,
				source.name,
			),
		});
	} else {
		notificationService.notify({
			severity: Severity.Warning,
			message: localize(
				'noSettingsFound',
				"No settings found for {0}. Is it installed?",
				source.name,
			),
		});
	}
}

// Register a command for each IDE source
for (const [key, source] of Object.entries(getIDESources())) {
	const commandId = `devteam.import${source.name.replace(/\s/g, '')}Settings`;
	CommandsRegistry.registerCommand(commandId, async (accessor) => {
		const fileService = accessor.get(IFileService);
		const notificationService = accessor.get(INotificationService);
		const environmentService = accessor.get(IEnvironmentService) as INativeEnvironmentService;
		await importSettings(key, fileService, notificationService, environmentService);
	});
}
