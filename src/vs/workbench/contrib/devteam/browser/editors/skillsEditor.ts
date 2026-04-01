/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorInputCapabilities, IEditorOpenContext } from '../../../../common/editor.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IGatewayRpcService } from '../../browser/gatewayRpcService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ISkillEntry {
	name: string;
	emoji: string;
	enabled: boolean;
	primaryEnv: string;
}

// ---------------------------------------------------------------------------
// SkillsEditorInput
// ---------------------------------------------------------------------------
export class SkillsEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.skillsEditor';

	readonly resource = URI.from({ scheme: 'devclaw-skills', path: 'default' });

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override get typeId(): string {
		return SkillsEditorInput.ID;
	}

	override getName(): string {
		return 'Skills';
	}

	override matches(other: unknown): boolean {
		return other instanceof SkillsEditorInput;
	}
}

// ---------------------------------------------------------------------------
// SkillsEditorPane
// ---------------------------------------------------------------------------
export class SkillsEditorPane extends EditorPane {

	static readonly ID = 'workbench.editor.skillsEditor';

	private _root!: HTMLElement;
	private _styleInjected = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IGatewayRpcService private readonly rpcService: IGatewayRpcService,
	) {
		super(SkillsEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// -- lifecycle -----------------------------------------------------------

	protected override createEditor(parent: HTMLElement): void {
		this._root = parent;
		this._root.classList.add('gw-skills-root');
		this._injectStyles();

		// Header
		const header = document.createElement('div');
		header.className = 'gw-skills-header';

		const title = document.createElement('h2');
		title.className = 'gw-skills-title';
		title.textContent = 'Skills';
		header.appendChild(title);

		const subtitle = document.createElement('p');
		subtitle.className = 'gw-skills-subtitle';
		subtitle.textContent = 'Manage agent skills available through the OpenClaw gateway.';
		header.appendChild(subtitle);

		this._root.appendChild(header);

		// Loading indicator
		const loading = document.createElement('div');
		loading.className = 'gw-loading';
		loading.textContent = 'Loading...';
		this._root.appendChild(loading);

		// Attempt to load live data
		this._loadLiveData();
	}

	override async setInput(
		input: EditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
	}

	override layout(dimension: Dimension): void {
		if (this._root) {
			this._root.style.width = `${dimension.width}px`;
			this._root.style.height = `${dimension.height}px`;
		}
	}

	// -- rendering -----------------------------------------------------------

	private _renderContent(skills: ISkillEntry[]): void {
		// Clear existing content safely
		while (this._root.firstChild) {
			this._root.removeChild(this._root.firstChild);
		}

		// Header
		const header = document.createElement('div');
		header.className = 'gw-skills-header';

		const title = document.createElement('h2');
		title.className = 'gw-skills-title';
		title.textContent = 'Skills';
		header.appendChild(title);

		const subtitle = document.createElement('p');
		subtitle.className = 'gw-skills-subtitle';
		subtitle.textContent = 'Manage agent skills available through the OpenClaw gateway.';
		header.appendChild(subtitle);

		this._root.appendChild(header);

		// Card grid
		const grid = document.createElement('div');
		grid.className = 'gw-skills-grid';

		for (const skill of skills) {
			grid.appendChild(this._createCard(skill));
		}

		this._root.appendChild(grid);
	}

	private async _loadLiveData(): Promise<void> {
		try {
			// Gateway returns skills at top level: { skills: [{ name, emoji, source, bundled, ... }] }
			const result = await this.rpcService.call<{
				skills?: Array<{ name: string; emoji?: string; source?: string; bundled?: boolean; enabled?: boolean; primaryEnv?: string }>;
				workspace?: { skills?: Array<{ name: string; emoji?: string; enabled?: boolean; primaryEnv?: string }> };
			}>('skills.status', { agentId: 'main' });

			// Handle both top-level and nested response shapes
			const rawSkills = result.skills ?? result.workspace?.skills ?? [];
			const skills: ISkillEntry[] = rawSkills.map(s => ({
				name: s.name,
				emoji: s.emoji ?? '\u26A1',
				enabled: s.enabled ?? !(typeof (s as Record<string, unknown>).bundled === 'boolean' && (s as Record<string, unknown>).bundled === false),
				primaryEnv: s.primaryEnv ?? (s as Record<string, unknown>).source as string ?? 'node',
			}));

			// Re-render with live data
			this._renderContent(skills);
		} catch (err) {
			// Clear and show error
			while (this._root.firstChild) {
				this._root.removeChild(this._root.firstChild);
			}

			const header = document.createElement('div');
			header.className = 'gw-skills-header';

			const title = document.createElement('h2');
			title.className = 'gw-skills-title';
			title.textContent = 'Skills';
			header.appendChild(title);

			const subtitle = document.createElement('p');
			subtitle.className = 'gw-skills-subtitle';
			subtitle.textContent = 'Manage agent skills available through the OpenClaw gateway.';
			header.appendChild(subtitle);

			this._root.appendChild(header);

			const error = document.createElement('div');
			error.className = 'gw-error';
			const isConnectionError = err instanceof Error && (err.message.includes('WebSocket') || err.message.includes('ECONNREFUSED') || err.message.includes('not connected'));
			error.textContent = isConnectionError ? 'Unable to connect to gateway' : 'No skills data available';
			this._root.appendChild(error);
		}
	}

	private _createCard(skill: ISkillEntry): HTMLElement {
		const card = document.createElement('div');
		card.className = 'gw-skills-card';
		if (!skill.enabled) {
			card.classList.add('gw-skills-card--disabled');
		}

		// Emoji
		const emoji = document.createElement('div');
		emoji.className = 'gw-skills-card-emoji';
		emoji.textContent = skill.emoji;
		card.appendChild(emoji);

		// Name
		const name = document.createElement('div');
		name.className = 'gw-skills-card-name';
		name.textContent = skill.name;
		card.appendChild(name);

		// Environment badge
		const badge = document.createElement('span');
		badge.className = 'gw-skills-card-badge';
		badge.textContent = skill.primaryEnv;
		card.appendChild(badge);

		// Toggle indicator
		const toggle = document.createElement('div');
		toggle.className = 'gw-skills-card-toggle';

		const track = document.createElement('span');
		track.className = 'gw-skills-toggle-track';
		if (skill.enabled) {
			track.classList.add('gw-skills-toggle-track--on');
		}

		const label = document.createElement('span');
		label.className = 'gw-skills-toggle-label';
		label.textContent = skill.enabled ? 'ON' : 'OFF';

		toggle.appendChild(track);
		toggle.appendChild(label);
		card.appendChild(toggle);

		return card;
	}

	// -- styles (injected once) ---------------------------------------------

	private _injectStyles(): void {
		if (this._styleInjected) {
			return;
		}
		this._styleInjected = true;

		const style = document.createElement('style');
		style.textContent = `
			.gw-skills-root {
				background: #0d0d1a;
				color: #e0e0e0;
				overflow-y: auto;
				padding: 32px 40px;
				box-sizing: border-box;
				font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
			}

			/* Header */
			.gw-skills-header {
				margin-bottom: 28px;
			}
			.gw-skills-title {
				margin: 0 0 6px;
				font-size: 22px;
				font-weight: 600;
				color: #ffffff;
			}
			.gw-skills-subtitle {
				margin: 0;
				font-size: 13px;
				color: #888;
			}

			/* Card grid */
			.gw-skills-grid {
				display: flex;
				flex-wrap: wrap;
				gap: 16px;
			}

			/* Card */
			.gw-skills-card {
				background: #16162a;
				border: 1px solid #2a2a44;
				border-radius: 10px;
				padding: 20px;
				width: 200px;
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 10px;
				transition: border-color 0.15s ease, box-shadow 0.15s ease;
			}
			.gw-skills-card:hover {
				border-color: #00d4ff;
				box-shadow: 0 0 12px rgba(0, 212, 255, 0.15);
			}
			.gw-skills-card--disabled {
				opacity: 0.5;
			}

			/* Emoji */
			.gw-skills-card-emoji {
				font-size: 32px;
				line-height: 1;
			}

			/* Name */
			.gw-skills-card-name {
				font-size: 14px;
				font-weight: 600;
				color: #ffffff;
				text-align: center;
			}

			/* Environment badge */
			.gw-skills-card-badge {
				display: inline-block;
				font-size: 11px;
				font-weight: 500;
				padding: 2px 8px;
				border-radius: 4px;
				background: rgba(0, 212, 255, 0.12);
				color: #00d4ff;
				text-transform: uppercase;
				letter-spacing: 0.5px;
			}

			/* Toggle indicator */
			.gw-skills-card-toggle {
				display: flex;
				align-items: center;
				gap: 6px;
				margin-top: 4px;
			}
			.gw-skills-toggle-track {
				display: inline-block;
				width: 32px;
				height: 16px;
				border-radius: 8px;
				background: #3a3a50;
				position: relative;
				transition: background 0.15s ease;
			}
			.gw-skills-toggle-track::after {
				content: '';
				position: absolute;
				top: 2px;
				left: 2px;
				width: 12px;
				height: 12px;
				border-radius: 50%;
				background: #888;
				transition: transform 0.15s ease, background 0.15s ease;
			}
			.gw-skills-toggle-track--on {
				background: rgba(0, 212, 255, 0.3);
			}
			.gw-skills-toggle-track--on::after {
				transform: translateX(16px);
				background: #00d4ff;
			}
			.gw-skills-toggle-label {
				font-size: 11px;
				font-weight: 600;
				color: #888;
				text-transform: uppercase;
				letter-spacing: 0.5px;
			}

			.gw-loading, .gw-error {
				padding: 32px;
				text-align: center;
				font-size: 13px;
			}
			.gw-loading { color: #808080; }
			.gw-error { color: #f44336; }
		`;
		this._root.ownerDocument.head.appendChild(style);
	}
}
