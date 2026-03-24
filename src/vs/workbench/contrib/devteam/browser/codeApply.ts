/*---------------------------------------------------------------------------------------------
 *  DevTeam IDE - Code Apply
 *  Applies agent-generated code to the editor.
 *  Copilot mode: user clicks Apply on code blocks.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export interface CodeApplyRequest {
	filePath: string;   // relative path, e.g. "src/auth.ts"
	content: string;    // full file content
	language?: string;  // language hint from code block
}

export interface CodeApplyResult {
	success: boolean;
	filePath: string;
	created: boolean;   // true if file was created, false if overwritten
	error?: string;
}

export class CodeApplyService {

	constructor(
		private readonly fileService: IFileService,
		private readonly editorService: IEditorService,
		private readonly workspaceService: IWorkspaceContextService,
	) {}

	async apply(request: CodeApplyRequest): Promise<CodeApplyResult> {
		try {
			const fileUri = this.resolveUri(request.filePath);
			const exists = await this.fileService.exists(fileUri);

			// Write content
			await this.fileService.writeFile(fileUri, VSBuffer.fromString(request.content));

			// Open in editor
			await this.editorService.openEditor({
				resource: fileUri,
			});

			return {
				success: true,
				filePath: request.filePath,
				created: !exists,
			};
		} catch (err) {
			return {
				success: false,
				filePath: request.filePath,
				created: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	private resolveUri(filePath: string): URI {
		// If workspace is open, resolve relative to workspace root
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length > 0) {
			return URI.joinPath(folders[0].uri, filePath);
		}
		// Fallback: treat as absolute or relative to home
		if (filePath.startsWith('/') || filePath.match(/^[A-Za-z]:/)) {
			return URI.file(filePath);
		}
		// No workspace open — can't resolve relative path
		throw new Error(`No workspace open. Cannot resolve relative path: ${filePath}`);
	}
}
