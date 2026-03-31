/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

const enum DevClawToolName {
	Bash = 'bash',
	ReadBash = 'read_bash',
	WriteBash = 'write_bash',
	BashShutdown = 'bash_shutdown',
	ListBash = 'list_bash',
	PowerShell = 'powershell',
	ReadPowerShell = 'read_powershell',
	WritePowerShell = 'write_powershell',
	ListPowerShell = 'list_powershell',
	View = 'view',
	Edit = 'edit',
	Write = 'write',
	Grep = 'grep',
	Glob = 'glob',
	Patch = 'patch',
	WebSearch = 'web_search',
	AskUser = 'ask_user',
	ReportIntent = 'report_intent',
}

interface IShellToolArgs {
	command: string;
	timeout?: number;
}

interface IFileToolArgs {
	file_path: string;
}

interface IGrepToolArgs {
	pattern: string;
	path?: string;
	include?: string;
}

interface IGlobToolArgs {
	pattern: string;
	path?: string;
}

const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
	DevClawToolName.Bash,
	DevClawToolName.PowerShell,
]);

const HIDDEN_TOOL_NAMES: ReadonlySet<string> = new Set([
	DevClawToolName.ReportIntent,
]);

export function isHiddenTool(toolName: string): boolean {
	return HIDDEN_TOOL_NAMES.has(toolName);
}

export function getToolDisplayName(toolName: string): string {
	switch (toolName) {
		case DevClawToolName.Bash:
		case DevClawToolName.PowerShell:
			return localize('tool.terminal', "Terminal");
		case DevClawToolName.ReadBash:
		case DevClawToolName.ReadPowerShell:
			return localize('tool.readTerminal', "Read Terminal");
		case DevClawToolName.WriteBash:
		case DevClawToolName.WritePowerShell:
			return localize('tool.writeTerminal', "Write to Terminal");
		case DevClawToolName.BashShutdown:
			return localize('tool.stopTerminal', "Stop Terminal");
		case DevClawToolName.ListBash:
		case DevClawToolName.ListPowerShell:
			return localize('tool.listTerminals', "List Terminals");
		case DevClawToolName.View:
			return localize('tool.readFile', "Read File");
		case DevClawToolName.Edit:
			return localize('tool.editFile', "Edit File");
		case DevClawToolName.Write:
			return localize('tool.createFile', "Create File");
		case DevClawToolName.Grep:
			return localize('tool.search', "Search");
		case DevClawToolName.Glob:
			return localize('tool.findFiles', "Find Files");
		case DevClawToolName.Patch:
			return localize('tool.patchFile', "Patch File");
		case DevClawToolName.WebSearch:
			return localize('tool.webSearch', "Web Search");
		case DevClawToolName.AskUser:
			return localize('tool.askUser', "Ask User");
		default:
			return toolName;
	}
}

export function getToolKind(toolName: string): 'terminal' | 'file' | 'search' | 'other' {
	if (SHELL_TOOL_NAMES.has(toolName)) {
		return 'terminal';
	}
	switch (toolName) {
		case DevClawToolName.View:
		case DevClawToolName.Edit:
		case DevClawToolName.Write:
		case DevClawToolName.Patch:
			return 'file';
		case DevClawToolName.Grep:
		case DevClawToolName.Glob:
		case DevClawToolName.WebSearch:
			return 'search';
		default:
			return 'other';
	}
}

export function getShellLanguage(toolName: string): string | undefined {
	if (toolName === DevClawToolName.PowerShell) {
		return 'powershell';
	}
	if (SHELL_TOOL_NAMES.has(toolName)) {
		return 'shellscript';
	}
	return undefined;
}

export function getInvocationMessage(toolName: string, displayName: string, parameters: Record<string, unknown> | undefined): string {
	if (SHELL_TOOL_NAMES.has(toolName) && parameters) {
		const cmd = (parameters as unknown as IShellToolArgs).command;
		if (cmd) {
			const short = cmd.length > 80 ? cmd.substring(0, 80) + '...' : cmd;
			return localize('invocation.runCommand', "Running `{0}`", short);
		}
	}
	switch (toolName) {
		case DevClawToolName.Edit:
		case DevClawToolName.View:
		case DevClawToolName.Write:
		case DevClawToolName.Patch: {
			const filePath = (parameters as unknown as IFileToolArgs | undefined)?.file_path;
			if (filePath) {
				const fileName = filePath.split('/').pop() || filePath;
				return localize('invocation.fileOp', "{0} `{1}`", displayName, fileName);
			}
			return displayName;
		}
		case DevClawToolName.Grep: {
			const pattern = (parameters as unknown as IGrepToolArgs | undefined)?.pattern;
			if (pattern) {
				return localize('invocation.search', "Searching for `{0}`", pattern);
			}
			return displayName;
		}
		case DevClawToolName.Glob: {
			const pattern = (parameters as unknown as IGlobToolArgs | undefined)?.pattern;
			if (pattern) {
				return localize('invocation.findFiles', "Finding files matching `{0}`", pattern);
			}
			return displayName;
		}
		default:
			return displayName;
	}
}

export function getPastTenseMessage(toolName: string, displayName: string, parameters: Record<string, unknown> | undefined, success: boolean): string {
	if (!success) {
		return localize('pastTense.failed', "{0} failed", displayName);
	}
	if (SHELL_TOOL_NAMES.has(toolName) && parameters) {
		const cmd = (parameters as unknown as IShellToolArgs).command;
		if (cmd) {
			const short = cmd.length > 80 ? cmd.substring(0, 80) + '...' : cmd;
			return localize('pastTense.ranCommand', "Ran `{0}`", short);
		}
	}
	switch (toolName) {
		case DevClawToolName.Edit:
		case DevClawToolName.Patch: {
			const filePath = (parameters as unknown as IFileToolArgs | undefined)?.file_path;
			const fileName = filePath?.split('/').pop() || '';
			return fileName ? localize('pastTense.edited', "Edited `{0}`", fileName) : localize('pastTense.editedFile', "Edited file");
		}
		case DevClawToolName.View: {
			const filePath = (parameters as unknown as IFileToolArgs | undefined)?.file_path;
			const fileName = filePath?.split('/').pop() || '';
			return fileName ? localize('pastTense.read', "Read `{0}`", fileName) : localize('pastTense.readFile', "Read file");
		}
		case DevClawToolName.Write: {
			const filePath = (parameters as unknown as IFileToolArgs | undefined)?.file_path;
			const fileName = filePath?.split('/').pop() || '';
			return fileName ? localize('pastTense.created', "Created `{0}`", fileName) : localize('pastTense.createdFile', "Created file");
		}
		case DevClawToolName.Grep:
			return localize('pastTense.searched', "Search complete");
		case DevClawToolName.Glob:
			return localize('pastTense.foundFiles', "Found files");
		default:
			return displayName;
	}
}

export function getToolInputString(toolName: string, parameters: Record<string, unknown> | undefined, rawArgs: string | undefined): string | undefined {
	if (SHELL_TOOL_NAMES.has(toolName) && parameters) {
		return (parameters as unknown as IShellToolArgs).command;
	}
	return rawArgs;
}
