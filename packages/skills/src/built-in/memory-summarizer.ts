import { getLogger } from '@agent/shared';
import type { FactInput } from '@agent/memory';
import { SkillManifestSchema } from '../manifest.js';
import { assertNoSecrets, SecretScanError } from '../secret-scanner.js';
import { skillModelCall } from '../helpers.js';
import type { Skill } from '../types.js';

const log = getLogger('skill.memory-summarizer');

const SYSTEM_PROMPT = `You extract durable memory-worthy facts from a user's conversation turn with a coding agent.

Return STRICT JSON matching this schema:
{
  "items": [
    {
      "kind": "preference" | "convention" | "decision" | "fact",
      "title": string (<200 chars),
      "body": string (<500 chars),
      "tags": string[] (0-5 short tags, lowercase-kebab),
      "confidence": number (0..1)
    }
  ]
}

What qualifies:
- User preferences (tooling, style, models)
- Project conventions (naming, patterns, code style)
- Architecture decisions with rationale
- Stable facts that will matter in future sessions (external IDs, invariants)

What does NOT qualify (return [] or omit):
- Raw transcripts or long code snippets
- Ephemeral task details ("currently refactoring X")
- Secrets, tokens, keys, passwords, anything credential-looking
- Unrelated personal data
- Speculative or uncertain claims

Rules:
- If nothing qualifies, return { "items": [] }.
- body MUST be <= 500 characters; strip code >200 chars
- NEVER include secrets. If the turn mentioned one, do not echo it.
- Return only the JSON object. No commentary, no code fences.`;

export const memorySummarizerSkill: Skill = {
  manifest: SkillManifestSchema.parse({
    name: 'memory-summarizer',
    version: '0.1.0',
    description: 'Extracts memory-worthy facts at end of each turn and writes them via the secret-scanner gate.',
    responsibility: 'Auto-save durable facts from conversations into project memory.',
    triggers: [{ type: 'post-turn' }],
    taskType: 'summarize',
    minTier: 0,
  }),

  async onTurnEnd(ctx, summary) {
    if (!ctx.memory) return;
    if (!summary.assistantMessage || summary.assistantMessage.length < 40) return;

    const userInput = JSON.stringify({
      user: summary.userMessage.slice(0, 2000),
      assistant: summary.assistantMessage.slice(0, 4000),
    });

    let jsonText: string;
    try {
      const result = await skillModelCall(ctx, this.manifest, SYSTEM_PROMPT, userInput, {
        maxTokens: 1024,
      });
      jsonText = result.text.trim();
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'memory-summarizer.model.failed');
      return;
    }

    // Strip code-fence wrappers if the model ignored instructions.
    jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed: { items?: Array<Partial<FactInput> & { kind?: string }> };
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      log.warn({ preview: jsonText.slice(0, 200) }, 'memory-summarizer.json.parse.failed');
      return;
    }

    if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) return;

    for (const raw of parsed.items) {
      if (!raw || typeof raw !== 'object') continue;
      const kind = raw.kind;
      const title = typeof raw.title === 'string' ? raw.title.trim() : '';
      const body = typeof raw.body === 'string' ? raw.body.trim() : '';
      const tags = Array.isArray(raw.tags)
        ? raw.tags.filter((t): t is string => typeof t === 'string').slice(0, 5)
        : [];
      const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0.8;

      if (
        !title || !body ||
        !['preference', 'convention', 'decision', 'fact'].includes(kind as string)
      ) {
        continue;
      }

      // HARD SAFETY: refuse to write if secrets are detected. This is the
      // non-negotiable gate — the summarizer model MAY slip, the scanner won't.
      try {
        assertNoSecrets(title, body, tags.join(' '));
      } catch (e) {
        if (e instanceof SecretScanError) {
          log.error(
            { findings: e.findings.map((f) => f.detector) },
            'memory-summarizer.secret.blocked',
          );
          continue;
        }
        throw e;
      }

      try {
        ctx.memory.writeFact({
          kind: kind as FactInput['kind'],
          title,
          body,
          tags,
          confidence: Math.min(Math.max(confidence, 0), 1),
          source: 'summarizer',
        });
        log.info({ kind, title }, 'memory-summarizer.wrote.fact');
      } catch (e) {
        log.warn({ err: (e as Error).message, title }, 'memory-summarizer.write.failed');
      }
    }
  },
};
