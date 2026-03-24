/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SageAAA. All rights reserved.
 *  Licensed under the Proprietary License.
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

// --- Register CTRL-A agents as native chat participants ---
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { DevClawAgentRegistration } from './devclawAgents.js';

class DevClawAgentContribution extends DevClawAgentRegistration implements IWorkbenchContribution {
	static readonly ID = 'devclaw.agentRegistration';
}

registerWorkbenchContribution2(DevClawAgentContribution.ID, DevClawAgentContribution, WorkbenchPhase.AfterRestored);

import { DevTeamSettingsPane } from './settingsPane.js';
import { DevClawAgentsPane } from './agentsPane.js';

// --- Icons ---
const devteamAgentsIcon = registerIcon('devteam-agents-icon', Codicon.organization, localize('devteamAgentsIcon', 'DevClaw Agents view icon'));
const devteamSettingsIcon = registerIcon('devteam-settings-icon', Codicon.settingsGear, localize('devteamSettingsIcon', 'DevClaw Settings view icon'));

// --- View Container IDs ---
export const DEVTEAM_AGENTS_VIEWLET_ID = 'workbench.view.devteam-agents';
export const DEVTEAM_SETTINGS_VIEWLET_ID = 'workbench.view.devteam-settings';

// --- View IDs ---
export const DEVTEAM_AGENTS_VIEW_ID = 'devteam.agentsView';
export const DEVTEAM_SETTINGS_VIEW_ID = 'devteam.settingsView';

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
		if (selection && model && 'getValueInRange' in model) {
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
