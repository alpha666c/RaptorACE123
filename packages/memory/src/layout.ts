import * as path from 'node:path';

/**
 * Per-project memory file layout, mirroring the plan:
 *
 *   <projectRoot>/.agent/
 *   ├── index.sqlite
 *   └── memory/
 *       ├── preferences.md
 *       ├── conventions.md
 *       ├── architecture.md
 *       ├── decisions/
 *       └── facts/
 */
export interface MemoryLayout {
  projectRoot: string;
  agentDir: string;
  sqlitePath: string;
  memoryDir: string;
  preferencesMd: string;
  conventionsMd: string;
  architectureMd: string;
  decisionsDir: string;
  factsDir: string;
  /** CLAUDE.md at the project root — always-loaded if present. */
  claudeMd: string;
  /**
   * Universal activity log. The agent appends a terse entry after every real-
   * work turn and reads the tail at the start of every turn. Lives in every
   * workspace at the same path so behaviour is identical regardless of repo.
   */
  changelogMd: string;
}

export function layoutFor(projectRoot: string): MemoryLayout {
  const agentDir = path.join(projectRoot, '.agent');
  const memoryDir = path.join(agentDir, 'memory');
  return {
    projectRoot,
    agentDir,
    sqlitePath: path.join(agentDir, 'index.sqlite'),
    memoryDir,
    preferencesMd: path.join(memoryDir, 'preferences.md'),
    conventionsMd: path.join(memoryDir, 'conventions.md'),
    architectureMd: path.join(memoryDir, 'architecture.md'),
    decisionsDir: path.join(memoryDir, 'decisions'),
    factsDir: path.join(memoryDir, 'facts'),
    claudeMd: path.join(projectRoot, 'CLAUDE.md'),
    changelogMd: path.join(agentDir, 'CHANGELOG.md'),
  };
}
