/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DevClaw IDE contribution point
// Registers activity bar icons for Agents + Settings
// Chat uses the native VS Code chat system with DevClaw agents registered as participants

import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import './devclawService.js'; // registers the singleton
import './openclawDaemonStub.js'; // browser-safe IOpenClawDaemonService stub
import './privacyConsent.js'; // Privacy consent dialog on first launch
import './settingsImport.js'; // Settings import commands for VS Code, Cursor, Windsurf, Antigravity

// --- Register Gateway Editor Panes ---
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { AgentsEditorPane, AgentsEditorInput } from './editors/agentsEditor.js';
import { SkillsEditorPane, SkillsEditorInput } from './editors/skillsEditor.js';
import { ToolsEditorPane, ToolsEditorInput } from './editors/toolsEditor.js';
import { SessionsEditorPane, SessionsEditorInput } from './editors/sessionsEditor.js';
import { ModelsEditorPane, ModelsEditorInput } from './editors/modelsEditor.js';
import { ConfigEditorPane, ConfigEditorInput } from './editors/configEditor.js';
import { ChannelsEditorPane, ChannelsEditorInput } from './editors/channelsEditor.js';
import { NodesEditorPane, NodesEditorInput } from './editors/nodesEditor.js';
import { CronEditorPane, CronEditorInput } from './editors/cronEditor.js';
import { LogsEditorPane, LogsEditorInput } from './editors/logsEditor.js';
import { UsageEditorPane, UsageEditorInput } from './editors/usageEditor.js';
import { OverviewEditorPane, OverviewEditorInput } from './editors/overviewEditor.js';

const editorPaneRegistry = Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane);

const panels = [
	{ pane: AgentsEditorPane, input: AgentsEditorInput, label: 'Agents' },
	{ pane: SkillsEditorPane, input: SkillsEditorInput, label: 'Skills' },
	{ pane: ToolsEditorPane, input: ToolsEditorInput, label: 'Tools' },
	{ pane: SessionsEditorPane, input: SessionsEditorInput, label: 'Sessions' },
	{ pane: ModelsEditorPane, input: ModelsEditorInput, label: 'Models' },
	{ pane: ConfigEditorPane, input: ConfigEditorInput, label: 'Config' },
	{ pane: ChannelsEditorPane, input: ChannelsEditorInput, label: 'Channels' },
	{ pane: NodesEditorPane, input: NodesEditorInput, label: 'Nodes' },
	{ pane: CronEditorPane, input: CronEditorInput, label: 'Cron Jobs' },
	{ pane: LogsEditorPane, input: LogsEditorInput, label: 'Logs' },
	{ pane: UsageEditorPane, input: UsageEditorInput, label: 'Usage' },
	{ pane: OverviewEditorPane, input: OverviewEditorInput, label: 'Overview' },
];

for (const { pane, input, label } of panels) {
	editorPaneRegistry.registerEditorPane(
		EditorPaneDescriptor.create(pane, pane.ID, localize(`editor.${label}`, label)),
		[new SyncDescriptor(input)]
	);
}

// --- Register OpenClaw as native chat participant ---
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { DevClawAgentRegistration } from './devclawAgents.js';

class DevClawAgentContribution extends DevClawAgentRegistration implements IWorkbenchContribution {
	static readonly ID = 'devclaw.agentRegistration';
}

registerWorkbenchContribution2(DevClawAgentContribution.ID, DevClawAgentContribution, WorkbenchPhase.AfterRestored);

// --- Register Welcome Wizard (first-launch BYOK setup) ---
import { WelcomeWizardContribution } from './welcomeWizard.js';
registerWorkbenchContribution2(WelcomeWizardContribution.ID, WelcomeWizardContribution, WorkbenchPhase.AfterRestored);

import { DevTeamSettingsPane } from './settingsPane.js';
import { DevClawAgentsPane } from './agentsPane.js';
import { GatewayPane } from './gatewayPane.js';

// --- Icons ---
const devteamAgentsIcon = registerIcon('devteam-agents-icon', Codicon.organization, localize('devteamAgentsIcon', 'DevClaw Agents view icon'));
const devteamSettingsIcon = registerIcon('devteam-settings-icon', Codicon.settingsGear, localize('devteamSettingsIcon', 'DevClaw Settings view icon'));
// allow-any-unicode-next-line
const devteamGatewayIcon = registerIcon('devteam-gateway-icon', Codicon.settings, localize('devteamGatewayIcon', 'OpenClaw Gateway view icon'));

// --- View Container IDs ---
export const DEVTEAM_AGENTS_VIEWLET_ID = 'workbench.view.devteam-agents';
export const DEVTEAM_SETTINGS_VIEWLET_ID = 'workbench.view.devteam-settings';
export const DEVTEAM_GATEWAY_VIEWLET_ID = 'workbench.view.devteam-gateway';

// --- View IDs ---
export const DEVTEAM_AGENTS_VIEW_ID = 'devteam.agentsView';
export const DEVTEAM_SETTINGS_VIEW_ID = 'devteam.settingsView';
export const DEVTEAM_GATEWAY_VIEW_ID = 'devteam.gatewayView';

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

// --- Agents (left sidebar — team picker) ---
const agentsContainer = viewContainersRegistry.registerViewContainer({
	id: DEVTEAM_AGENTS_VIEWLET_ID,
	title: localize2('devteam.agents', 'Agents'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DEVTEAM_AGENTS_VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: devteamAgentsIcon,
	order: 10,
}, ViewContainerLocation.Sidebar);

viewsRegistry.registerViews([{
	id: DEVTEAM_AGENTS_VIEW_ID,
	name: localize2('devteam.agentsView', 'Agents'),
	ctorDescriptor: new SyncDescriptor(DevClawAgentsPane),
	containerIcon: devteamAgentsIcon,
	canToggleVisibility: false,
	canMoveView: false,
	order: 0,
}], agentsContainer);

// --- Settings (left sidebar) ---
const settingsContainer = viewContainersRegistry.registerViewContainer({
	id: DEVTEAM_SETTINGS_VIEWLET_ID,
	title: localize2('devteam.settings', 'DevClaw Settings'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DEVTEAM_SETTINGS_VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: devteamSettingsIcon,
	order: 11,
}, ViewContainerLocation.Sidebar);

viewsRegistry.registerViews([{
	id: DEVTEAM_SETTINGS_VIEW_ID,
	name: localize2('devteam.settingsView', 'DevClaw Settings'),
	ctorDescriptor: new SyncDescriptor(DevTeamSettingsPane),
	containerIcon: devteamSettingsIcon,
	canToggleVisibility: false,
	canMoveView: false,
	order: 0,
}], settingsContainer);

// --- Gateway (left sidebar — OpenClaw control panel) ---
const gatewayContainer = viewContainersRegistry.registerViewContainer({
	id: DEVTEAM_GATEWAY_VIEWLET_ID,
	title: localize2('devteam.gateway', 'OpenClaw Gateway'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DEVTEAM_GATEWAY_VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: devteamGatewayIcon,
	order: 12,
}, ViewContainerLocation.Sidebar);

viewsRegistry.registerViews([{
	id: DEVTEAM_GATEWAY_VIEW_ID,
	name: localize2('devteam.gatewayView', 'OpenClaw Gateway'),
	ctorDescriptor: new SyncDescriptor(GatewayPane),
	containerIcon: devteamGatewayIcon,
	canToggleVisibility: false,
	canMoveView: false,
	order: 0,
}], gatewayContainer);

// --- Editor Context Menu: Ask Agent, Explain, Refactor ---
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ChatViewId } from '../../chat/browser/chat.js';

function registerAgentCommand(id: string, label: string, promptPrefix: string) {
	CommandsRegistry.registerCommand(id, async (accessor) => {
		const editorService = accessor.get(IEditorService);
		const viewsService = accessor.get(IViewsService);

		// Get selected text from active editor
		const editor = editorService.activeTextEditorControl;
		const selection = editor?.getSelection?.();
		const model = editor?.getModel?.();
		let selectedText = '';
		if (selection && model && typeof (model as { getValueInRange?(sel: unknown): string }).getValueInRange === 'function') {
			selectedText = (model as { getValueInRange(sel: unknown): string }).getValueInRange(selection);
		}

		if (!selectedText) {
			return;
		}

		// Open the native chat panel
		await viewsService.openView(ChatViewId, true);

		// TODO: Inject the selected text + prompt into the native chat input
	});

	MenuRegistry.appendMenuItem(MenuId.EditorContext, {
		command: { id, title: label },
		group: 'devteam',
		order: id.endsWith('ask') ? 1 : id.endsWith('explain') ? 2 : 3,
		when: ContextKeyExpr.and(ContextKeyExpr.has('editorHasSelection')),
	});
}

registerAgentCommand('devteam.askAgent', 'Ask Agent', '');
registerAgentCommand('devteam.explainThis', 'Explain This', 'Explain this code:\n\n');
registerAgentCommand('devteam.refactorThis', 'Refactor This', 'Refactor this code:\n\n');

// --- Settings Import Commands (Command Palette) ---
for (const [id, title] of [
	['devteam.importVSCodeSettings', 'DevClaw: Import VS Code Settings'],
	['devteam.importCursorSettings', 'DevClaw: Import Cursor Settings'],
	['devteam.importWindsurfSettings', 'DevClaw: Import Windsurf Settings'],
	['devteam.importAntigravitySettings', 'DevClaw: Import Antigravity Settings'],
] as const) {
	MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
		command: { id, title },
	});
}
