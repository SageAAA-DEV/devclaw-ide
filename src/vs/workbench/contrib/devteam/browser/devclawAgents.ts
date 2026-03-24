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
			const agentId = def.name;
			const controller = new AbortController();
			token.onCancellationRequested(() => controller.abort());

			const res = await fetch(`${url}/api/chat`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
				},
				body: JSON.stringify({ message, agentId }),
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
			const response = data.response || data.message || 'No response from agent.';

			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(response),
			}]);

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
}
