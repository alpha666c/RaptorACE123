export * from './scoping.js';
export * from './types.js';
export * from './registry.js';
export * from './proc.js';
export { readFileTool } from './fs/read-file.js';
export { globTool } from './fs/glob.js';
export { grepTool } from './fs/grep.js';
export { writeFileTool } from './fs/write-file.js';
export { editFileTool } from './fs/edit-file.js';
export { gitStatusTool } from './git/status.js';
export { gitDiffTool } from './git/diff.js';
export { gitCommitTool } from './git/commit.js';
export { shellTool, buildShellTool } from './shell/run.js';
export { DEFAULT_SHELL_ALLOWLIST, matchAllowlist, type ShellAllowEntry } from './shell/allowlist.js';

import { readFileTool } from './fs/read-file.js';
import { globTool } from './fs/glob.js';
import { grepTool } from './fs/grep.js';
import { writeFileTool } from './fs/write-file.js';
import { editFileTool } from './fs/edit-file.js';
import { gitStatusTool } from './git/status.js';
import { gitDiffTool } from './git/diff.js';
import { gitCommitTool } from './git/commit.js';
import { shellTool } from './shell/run.js';
import { ToolRegistry } from './registry.js';

/** Build a registry preloaded with all built-in tools (M1 + M2). */
export function buildBuiltInRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(readFileTool);
  reg.register(globTool);
  reg.register(grepTool);
  reg.register(writeFileTool);
  reg.register(editFileTool);
  reg.register(gitStatusTool);
  reg.register(gitDiffTool);
  reg.register(gitCommitTool);
  reg.register(shellTool);
  return reg;
}
