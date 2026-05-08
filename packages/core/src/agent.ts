import { streamText, type CoreMessage } from 'ai';
import type { McpSupervisor } from '@agent/mcp';
import { estimateCostUsd, type ModelGateway } from '@agent/model-gateway';
import type { SessionPermissionStore, Approver } from '@agent/permissions';
import type { SkillRegistry, SkillContext, TurnSummary } from '@agent/skills';
import type { ToolContext, ToolRegistry } from '@agent/tools';
import type { AgentEvent, EventListener } from '@agent/shared';
import { getLogger, newId } from '@agent/shared';
import type { MemoryStore } from '@agent/memory';
import { buildAiSdkTools } from './tool-adapter.js';
import { buildSystemPrompt } from './prompts.js';
import { parseCouncilDirective, runCouncil, shouldAutoCouncil } from './council/index.js';
import { compactMessages, shouldCompact } from './compaction.js';

function describeApiError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const e = error as {
    name?: string;
    message?: string;
    statusCode?: number;
    responseBody?: string;
    url?: string;
  };
  const parts: string[] = [];
  if (e.name) parts.push(e.name);
  if (e.statusCode) parts.push(`HTTP ${e.statusCode}`);
  if (e.message) parts.push(e.message);
  if (e.responseBody) {
    const body = String(e.responseBody).slice(0, 800);
    parts.push(`body: ${body}`);
  }
  if (e.url) parts.push(`url: ${e.url}`);
  return parts.join(' | ') || String(error);
}

export interface AgentHostConfig {
  projectRoots: readonly string[];
  registry: ToolRegistry;
  gateway: ModelGateway;
  session: SessionPermissionStore;
  approver: Approver;
  memory?: MemoryStore;
  /** Owning supervisor — AgentHost will stop it on dispose. */
  mcp?: McpSupervisor;
  /** Skills registry — its pre-turn hooks extend the system prompt, post-turn hooks run after each turn. */
  skills?: SkillRegistry;
  taskType?: string;
  maxSteps?: number;
  /** Maximum USD cost per turn. When the per-turn running total would exceed this, subsequent model calls are blocked. */
  maxCostPerTurnUsd?: number;
  /** Context-window token budget. When prior messages exceed 80% of this, compaction runs before the turn. */
  contextTokenBudget?: number;
  /** Council mode: 'off' (default), 'auto' (heuristics + /council), or 'force' (every turn). */
  councilMode?: 'off' | 'auto' | 'force';
}

export interface RunOptions {
  userMessage: string;
  priorMessages?: CoreMessage[];
  signal?: AbortSignal;
}

export interface RunResult {
  sessionId: string;
  finalText: string;
  messages: CoreMessage[];
}

/**
 * Single-session agent host. Holds the live registry, gateway, permissions,
 * approver, and optional memory store. Each `run()` call executes one user turn.
 *
 * If `memory` is provided, always-loaded files (CLAUDE.md + preferences.md +
 * conventions.md + architecture.md) and FTS5-retrieved facts are injected into
 * the system prompt. Sessions and turns are persisted to SQLite.
 */
export class AgentHost {
  private listeners = new Set<EventListener>();
  private log = getLogger('agent');
  private sessionStarted = false;
  readonly sessionId: string;

  constructor(private cfg: AgentHostConfig) {
    this.sessionId = newId('sess');
    if (this.cfg.memory && !this.sessionStarted) {
      try {
        this.cfg.memory.startSession({
          id: this.sessionId,
          projectRoot: this.cfg.projectRoots[0] ?? '',
          tier: this.cfg.session.getTier(),
        });
        this.sessionStarted = true;
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'memory.startSession.failed');
      }
    }
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(summary?: string): Promise<void> {
    if (this.cfg.memory && this.sessionStarted) {
      try {
        this.cfg.memory.endSession(this.sessionId, summary);
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'memory.endSession.failed');
      }
    }
    if (this.cfg.mcp) {
      try {
        await this.cfg.mcp.stop();
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'mcp.stop.failed');
      }
    }
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'event.listener.failed');
      }
    }
  }

  async run(opts: RunOptions): Promise<RunResult> {
    const { userMessage, priorMessages = [], signal } = opts;
    const turnId = newId('turn');
    const turnStartedAt = Date.now();
    this.emit({ kind: 'agent.started', sessionId: this.sessionId, timestamp: turnStartedAt });

    const tier = this.cfg.session.getTier();
    const availableTools = this.cfg.registry.all().map((t) => ({
      name: t.name,
      description: `[min tier ${t.minTier}] ${t.description}`,
    }));

    const memoryBlock = this.buildMemoryBlock(userMessage);

    // Run pre-turn skill hooks. Each may contribute a markdown block appended
    // to the system prompt. Failures in a single skill don't block the turn.
    const toolContext: ToolContext = {
      sessionId: this.sessionId,
      projectRoots: this.cfg.projectRoots,
      signal: signal ?? new AbortController().signal,
    };
    const skillPromptAdditions = await this.runPreTurnHooks(userMessage, tier, toolContext);

    const systemPrompt = buildSystemPrompt({
      projectRoots: this.cfg.projectRoots,
      currentTier: tier,
      availableTools,
      ...(memoryBlock ? { memoryBlock } : {}),
      ...(skillPromptAdditions ? { skillsBlock: skillPromptAdditions } : {}),
    });

    const toolCallRecords: Array<{
      name: string;
      durationMs?: number;
      ok: boolean;
      result?: unknown;
      error?: string;
    }> = [];
    const registryCtx = {
      sessionId: this.sessionId,
      projectRoots: this.cfg.projectRoots,
      session: this.cfg.session,
      approver: this.cfg.approver,
      signal: signal ?? new AbortController().signal,
      onEvent: (ev: { kind: string; payload: unknown }) => {
        switch (ev.kind) {
          case 'tool.call':
            this.emit({ kind: 'tool.call', sessionId: this.sessionId, ...(ev.payload as { callId: string; name: string; args: unknown }) });
            break;
          case 'tool.result': {
            const p = ev.payload as { callId: string; name: string; result: unknown; durationMs: number };
            toolCallRecords.push({ name: p.name, durationMs: p.durationMs, ok: true, result: p.result });
            this.emit({ kind: 'tool.result', sessionId: this.sessionId, ...p });
            break;
          }
          case 'tool.error': {
            const p = ev.payload as { callId: string; name: string; error: string };
            toolCallRecords.push({ name: p.name, ok: false, error: p.error });
            this.emit({ kind: 'tool.error', sessionId: this.sessionId, ...p });
            break;
          }
        }
      },
    };

    const aiTools = buildAiSdkTools(this.cfg.registry, registryCtx);
    const selection = this.cfg.gateway.selectModel(this.cfg.taskType ?? 'implement');

    // Compaction: if prior messages near the context budget, summarise them.
    const budget = this.cfg.contextTokenBudget;
    let workingPriors = priorMessages;
    if (budget && shouldCompact(workingPriors, budget)) {
      try {
        const compacted = await compactMessages({
          priorMessages: workingPriors,
          preserved: {
            activeTask: userMessage.slice(0, 200),
            currentTier: tier,
            projectRoots: this.cfg.projectRoots,
            filesTouched: [],
            openDecisions: [],
            unresolvedQuestions: [],
          },
          gateway: this.cfg.gateway,
          ...(signal ? { signal } : {}),
        });
        workingPriors = compacted.messages;
        this.log.info({ before: compacted.before, after: compacted.after }, 'compaction.applied');
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'compaction.failed');
      }
    }

    // Council mode: opt-in via explicit `/council` prefix, `councilMode` setting, or heuristics.
    const councilDirective = parseCouncilDirective(userMessage);
    const councilMode = this.cfg.councilMode ?? 'off';
    const councilEnabled =
      councilMode === 'force' ||
      councilDirective.forced ||
      (councilMode === 'auto' && shouldAutoCouncil(councilDirective.stripped));
    const effectiveUserMessage = councilDirective.stripped || userMessage;

    const messages: CoreMessage[] = [...workingPriors, { role: 'user', content: effectiveUserMessage }];

    let finalText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      this.log.info(
        { model: selection.resolvedModel, taskType: selection.taskType, council: councilEnabled },
        'agent.run.start',
      );

      if (councilEnabled) {
        const council = await runCouncil({
          userMessage: effectiveUserMessage,
          systemPromptCommon: systemPrompt,
          gateway: this.cfg.gateway,
          tools: aiTools,
          maxSteps: this.cfg.maxSteps ?? 8,
          temperature: selection.limits.temperature,
          maxOutputTokens: selection.limits.maxOutputTokens,
          onStreamChunk: (chunk) => {
            finalText += chunk;
            this.emit({ kind: 'message.chunk', sessionId: this.sessionId, text: chunk });
          },
          onRoleUpdate: (role, text) => {
            this.emit({
              kind: 'message.chunk',
              sessionId: this.sessionId,
              text: `\n\n[council:${role}]\n${text}\n`,
            });
          },
          ...(signal ? { signal } : {}),
        });
        inputTokens = council.inputTokensTotal;
        outputTokens = council.outputTokensTotal;
        const costUsd = estimateCostUsd(selection.resolvedModel, inputTokens, outputTokens);
        this.emit({ kind: 'message.complete', sessionId: this.sessionId, text: finalText });
        this.emit({
          kind: 'model.call',
          sessionId: this.sessionId,
          taskType: 'council',
          model: selection.resolvedModel,
          inputTokens,
          outputTokens,
          costUsd,
        });
        const endedAt = Date.now();
        this.emit({ kind: 'agent.stopped', sessionId: this.sessionId, timestamp: endedAt, reason: 'done' });
        this.persistTurn({
          id: turnId,
          userMessage: effectiveUserMessage,
          assistantMessage: finalText,
          toolCalls: toolCallRecords,
          inputTokens,
          outputTokens,
          costUsd,
          model: selection.resolvedModel,
          taskType: 'council',
          startedAt: turnStartedAt,
          endedAt,
          error: null,
        });
        await this.runPostTurnHooks(
          {
            userMessage: effectiveUserMessage,
            assistantMessage: finalText,
            toolCalls: toolCallRecords.map((t) => ({
              name: t.name,
              ok: t.ok,
              ...(t.result !== undefined ? { result: t.result } : {}),
              ...(t.error !== undefined ? { error: t.error } : {}),
            })),
            inputTokens,
            outputTokens,
            model: selection.resolvedModel,
          },
          tier,
          toolContext,
        );
        // Budget check — if this turn exceeded the cap, surface it.
        this.warnIfOverBudget(costUsd);
        return {
          sessionId: this.sessionId,
          finalText,
          messages: [...messages, ...council.implementerMessages],
        };
      }

      const result = streamText({
        model: selection.model,
        system: systemPrompt,
        messages,
        tools: aiTools,
        maxSteps: this.cfg.maxSteps ?? 8,
        onError: ({ error }) => {
          const detail = describeApiError(error);
          this.log.error({ err: detail }, 'streamText.onError');
          this.emit({ kind: 'error', sessionId: this.sessionId, message: `Model call failed: ${detail}` });
        },
        ...(selection.limits.temperature !== undefined ? { temperature: selection.limits.temperature } : {}),
        ...(selection.limits.maxOutputTokens ? { maxTokens: selection.limits.maxOutputTokens } : {}),
        ...(signal ? { abortSignal: signal } : {}),
      });

      for await (const chunk of result.textStream) {
        finalText += chunk;
        this.emit({ kind: 'message.chunk', sessionId: this.sessionId, text: chunk });
      }

      const usage = await result.usage;
      inputTokens = usage.promptTokens ?? 0;
      outputTokens = usage.completionTokens ?? 0;

      const costUsd = estimateCostUsd(selection.resolvedModel, inputTokens, outputTokens);
      this.emit({ kind: 'message.complete', sessionId: this.sessionId, text: finalText });
      this.emit({
        kind: 'model.call',
        sessionId: this.sessionId,
        taskType: selection.taskType,
        model: selection.resolvedModel,
        inputTokens,
        outputTokens,
        costUsd,
      });

      const responseMessages = (await result.response).messages;
      const endedAt = Date.now();
      this.emit({ kind: 'agent.stopped', sessionId: this.sessionId, timestamp: endedAt, reason: 'done' });

      this.persistTurn({
        id: turnId,
        userMessage,
        assistantMessage: finalText,
        toolCalls: toolCallRecords,
        inputTokens,
        outputTokens,
        costUsd,
        model: selection.resolvedModel,
        taskType: selection.taskType,
        startedAt: turnStartedAt,
        endedAt,
        error: null,
      });

      // Run post-turn skill hooks (memory-summarizer, code-review, etc.).
      // Fire-and-log; these should never block the user's next turn.
      await this.runPostTurnHooks(
        {
          userMessage,
          assistantMessage: finalText,
          toolCalls: toolCallRecords.map((t) => ({
            name: t.name,
            ok: t.ok,
            ...(t.result !== undefined ? { result: t.result } : {}),
            ...(t.error !== undefined ? { error: t.error } : {}),
          })),
          inputTokens,
          outputTokens,
          model: selection.resolvedModel,
        },
        tier,
        toolContext,
      );

      return {
        sessionId: this.sessionId,
        finalText,
        messages: [...messages, ...responseMessages],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const endedAt = Date.now();
      this.emit({ kind: 'error', sessionId: this.sessionId, message: msg });
      this.emit({
        kind: 'agent.stopped',
        sessionId: this.sessionId,
        timestamp: endedAt,
        reason: signal?.aborted ? 'cancelled' : 'error',
      });
      this.persistTurn({
        id: turnId,
        userMessage,
        assistantMessage: finalText || null,
        toolCalls: toolCallRecords,
        inputTokens,
        outputTokens,
        costUsd: null,
        model: selection.resolvedModel,
        taskType: selection.taskType,
        startedAt: turnStartedAt,
        endedAt,
        error: msg,
      });
      throw e;
    }
  }

  private buildSkillContext(tier: number, toolContext: ToolContext): SkillContext | null {
    if (!this.cfg.skills) return null;
    const logger = {
      info: (data: unknown, msg: string) => this.log.info(data, msg),
      warn: (data: unknown, msg: string) => this.log.warn(data, msg),
      error: (data: unknown, msg: string) => this.log.error(data, msg),
    };
    return {
      sessionId: this.sessionId,
      projectRoots: this.cfg.projectRoots,
      registry: this.cfg.registry,
      ...(this.cfg.memory ? { memory: this.cfg.memory } : {}),
      gateway: this.cfg.gateway,
      currentTier: tier as SkillContext['currentTier'],
      toolContext,
      logger,
    };
  }

  private warnIfOverBudget(costUsd: number): void {
    const cap = this.cfg.maxCostPerTurnUsd;
    if (cap && costUsd > cap) {
      this.log.warn({ costUsd, cap }, 'cost.guardrail.exceeded');
      this.emit({
        kind: 'error',
        sessionId: this.sessionId,
        message: `Cost guardrail exceeded: this turn cost $${costUsd.toFixed(4)} (cap $${cap.toFixed(2)}).`,
      });
    }
  }

  private async runPreTurnHooks(
    userMessage: string,
    tier: number,
    toolContext: ToolContext,
  ): Promise<string | null> {
    if (!this.cfg.skills) return null;
    const skillCtx = this.buildSkillContext(tier, toolContext);
    if (!skillCtx) return null;
    const blocks: string[] = [];
    for (const skill of this.cfg.skills.enabled()) {
      if (!skill.onTurnStart) continue;
      try {
        const result = await skill.onTurnStart(skillCtx, userMessage);
        if (result?.promptAddition) blocks.push(result.promptAddition);
      } catch (e) {
        this.log.warn(
          { err: (e as Error).message, skill: skill.manifest.name },
          'skill.preTurn.failed',
        );
      }
    }
    if (blocks.length === 0) return null;
    return blocks.join('\n\n');
  }

  private async runPostTurnHooks(
    summary: TurnSummary,
    tier: number,
    toolContext: ToolContext,
  ): Promise<void> {
    if (!this.cfg.skills) return;
    const skillCtx = this.buildSkillContext(tier, toolContext);
    if (!skillCtx) return;
    for (const skill of this.cfg.skills.enabled()) {
      if (!skill.onTurnEnd) continue;
      try {
        await skill.onTurnEnd(skillCtx, summary);
      } catch (e) {
        this.log.warn(
          { err: (e as Error).message, skill: skill.manifest.name },
          'skill.postTurn.failed',
        );
      }
    }
  }

  /**
   * Compose the memory block for the system prompt.
   * Includes always-loaded files and up to 8 FTS5-retrieved facts.
   * Returns null if no memory store or nothing to inject.
   */
  private buildMemoryBlock(userMessage: string): string | null {
    if (!this.cfg.memory) return null;
    try {
      const always = this.cfg.memory.loadAlwaysLoaded();
      const retrieved = this.cfg.memory.searchFacts(userMessage, 8);

      const sections: string[] = [];
      if (always.claudeMd) sections.push(`### CLAUDE.md\n${always.claudeMd.trim()}`);
      if (always.preferences) sections.push(`### Preferences\n${always.preferences.trim()}`);
      if (always.conventions) sections.push(`### Conventions\n${always.conventions.trim()}`);
      if (always.architecture) sections.push(`### Architecture\n${always.architecture.trim()}`);
      if (retrieved.length > 0) {
        const factLines = retrieved
          .map((f) => `- [${f.kind}] ${f.title}: ${f.body.replace(/\n+/g, ' ').slice(0, 300)}`)
          .join('\n');
        sections.push(`### Retrieved memory (top ${retrieved.length} for this turn)\n${factLines}`);
      }

      if (sections.length === 0) return null;
      return `\n## Retrieved memory\n${sections.join('\n\n')}\n`;
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'memory.block.build.failed');
      return null;
    }
  }

  private persistTurn(t: {
    id: string;
    userMessage: string;
    assistantMessage: string | null;
    toolCalls: unknown[];
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    model: string | null;
    taskType: string | null;
    startedAt: number;
    endedAt: number | null;
    error: string | null;
  }): void {
    if (!this.cfg.memory) return;
    try {
      this.cfg.memory.recordTurn({
        id: t.id,
        sessionId: this.sessionId,
        userMessage: t.userMessage,
        assistantMessage: t.assistantMessage,
        toolCalls: t.toolCalls,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        costUsd: t.costUsd,
        model: t.model,
        taskType: t.taskType,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        error: t.error,
      });
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'memory.persistTurn.failed');
    }
  }
}
