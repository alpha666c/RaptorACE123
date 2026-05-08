import { generateText, type CoreMessage } from 'ai';
import type { ModelGateway } from '@agent/model-gateway';
import type { Tier } from '@agent/shared';
import { getLogger, tierName } from '@agent/shared';

const log = getLogger('compaction');

/**
 * Rough char→token ratio for English text + code. Over-estimates a little so we
 * compact slightly earlier than strictly necessary. Cheap and deterministic —
 * calling a tokenizer for this is overkill.
 */
const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(messages: CoreMessage[]): number {
  let total = 0;
  for (const m of messages) {
    const content = m.content;
    if (typeof content === 'string') {
      total += content.length;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if ('text' in part && typeof part.text === 'string') total += part.text.length;
      }
    }
  }
  return Math.ceil(total / CHARS_PER_TOKEN);
}

export interface CompactionPreservedFields {
  activeTask: string;
  currentTier: Tier;
  projectRoots: readonly string[];
  filesTouched: readonly string[];
  openDecisions: readonly string[];
  unresolvedQuestions: readonly string[];
}

export interface CompactionInput {
  priorMessages: CoreMessage[];
  preserved: CompactionPreservedFields;
  gateway: ModelGateway;
  /** How many recent turns to keep verbatim (not compacted). */
  keepLastTurns?: number;
  signal?: AbortSignal;
}

export interface CompactionResult {
  /** The new, shorter message history to feed into the next turn. */
  messages: CoreMessage[];
  /** Human-readable summary of what was dropped. */
  summary: string;
  inputTokens: number;
  outputTokens: number;
  /** Tokens (estimated) before vs after compaction. */
  before: number;
  after: number;
}

/**
 * Compact a message history when it approaches the model's context window.
 * Keeps the last N turns verbatim and summarises everything before them,
 * preserving the fields the plan specified:
 *   - active task
 *   - current permission tier
 *   - project roots
 *   - open decisions
 *   - file paths touched this session
 *   - unresolved questions
 *   - memory-worthy facts (dropped — memory system handles those separately)
 */
export async function compactMessages(input: CompactionInput): Promise<CompactionResult> {
  const keepLast = Math.max(1, input.keepLastTurns ?? 3);
  const messages = input.priorMessages;
  const before = estimateTokens(messages);
  if (messages.length <= keepLast * 2) {
    // Not enough history to bother compacting.
    return {
      messages,
      summary: 'No compaction needed (history too short).',
      inputTokens: 0,
      outputTokens: 0,
      before,
      after: before,
    };
  }

  // Split: old block to summarise, tail to keep verbatim.
  const splitAt = Math.max(0, messages.length - keepLast * 2);
  const toSummarize = messages.slice(0, splitAt);
  const tail = messages.slice(splitAt);

  const summaryPrompt = `Summarize the older portion of an AI-assisted coding conversation, preserving:
- active task: ${input.preserved.activeTask}
- project roots: ${input.preserved.projectRoots.join(', ')}
- current tier: ${input.preserved.currentTier} (${tierName(input.preserved.currentTier)})
- files touched: ${input.preserved.filesTouched.slice(0, 20).join(', ') || '(none)'}
- open decisions: ${input.preserved.openDecisions.join('; ') || '(none)'}
- unresolved questions: ${input.preserved.unresolvedQuestions.join('; ') || '(none)'}

Output as a single terse markdown block titled "## Prior conversation summary" with sub-bullets. Preserve:
- concrete facts the agent learned about the codebase
- decisions and their rationale
- any paths, symbols, or identifiers that were discussed

Drop:
- back-and-forth chatter, acknowledgements, restatements
- raw tool output
- speculation that didn't pan out

No preamble. Under 1500 characters.`;

  const userText = toSummarize
    .map((m) => {
      const role = m.role;
      const content =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .map((p) => (typeof p === 'object' && 'text' in p ? p.text : ''))
                .join(' ')
            : '';
      return `### ${role}\n${String(content).slice(0, 4000)}`;
    })
    .join('\n\n');

  const sel = input.gateway.selectModel('summarize');
  const res = await generateText({
    model: sel.model,
    system: summaryPrompt,
    messages: [{ role: 'user', content: userText }],
    maxTokens: 800,
    ...(sel.limits.temperature !== undefined ? { temperature: sel.limits.temperature } : {}),
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });

  const summary = res.text.trim();
  const compacted: CoreMessage[] = [
    { role: 'user', content: `[Compacted prior conversation]\n\n${summary}` },
    { role: 'assistant', content: 'Understood. Continuing from here.' },
    ...tail,
  ];
  const after = estimateTokens(compacted);

  log.info(
    {
      before,
      after,
      reducedPct: Math.round(((before - after) / Math.max(before, 1)) * 100),
    },
    'compaction.done',
  );

  return {
    messages: compacted,
    summary,
    inputTokens: res.usage?.promptTokens ?? 0,
    outputTokens: res.usage?.completionTokens ?? 0,
    before,
    after,
  };
}

/**
 * Decide whether to compact based on estimated token count vs. a budget.
 * Default: trigger at 80% of the configured budget.
 */
export function shouldCompact(messages: CoreMessage[], budget: number, threshold = 0.8): boolean {
  return estimateTokens(messages) > budget * threshold;
}
