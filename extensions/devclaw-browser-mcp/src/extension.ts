/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SageAAA, Inc. All rights reserved.
 *  Licensed under the Proprietary License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

interface BrowserState {
	url: string;
	title: string;
	consoleLogs: { level: string; text: string; timestamp: number }[];
}

/**
 * DevClaw Browser Tools — provides browser automation capabilities
 * for the agent team. Agents can navigate, inspect, screenshot, and
 * read console output from web pages.
 *
 * Uses VS Code's Simple Browser for display and a lightweight
 * tracking layer for console/state. Full Playwright integration
 * is available for Pro tier.
 */

let browserState: BrowserState = {
	url: '',
	title: '',
	consoleLogs: [],
};

export function activate(context: vscode.ExtensionContext): void {

	// Command: Open Browser Preview
	context.subscriptions.push(
		vscode.commands.registerCommand('devclaw.browser.open', async (urlArg?: string) => {
			const config = vscode.workspace.getConfiguration('devclaw.browser');
			const defaultUrl = config.get<string>('defaultUrl', 'http://localhost:3000');
			const url = urlArg || await vscode.window.showInputBox({
				prompt: 'Enter URL to open',
				value: defaultUrl,
				placeHolder: 'http://localhost:3000',
			});

			if (!url) {
				return;
			}

			browserState.url = url;

			// Use VS Code's built-in Simple Browser
			await vscode.commands.executeCommand('simpleBrowser.api.open', url, {
				viewColumn: vscode.ViewColumn.Beside,
				preserveFocus: false,
			});

			vscode.window.showInformationMessage(`Browser opened: ${url}`);
		})
	);

	// Command: Take Screenshot (captures active editor area as a workaround)
	context.subscriptions.push(
		vscode.commands.registerCommand('devclaw.browser.screenshot', async () => {
			if (!browserState.url) {
				vscode.window.showWarningMessage('No browser page open. Use "Open Browser Preview" first.');
				return;
			}

			// Note: VS Code doesn't expose screenshot APIs for webviews.
			// For now, we inform the user. Full Playwright screenshot support
			// will be available when the Pro tier Playwright integration ships.
			const action = await vscode.window.showInformationMessage(
				`Browser is showing: ${browserState.url}\n\nFull screenshot support requires DevClaw Pro with Playwright integration.`,
				'Copy URL'
			);

			if (action === 'Copy URL') {
				await vscode.env.clipboard.writeText(browserState.url);
			}
		})
	);

	// Command: Show Console Logs
	context.subscriptions.push(
		vscode.commands.registerCommand('devclaw.browser.console', () => {
			const outputChannel = vscode.window.createOutputChannel('DevClaw Browser Console');
			outputChannel.show();

			if (browserState.consoleLogs.length === 0) {
				outputChannel.appendLine('No console logs captured yet.');
				outputChannel.appendLine('');
				outputChannel.appendLine('Note: Console log capture requires the DevClaw Pro Playwright integration.');
				outputChannel.appendLine('The browser preview uses VS Code Simple Browser which does not expose console output.');
			} else {
				for (const log of browserState.consoleLogs) {
					const time = new Date(log.timestamp).toISOString();
					outputChannel.appendLine(`[${time}] [${log.level}] ${log.text}`);
				}
			}
		})
	);

	// Register as tool provider for agents (MCP-style)
	// Agents can call these tools via chat tool invocations
	const toolProvider = {
		openBrowser: async (url: string): Promise<string> => {
			await vscode.commands.executeCommand('devclaw.browser.open', url);
			return `Opened browser at ${url}`;
		},
		getPageInfo: (): string => {
			return JSON.stringify({
				url: browserState.url,
				title: browserState.title,
				consoleLogCount: browserState.consoleLogs.length,
			});
		},
		getConsoleLogs: (): string => {
			return JSON.stringify(browserState.consoleLogs.slice(-50));
		},
	};

	// Expose tools via extension API for agent consumption
	context.subscriptions.push(
		vscode.commands.registerCommand('devclaw.browser.tools.open', toolProvider.openBrowser),
		vscode.commands.registerCommand('devclaw.browser.tools.getPageInfo', toolProvider.getPageInfo),
		vscode.commands.registerCommand('devclaw.browser.tools.getConsoleLogs', toolProvider.getConsoleLogs),
	);
}

export function deactivate(): void {
	browserState = { url: '', title: '', consoleLogs: [] };
}
