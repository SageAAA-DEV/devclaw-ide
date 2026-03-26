/*---------------------------------------------------------------------------------------------
 *  DevClaw - Native Chat Agent Registration
 *  Registers CTRL-A agents as VS Code chat participants.
 *  @devin, @scout, @sage, @ink, @ctrl-a — native in the chat.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IChatAgentService, IChatAgentImplementation, IChatAgentData, IChatAgentRequest, IChatAgentResult, IChatAgentHistoryEntry } from '../../chat/common/participants/chatAgents.js';
import { ChatAgentLocation, ChatModeKind } from '../../chat/common/constants.js';
import { IChatProgress } from '../../chat/common/chatService/chatService.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CtrlAClient } from '../common/ctrlAClient.js';

interface DevClawAgentDef {
	id: string;
	name: string;
	fullName: string;
	description: string;
	slashCommands: { name: string; description: string }[];
	isDefault?: boolean;
}

const DEVCLAW_EXTENSION_ID = new ExtensionIdentifier('sageaaa.devclaw');

const AGENT_PERSONAS: Record<string, string> = {
	'ctrl-a': 'I route your request to the best specialist on the team. Just tell me what you need \u2014 I\u2019ll pick the right agent automatically.',
	'devin': 'I\u2019m your lead engineer. I architect systems, build features, and make the big decisions about code structure and patterns.',
	'scout': 'I\u2019m your researcher. I dig into code, docs, and Stack Overflow. Ask me to investigate anything \u2014 I\u2019ll find the answer.',
	'sage': 'I catch what you miss. Send me code and I\u2019ll find bugs, security issues, and performance improvements.',
	'ink': 'I write docs, comments, PR descriptions, and READMEs. Let me make your code understandable to humans.',
};

const DEVCLAW_AGENTS: DevClawAgentDef[] = [
	{
		id: 'devclaw.ctrl-a',
		name: 'ctrl-a',
		fullName: 'CTRL-A',
		description: 'Routes your request to the best specialist agent',
		isDefault: true,
		slashCommands: [
			{ name: 'build', description: 'Build a feature end-to-end' },
			{ name: 'fix', description: 'Fix a bug or error' },
			{ name: 'deploy', description: 'Deploy your project' },
		],
	},
	{
		id: 'devclaw.devin',
		name: 'devin',
		fullName: 'Devin — Lead Engineer',
		description: 'Architect and build features, make big decisions about code structure',
		slashCommands: [
			{ name: 'architect', description: 'Design system architecture' },
			{ name: 'implement', description: 'Build a feature' },
			{ name: 'refactor', description: 'Refactor code' },
		],
	},
	{
		id: 'devclaw.scout',
		name: 'scout',
		fullName: 'Scout — Researcher',
		description: 'Investigate code, docs, and find answers',
		slashCommands: [
			{ name: 'investigate', description: 'Research a problem' },
			{ name: 'explain', description: 'Explain how code works' },
			{ name: 'find', description: 'Find relevant code or docs' },
		],
	},
	{
		id: 'devclaw.sage',
		name: 'sage',
		fullName: 'Sage — Code Reviewer',
		description: 'Review code for bugs, security, and improvements',
		slashCommands: [
			{ name: 'review', description: 'Review code for issues' },
			{ name: 'security', description: 'Security audit' },
			{ name: 'optimize', description: 'Performance suggestions' },
		],
	},
	{
		id: 'devclaw.ink',
		name: 'ink',
		fullName: 'Ink — Technical Writer',
		description: 'Write docs, comments, PR descriptions, READMEs',
		slashCommands: [
			{ name: 'document', description: 'Write documentation' },
			{ name: 'readme', description: 'Generate README' },
			{ name: 'pr', description: 'Write PR description' },
		],
	},
];

export class DevClawAgentRegistration extends Disposable {

	constructor(
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
		this.registerAllAgents();
	}

	private registerAllAgents(): void {
		for (const agentDef of DEVCLAW_AGENTS) {
			this.registerAgent(agentDef);
		}
	}

	private registerAgent(def: DevClawAgentDef): void {
		const agentData: IChatAgentData = {
			id: def.id,
			name: def.name,
			fullName: def.fullName,
			description: def.description,
			extensionId: DEVCLAW_EXTENSION_ID,
			extensionVersion: '0.1.0',
			extensionPublisherId: 'sageaaa',
			publisherDisplayName: 'SageAAA',
			extensionDisplayName: 'DevClaw',
			isDefault: def.isDefault ?? false,
			isDynamic: true,
			locations: [ChatAgentLocation.Chat],
			modes: [ChatModeKind.Ask, ChatModeKind.Agent],
			slashCommands: def.slashCommands.map(cmd => ({
				name: cmd.name,
				description: cmd.description,
			})),
			metadata: {
				isSticky: false,
			},
			disambiguation: [],
		};

		const impl: IChatAgentImplementation = {
			invoke: async (
				request: IChatAgentRequest,
				progress: (parts: IChatProgress[]) => void,
				_history: IChatAgentHistoryEntry[],
				token: CancellationToken
			): Promise<IChatAgentResult> => {
				return this.handleRequest(def, request, progress, token);
			},
			provideFollowups: async () => [],
		};

		const reg = this.chatAgentService.registerDynamicAgent(agentData, impl);
		this._register(reg);
	}

	/**
	 * Gathers local workspace context:
	 * - Workspace folder name and key files
	 * - Currently open file content
	 * - Reads any file paths mentioned in the message
	 */
	private async gatherLocalContext(message: string): Promise<string> {
		const contextParts: string[] = [];

		// 1. Workspace info
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length > 0) {
			const folder = folders[0];
			const folderName = folder.name;
			contextParts.push(`[Workspace: ${folderName} at ${folder.uri.fsPath}]`);

			// Try to read key project files for context
			for (const keyFile of ['package.json', 'README.md', 'CLAUDE.md']) {
				try {
					const fileUri = URI.joinPath(folder.uri, keyFile);
					const exists = await this.fileService.exists(fileUri);
					if (exists) {
						const content = await this.fileService.readFile(fileUri);
						const text = content.value.toString();
						// Limit to first 500 chars for context
						contextParts.push(`[File: ${keyFile}]\n${text.substring(0, 500)}${text.length > 500 ? '\n...(truncated)' : ''}`);
					}
				} catch {
					// Skip files we can't read
				}
			}
		}

		// 2. Currently open/active file
		const activeEditor = this.editorService.activeTextEditorControl;
		const activeResource = this.editorService.activeEditor?.resource;
		if (activeEditor && activeResource) {
			const model = activeEditor.getModel?.();
			if (model && 'getValue' in model) {
				const content = (model as { getValue(): string }).getValue();
				const fileName = activeResource.path.split('/').pop() || 'unknown';
				// Limit to 2000 chars
				contextParts.push(`[Active file: ${fileName} (${activeResource.fsPath})]\n${content.substring(0, 2000)}${content.length > 2000 ? '\n...(truncated)' : ''}`);
			}
		}

		// 3. Detect file paths in the message and read them
		const pathPatterns = [
			/([A-Za-z]:\\[^\s"']+)/g,           // Windows paths: C:\Users\...
			/(\/[^\s"']+\.[a-zA-Z]{1,10})/g,     // Unix paths: /home/user/file.ts
			/(?:^|\s)([\w.-]+\.(?:ts|js|json|md|py|html|css|tsx|jsx|yaml|yml|toml))/g,  // Relative filenames
		];

		for (const pattern of pathPatterns) {
			const matches = message.matchAll(pattern);
			for (const match of matches) {
				const filePath = match[1];
				try {
					let fileUri: URI;
					if (filePath.match(/^[A-Za-z]:\\/)) {
						fileUri = URI.file(filePath);
					} else if (filePath.startsWith('/')) {
						fileUri = URI.file(filePath);
					} else if (folders.length > 0) {
						fileUri = URI.joinPath(folders[0].uri, filePath);
					} else {
						continue;
					}

					const exists = await this.fileService.exists(fileUri);
					if (exists) {
						const content = await this.fileService.readFile(fileUri);
						const text = content.value.toString();
						contextParts.push(`[Referenced file: ${filePath}]\n${text.substring(0, 3000)}${text.length > 3000 ? '\n...(truncated)' : ''}`);
					}
				} catch {
					// Skip files we can't read
				}
			}
		}

		return contextParts.length > 0 ? '\n\n---\n[LOCAL CONTEXT FROM DEVCLAW IDE]\n' + contextParts.join('\n\n') : '';
	}

	private async handleRequest(
		def: DevClawAgentDef,
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		token: CancellationToken,
	): Promise<IChatAgentResult> {
		const url = this.storageService.get('devteam.ctrlA.url', StorageScope.APPLICATION, '');
		const apiKey = this.storageService.get('devteam.ctrlA.apiKey', StorageScope.APPLICATION, '');
		const message = request.message || '';

		const persona = AGENT_PERSONAS[def.name] || '';

		if (!url) {
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(
					`**${def.fullName}** is ready.\n\n` +
					`> ${persona}\n\n` +
					`---\n\n` +
					`CTRL-A is not connected. Configure your connection in **DevClaw Settings** (gear icon in the sidebar) to unlock full agent capabilities.\n\n` +
					`Set your CTRL-A Server URL and API Key, then click **Test Connection**.`
				),
			}]);
			return { metadata: {} };
		}

		if (token.isCancellationRequested) {
			return { metadata: {} };
		}

		try {
			// Gather local workspace context (files, active editor, referenced paths)
			const localContext = await this.gatherLocalContext(message);

			// All DevClaw agents route through ctrl-a on the backend
			const ctrlAAgentId = 'ctrl-a';
			const roleContext = persona ? `[Respond as ${def.fullName}: ${persona}]\n\n` : '';
			const capabilities = `[DEVCLAW IDE CAPABILITIES: You ARE running inside DevClaw IDE. You CAN create and edit files. When the user asks you to create or modify a file, respond with the full file content in a markdown code block with the filename as the language tag, like:\n\`\`\`path/to/file.ts\nfile content here\n\`\`\`\nThe user can click Apply to write it to disk. You CAN see the workspace files. You have full local context. Act like you have filesystem access — because DevClaw handles it for you.]\n\n`;
			const fullMessage = roleContext + capabilities + message + localContext;

			const controller = new AbortController();
			token.onCancellationRequested(() => controller.abort());

			// Try streaming endpoint first, fall back to blocking fetch
			let streamedResponse = '';
			const client = new CtrlAClient({ baseUrl: url, apiKey: apiKey });

			try {
				streamedResponse = await client.chatStream(ctrlAAgentId, fullMessage, (chunk) => {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(chunk),
					}]);
				});
			} catch {
				// Fall back to blocking fetch if streaming endpoint not available
				const res = await fetch(`${url}/api/chat`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-api-key': apiKey,
					},
					body: JSON.stringify({ message: fullMessage, agentId: ctrlAAgentId }),
					signal: controller.signal,
				});

				if (!res.ok) {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(`**Error:** CTRL-A returned ${res.status} ${res.statusText}`),
					}]);
					return { metadata: {} };
				}

				const data = await res.json();
				streamedResponse = data.response || data.message || 'No response from agent.';
				progress([{
					kind: 'markdownContent',
					content: new MarkdownString(streamedResponse),
				}]);
			}

			// Auto-detect code blocks with file paths and create/update files
			const createdFiles = await this.autoApplyCodeBlocks(streamedResponse);
			if (createdFiles.length > 0) {
				const fileLinks = createdFiles.map(f => `- [${f.path}](${f.uri.toString()})`).join('\n');
				progress([{
					kind: 'markdownContent',
					content: new MarkdownString(
						`\n\n---\n**Files ${createdFiles.some(f => f.created) ? 'created' : 'updated'}:**\n${fileLinks}`,
						{ isTrusted: true }
					),
				}]);

				// Open the first created file in the editor
				if (createdFiles.length > 0) {
					await this.editorService.openEditor({ resource: createdFiles[0].uri });
				}
			}

			return { metadata: {} };
		} catch (err) {
			if (token.isCancellationRequested) {
				return { metadata: {} };
			}
			const errorMsg = err instanceof Error ? err.message : String(err);
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(`**Connection error:** ${errorMsg}\n\nCheck your CTRL-A connection in DevClaw Settings.`),
			}]);
			return { metadata: {} };
		}
	}

	/**
	 * Parses agent response for code blocks with file path language tags.
	 * Auto-creates/updates files and returns info about what was created.
	 */
	private async autoApplyCodeBlocks(response: string): Promise<{ path: string; uri: URI; created: boolean }[]> {
		const results: { path: string; uri: URI; created: boolean }[] = [];
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length === 0) {
			return results;
		}

		const codeBlockRegex = /```([\w./\\-]+\.[\w]+)\n([\s\S]*?)```/g;
		let match;
		while ((match = codeBlockRegex.exec(response)) !== null) {
			const filePath = match[1];
			const content = match[2];

			const skipTags = ['typescript', 'javascript', 'python', 'bash', 'shell', 'json', 'html', 'css', 'markdown', 'sql', 'yaml', 'toml', 'xml', 'rust', 'go', 'java', 'cpp', 'ruby', 'php', 'swift', 'kotlin', 'dart', 'text', 'txt', 'diff', 'log'];
			if (skipTags.includes(filePath.toLowerCase())) {
				continue;
			}

			try {
				const fileUri = URI.joinPath(folders[0].uri, filePath);
				const exists = await this.fileService.exists(fileUri);
				await this.fileService.writeFile(fileUri, VSBuffer.fromString(content));
				results.push({ path: filePath, uri: fileUri, created: !exists });
			} catch {
				// Skip files we can't write
			}
		}

		return results;
	}
}
