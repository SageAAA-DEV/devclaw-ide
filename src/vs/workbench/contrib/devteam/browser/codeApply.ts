/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SageAAA / DevClaw Contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
		// Reject absolute paths — agent code must use workspace-relative paths
		if (filePath.startsWith('/') || filePath.match(/^[A-Za-z]:/)) {
			throw new Error(`Absolute paths are not allowed: ${filePath}`);
		}

		// Reject path traversal sequences
		const normalized = filePath.replace(/\\/g, '/');
		if (normalized.split('/').some(seg => seg === '..')) {
			throw new Error(`Path traversal is not allowed: ${filePath}`);
		}

		// Resolve relative to workspace root
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length === 0) {
			throw new Error(`No workspace open. Cannot resolve relative path: ${filePath}`);
		}

		const rootUri = folders[0].uri;
		const resolved = URI.joinPath(rootUri, normalized);

		// Belt-and-suspenders: ensure resolved path is still inside workspace
		if (!resolved.path.startsWith(rootUri.path)) {
			throw new Error(`Resolved path escapes workspace: ${filePath}`);
		}

		return resolved;
	}
}
