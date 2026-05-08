import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getLogger } from '@agent/shared';
import type { McpServerConfig } from './config.js';

const log = getLogger('mcp-client');

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  ok: boolean;
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  structuredContent?: unknown;
  isError: boolean;
  errorMessage?: string;
}

/**
 * Thin wrapper around an MCP client + stdio transport. Handles connect,
 * listTools with pagination, callTool, and clean shutdown. The supervisor
 * handles reconnection — this class just represents a single live connection.
 */
export class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  readonly name: string;

  constructor(private readonly config: McpServerConfig, private readonly env: NodeJS.ProcessEnv) {
    this.name = config.name;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    const client = new Client({ name: `agent-mcp-client-${this.name}`, version: '0.1.0' });
    // StdioClientTransport wants Record<string, string>; ProcessEnv values may
    // be undefined. Strip undefined entries.
    const envRecord: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.env)) {
      if (typeof v === 'string') envRecord[k] = v;
    }
    const transport = new StdioClientTransport({
      command: this.config.command,
      args: [...this.config.args],
      env: envRecord,
    });

    const connectPromise = client.connect(transport);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`MCP ${this.name}: connect timed out after ${this.config.startupTimeoutMs}ms`)),
        this.config.startupTimeoutMs,
      ),
    );
    await Promise.race([connectPromise, timeout]);

    this.client = client;
    this.transport = transport;
    log.info({ server: this.name, command: this.config.command }, 'mcp.client.connected');
  }

  async listTools(): Promise<McpToolSchema[]> {
    const client = this.requireClient();
    const tools: McpToolSchema[] = [];
    let cursor: string | undefined;
    do {
      const res = (await client.listTools(cursor ? { cursor } : {})) as {
        tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
        nextCursor?: string;
      };
      for (const t of res.tools) {
        tools.push({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
        });
      }
      cursor = res.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: unknown): Promise<McpCallResult> {
    const client = this.requireClient();
    try {
      const res = (await client.callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      })) as {
        content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
        structuredContent?: unknown;
        isError?: boolean;
      };
      return {
        ok: !res.isError,
        content: res.content ?? [],
        structuredContent: res.structuredContent,
        isError: res.isError ?? false,
      };
    } catch (e) {
      return {
        ok: false,
        content: [],
        isError: true,
        errorMessage: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    try {
      await client?.close();
    } catch (e) {
      log.warn({ err: (e as Error).message, server: this.name }, 'mcp.client.close.failed');
    }
    try {
      await transport?.close();
    } catch {
      // transport close often races the client close; best-effort
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  private requireClient(): Client {
    if (!this.client) throw new Error(`MCP ${this.name}: not connected`);
    return this.client;
  }
}
