/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
import { IDevClawService } from './devclawService.js';

interface DevClawAgentDef {
	id: string;
	name: string;
	fullName: string;
	description: string;
	slashCommands: { name: string; description: string }[];
	isDefault?: boolean;
}

const DEVCLAW_EXTENSION_ID = new ExtensionIdentifier('openclaw.ide');

const AGENT_PERSONAS: Record<string, string> = {
	'openclaw': 'Your AI assistant. Tell me what you need and I will help — code, docs, debugging, architecture, anything.',
};

const DEVCLAW_AGENTS: DevClawAgentDef[] = [
	{
		id: 'openclaw.assistant',
		name: 'openclaw',
		fullName: 'OpenClaw',
		description: 'Your AI assistant — powered by your own API keys',
		isDefault: true,
		slashCommands: [
			{ name: 'build', description: 'Build a feature end-to-end' },
			{ name: 'fix', description: 'Fix a bug or error' },
			{ name: 'explain', description: 'Explain how code works' },
			{ name: 'review', description: 'Review code for issues' },
			{ name: 'document', description: 'Write documentation' },
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
		@IDevClawService private readonly devClawService: IDevClawService,
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
				isSticky: true,
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
	/**
	 * Recursively builds a directory tree string, skipping common noise directories.
	 * Returns lines like: "  +-- src/", "  |   +-- app/", "  |   |   +-- page.tsx"
	 */
	private async buildDirectoryTree(folderUri: URI, prefix: string, depth: number, maxDepth: number): Promise<string[]> {
		if (depth > maxDepth) {
			return [];
		}

		const skipDirs = new Set([
			'node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'out',
			'.cache', '.vercel', '.output', '__pycache__', '.svelte-kit',
			'coverage', '.nyc_output', '.parcel-cache', 'vendor',
		]);

		try {
			const entries = await this.fileService.resolve(folderUri, { resolveMetadata: false });
			if (!entries.children) {
				return [];
			}

			const sorted = [...entries.children].sort((a, b) => {
				// Directories first, then files
				if (a.isDirectory && !b.isDirectory) { return -1; }
				if (!a.isDirectory && b.isDirectory) { return 1; }
				return a.name.localeCompare(b.name);
			});

			const lines: string[] = [];
			for (let i = 0; i < sorted.length; i++) {
				const entry = sorted[i];
				const isLast = i === sorted.length - 1;
				// allow-any-unicode-next-line
				const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
				// allow-any-unicode-next-line
				const childPrefix = isLast ? '    ' : '\u2502   ';

				if (entry.isDirectory) {
					if (skipDirs.has(entry.name)) {
						continue;
					}
					lines.push(`${prefix}${connector}${entry.name}/`);
					const children = await this.buildDirectoryTree(entry.resource, prefix + childPrefix, depth + 1, maxDepth);
					lines.push(...children);
				} else {
					lines.push(`${prefix}${connector}${entry.name}`);
				}
			}
			return lines;
		} catch {
			return [];
		}
	}

	private async gatherLocalContext(message: string): Promise<string> {
		const contextParts: string[] = [];

		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length > 0) {
			const folder = folders[0];
			contextParts.push(`[Workspace: ${folder.name} at ${folder.uri.fsPath}]`);

			// 1. Directory tree (3 levels deep — gives real project structure)
			try {
				const treeLines = await this.buildDirectoryTree(folder.uri, '', 0, 3);
				if (treeLines.length > 0) {
					contextParts.push(`[Project Structure]\n${treeLines.join('\n')}`);
				}
			} catch {
				// Skip tree on error
			}

			// 2. Key project files — full content for important ones, truncated for large ones
			const keyFiles: { path: string; maxChars: number }[] = [
				{ path: 'package.json', maxChars: 3000 },
				{ path: 'CLAUDE.md', maxChars: 5000 },
				{ path: 'README.md', maxChars: 2000 },
				{ path: 'tsconfig.json', maxChars: 1000 },
				{ path: 'next.config.js', maxChars: 1000 },
				{ path: 'next.config.mjs', maxChars: 1000 },
				{ path: 'next.config.ts', maxChars: 1000 },
				{ path: '.env.example', maxChars: 500 },
				{ path: 'tailwind.config.ts', maxChars: 1500 },
				{ path: 'tailwind.config.js', maxChars: 1500 },
				{ path: 'prisma/schema.prisma', maxChars: 3000 },
				{ path: 'drizzle.config.ts', maxChars: 1000 },
			];

			for (const { path, maxChars } of keyFiles) {
				try {
					const fileUri = URI.joinPath(folder.uri, path);
					if (await this.fileService.exists(fileUri)) {
						const content = await this.fileService.readFile(fileUri);
						const text = content.value.toString();
						const truncated = text.length > maxChars;
						contextParts.push(`[File: ${path}]\n${text.substring(0, maxChars)}${truncated ? '\n...(truncated)' : ''}`);
					}
				} catch {
					// Skip files we can't read
				}
			}

			// 3. Scan for key entry points (app router or pages router)
			const entryPoints = [
				'src/app/layout.tsx', 'src/app/page.tsx', 'app/layout.tsx', 'app/page.tsx',
				'src/pages/_app.tsx', 'src/pages/index.tsx', 'pages/_app.tsx', 'pages/index.tsx',
				'src/index.ts', 'src/index.tsx', 'src/main.ts', 'src/main.tsx',
			];
			for (const ep of entryPoints) {
				try {
					const fileUri = URI.joinPath(folder.uri, ep);
					if (await this.fileService.exists(fileUri)) {
						const content = await this.fileService.readFile(fileUri);
						const text = content.value.toString();
						contextParts.push(`[Entry: ${ep}]\n${text.substring(0, 3000)}${text.length > 3000 ? '\n...(truncated)' : ''}`);
					}
				} catch {
					// Skip
				}
			}
		}

		// 4. All open editor tabs — not just the active one
		const openEditors = this.editorService.editors;
		const seenPaths = new Set<string>();
		for (const editor of openEditors) {
			const resource = editor.resource;
			if (!resource || seenPaths.has(resource.fsPath)) {
				continue;
			}
			seenPaths.add(resource.fsPath);
			try {
				const content = await this.fileService.readFile(resource);
				const text = content.value.toString();
				const fileName = resource.path.split('/').pop() || 'unknown';
				const isActive = resource.toString() === this.editorService.activeEditor?.resource?.toString();
				const label = isActive ? `Active file: ${fileName}` : `Open tab: ${fileName}`;
				contextParts.push(`[${label} (${resource.fsPath})]\n${text.substring(0, 4000)}${text.length > 4000 ? '\n...(truncated)' : ''}`);
			} catch {
				// Skip files we can't read
			}
		}

		// 5. Detect file paths mentioned in the message and read them
		const pathPatterns = [
			/([A-Za-z]:\\[^\s"']+)/g,
			/(\/[^\s"']+\.[a-zA-Z]{1,10})/g,
			/(?:^|\s)([\w./\\-]+\.(?:ts|js|json|md|py|html|css|tsx|jsx|yaml|yml|toml))/g,
		];

		for (const pattern of pathPatterns) {
			const matches = message.matchAll(pattern);
			for (const match of matches) {
				const filePath = match[1];
				if (seenPaths.has(filePath)) {
					continue;
				}
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

					if (await this.fileService.exists(fileUri)) {
						const content = await this.fileService.readFile(fileUri);
						const text = content.value.toString();
						contextParts.push(`[Referenced: ${filePath}]\n${text.substring(0, 3000)}${text.length > 3000 ? '\n...(truncated)' : ''}`);
					}
				} catch {
					// Skip
				}
			}
		}

		const fullContext = contextParts.length > 0 ? '\n\n---\n[LOCAL CONTEXT FROM DEVCLAW IDE]\n' + contextParts.join('\n\n') : '';
		// Cap total context to 80k chars to stay within backend limits
		if (fullContext.length > 80000) {
			return fullContext.substring(0, 80000) + '\n...(context truncated)';
		}
		return fullContext;
	}

	private async handleRequest(
		def: DevClawAgentDef,
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		token: CancellationToken,
	): Promise<IChatAgentResult> {
		const message = request.message || '';
		const persona = AGENT_PERSONAS[def.name] || '';

		const backend = this.devClawService.backendType;

		if (!this.devClawService.isConnected) {
			const backendName = backend === 'openclaw' ? 'OpenClaw' : 'OpenClaw';
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(
					`**${def.fullName}** is ready.\n\n` +
					`> ${persona}\n\n` +
					`---\n\n` +
					`${backendName} is not connected. Configure your connection in **DevClaw Settings** (gear icon in the sidebar).`
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

			// All agents route through openclaw on the backend (it's the router)
			// The persona/role context tells openclaw which specialist voice to use
			const agentId = 'openclaw';
			const roleContext = persona ? `[Respond as ${def.fullName}: ${persona}]\n\n` : '';
			const capabilities = `[DEVCLAW IDE CAPABILITIES: You ARE running inside DevClaw IDE. You CAN create and edit files. When the user asks you to create or modify a file, respond with the full file content in a markdown code block with the filename as the language tag, like:\n\`\`\`path/to/file.ts\nfile content here\n\`\`\`\nThe user can click Apply to write it to disk. You CAN see the workspace files. You have full local context. Act like you have filesystem access — because DevClaw handles it for you.]\n\n`;
			const fullMessage = roleContext + capabilities + message + localContext;

			const controller = new AbortController();
			token.onCancellationRequested(() => controller.abort());

			let streamedResponse = '';

			let data: { response?: string; message?: string; thinking?: string; toolCalls?: { tool: string; result: string }[] };

			if (backend === 'openclaw') {
				// OpenClaw path — route through the shared backend client
				const client = this.devClawService.getClient();
				const response = await client.chat(agentId, fullMessage);
				streamedResponse = response.response;
				data = { response: streamedResponse };
			} else {
				// OpenClaw path — direct REST fetch
				const url = this.storageService.get('devteam.openclaw.url', StorageScope.APPLICATION, '');
				const apiKey = this.storageService.get('devteam.openclaw.apiKey', StorageScope.APPLICATION, '');

				const headers: Record<string, string> = { 'Content-Type': 'application/json' };
				if (apiKey) {
					headers['x-app-key'] = apiKey;
				}

				const res = await fetch(`${url}/api/chat`, {
					method: 'POST',
					headers,
					body: JSON.stringify({ message: fullMessage, agentId }),
					signal: controller.signal,
				});

				if (!res.ok) {
					let errorDetail = `${res.status} ${res.statusText}`;
					try {
						const errBody = await res.json();
						errorDetail = errBody.error || errorDetail;
						if (errBody.details) {
							errorDetail += ': ' + errBody.details.map((d: { field: string; message: string }) => `${d.field} — ${d.message}`).join(', ');
						}
					} catch { /* use status text */ }
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(`**OpenClaw Error:** ${errorDetail}`),
					}]);
					return { metadata: {} };
				}

				data = await res.json();
			}

			// Show thinking as a collapsed block if present
			if (data.thinking) {
				const thinkingMd = new MarkdownString();
				thinkingMd.supportHtml = true;
				// allow-any-unicode-next-line
				thinkingMd.value = `<details><summary>\u{1F4AD} Thinking...</summary>\n\n${data.thinking}\n\n</details>\n\n`;
				progress([{ kind: 'markdownContent', content: thinkingMd }]);
			}

			// Show tool calls as a collapsed block if present
			if (data.toolCalls && data.toolCalls.length > 0) {
				const toolLines = data.toolCalls.map((tc: { tool: string; result: string }) =>
					`- **${tc.tool}**: ${typeof tc.result === 'string' ? tc.result.substring(0, 200) : JSON.stringify(tc.result).substring(0, 200)}`
				).join('\n');
				const toolMd = new MarkdownString();
				toolMd.supportHtml = true;
				// allow-any-unicode-next-line
				toolMd.value = `<details><summary>\u{1F527} ${data.toolCalls.length} tool(s) used</summary>\n\n${toolLines}\n\n</details>\n\n`;
				progress([{ kind: 'markdownContent', content: toolMd }]);
			}

			// Show the main response
			streamedResponse = data.response || data.message || 'No response from agent.';
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(streamedResponse),
			}]);

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
				content: new MarkdownString(`**Connection error:** ${errorMsg}\n\nCheck your OpenClaw connection in DevClaw Settings.`),
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
