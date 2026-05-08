import { generateText, streamText, type CoreMessage } from 'ai';
import type { ModelGateway } from '@agent/model-gateway';
import { getLogger } from '@agent/shared';
import type { Tool } from 'ai';
import {
  ARCHITECT_PROMPT,
  REVIEWER_PROMPT,
  SAFETY_PROMPT,
  SYNTHESIS_PROMPT,
  UI_CRITIC_PROMPT,
} from './prompts.js';

const log = getLogger('council');

export interface CouncilInput {
  userMessage: string;
  systemPromptCommon: string;
  gateway: ModelGateway;
  tools: Record<string, Tool>;
  maxSteps: number;
  temperature: number | undefined;
  maxOutputTokens: number | undefined;
  onStreamChunk: (text: string) => void;
  onRoleUpdate: (role: CouncilRole, text: string) => void;
  signal?: AbortSignal;
}

export interface CouncilResult {
  finalText: string;
  architectPlan: string;
  safetyVerdict: string;
  reviewerFindings: string;
  uiFindings: string;
  implementerMessages: CoreMessage[];
  inputTokensTotal: number;
  outputTokensTotal: number;
}

export type CouncilRole =
  | 'architect'
  | 'safety'
  | 'implementer'
  | 'reviewer'
  | 'ui-critic'
  | 'synthesizer';

/**
 * Run the user's turn through the council pipeline.
 *
 *   architect → safety → implementer (with tools) → reviewer → [ui-critic] → synthesis
 *
 * Only the implementer gets tool access. Other passes are read-only model calls
 * that produce short outputs (plan / verdict / findings) so the total cost
 * stays bounded.
 */
export async function runCouncil(input: CouncilInput): Promise<CouncilResult> {
  let inputTokensTotal = 0;
  let outputTokensTotal = 0;

  // 1. Architect produces a plan (no tools).
  const architect = await nonStreamingCall({
    gateway: input.gateway,
    taskType: 'council.architect',
    system: ARCHITECT_PROMPT,
    user: input.userMessage,
    maxTokens: 1200,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  inputTokensTotal += architect.inputTokens;
  outputTokensTotal += architect.outputTokens;
  input.onRoleUpdate('architect', architect.text);
  log.info({ tokens: architect.outputTokens }, 'council.architect.done');

  // 2. Safety review of the plan (no tools).
  const safety = await nonStreamingCall({
    gateway: input.gateway,
    taskType: 'council.safety',
    system: SAFETY_PROMPT,
    user: `## User request\n${input.userMessage}\n\n## Architect's plan\n${architect.text}`,
    maxTokens: 200,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  inputTokensTotal += safety.inputTokens;
  outputTokensTotal += safety.outputTokens;
  input.onRoleUpdate('safety', safety.text);
  const verdict = safety.text.trim().split('\n')[0] ?? '';
  if (verdict.startsWith('BLOCK:')) {
    const finalText = `Council BLOCKED.\n\n${verdict}\n\nArchitect's plan:\n${architect.text}`;
    input.onStreamChunk(finalText);
    return {
      finalText,
      architectPlan: architect.text,
      safetyVerdict: safety.text,
      reviewerFindings: '',
      uiFindings: '',
      implementerMessages: [],
      inputTokensTotal,
      outputTokensTotal,
    };
  }

  // 3. Implementer with full tool access — this is the only role that can edit.
  const implementerSystem = `${input.systemPromptCommon}

## Council — Architect's plan (follow this)
${architect.text}

## Council — Safety notes
${safety.text}

## Your role
You are the Implementer. Execute the plan above using your available tools.
Make minimal, reversible changes. Stop after executing the plan — do NOT
expand scope. The Reviewer will inspect your changes afterwards.`;

  const impl = streamText({
    model: input.gateway.selectModel('council.implementer').model,
    system: implementerSystem,
    messages: [{ role: 'user', content: input.userMessage }],
    tools: input.tools,
    maxSteps: input.maxSteps,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.maxOutputTokens ? { maxTokens: input.maxOutputTokens } : {}),
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });

  let implementerText = '';
  for await (const chunk of impl.textStream) {
    implementerText += chunk;
    input.onStreamChunk(chunk);
  }
  const implUsage = await impl.usage;
  inputTokensTotal += implUsage.promptTokens ?? 0;
  outputTokensTotal += implUsage.completionTokens ?? 0;
  const implementerMessages = (await impl.response).messages;
  input.onRoleUpdate('implementer', implementerText);

  // 4. Reviewer (read-only). Sees the implementer's output and reads files.
  const reviewer = await nonStreamingCall({
    gateway: input.gateway,
    taskType: 'council.reviewer',
    system: REVIEWER_PROMPT,
    user: `## Plan\n${architect.text}\n\n## Implementer's response\n${implementerText.slice(0, 6000)}`,
    maxTokens: 500,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  inputTokensTotal += reviewer.inputTokens;
  outputTokensTotal += reviewer.outputTokens;
  input.onRoleUpdate('reviewer', reviewer.text);

  // 5. UI critic (conditional). Short-circuits with "SKIP" if no UI.
  const uiCritic = await nonStreamingCall({
    gateway: input.gateway,
    taskType: 'council.critic',
    system: UI_CRITIC_PROMPT,
    user: `## Plan\n${architect.text}\n\n## Implementer's response\n${implementerText.slice(0, 4000)}`,
    maxTokens: 300,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  inputTokensTotal += uiCritic.inputTokens;
  outputTokensTotal += uiCritic.outputTokens;
  const uiText = uiCritic.text.trim();
  if (uiText !== 'SKIP') input.onRoleUpdate('ui-critic', uiText);

  // 6. Synthesis. Produce the final user-facing summary.
  const synth = await nonStreamingCall({
    gateway: input.gateway,
    taskType: 'council.safety', // reuse fast-cheap — synthesis is mechanical
    system: SYNTHESIS_PROMPT,
    user: [
      `## User request\n${input.userMessage}`,
      `## Plan\n${architect.text}`,
      `## Safety\n${safety.text}`,
      `## Implementer\n${implementerText.slice(0, 4000)}`,
      `## Reviewer\n${reviewer.text}`,
      uiText !== 'SKIP' ? `## UI critic\n${uiText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    maxTokens: 600,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  inputTokensTotal += synth.inputTokens;
  outputTokensTotal += synth.outputTokens;

  // Append the synthesis after the implementer's streamed output.
  const appendix = `\n\n---\n${synth.text}`;
  input.onStreamChunk(appendix);

  return {
    finalText: implementerText + appendix,
    architectPlan: architect.text,
    safetyVerdict: safety.text,
    reviewerFindings: reviewer.text,
    uiFindings: uiText === 'SKIP' ? '' : uiText,
    implementerMessages,
    inputTokensTotal,
    outputTokensTotal,
  };
}

async function nonStreamingCall(opts: {
  gateway: ModelGateway;
  taskType: string;
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const sel = opts.gateway.selectModel(opts.taskType);
  const res = await generateText({
    model: sel.model,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    ...(sel.limits.temperature !== undefined ? { temperature: sel.limits.temperature } : {}),
    ...(opts.signal ? { abortSignal: opts.signal } : {}),
  });
  return {
    text: res.text,
    inputTokens: res.usage?.promptTokens ?? 0,
    outputTokens: res.usage?.completionTokens ?? 0,
  };
}

/**
 * Heuristic gate for auto-triggering council mode on complex tasks.
 * The user can also force it with a `/council` prefix (stripped by the caller).
 */
export function shouldAutoCouncil(userMessage: string, options: { force?: boolean } = {}): boolean {
  if (options.force) return true;
  if (userMessage.length > 600 * 4) return true; // rough char-to-token estimate
  const keywords =
    /\b(architecture|migration|refactor the whole|refactor this (?:entire|whole)|redesign|trade[- ]off|design decision|overhaul)\b/i;
  return keywords.test(userMessage);
}

/** Strip a leading `/council` directive and return { stripped, forced }. */
export function parseCouncilDirective(userMessage: string): { stripped: string; forced: boolean } {
  const m = /^\s*\/council\b\s*(.*)$/is.exec(userMessage);
  if (!m) return { stripped: userMessage, forced: false };
  return { stripped: (m[1] ?? '').trim() || userMessage, forced: true };
}
