/**
 * Regex-based secret scanner. Hard-reject anything that looks like a credential
 * before it reaches the memory store. False positives are cheap; false negatives
 * (leaking a real key into a markdown file that later gets read into context)
 * are expensive. Err on the side of paranoia.
 */

interface Detector {
  name: string;
  pattern: RegExp;
}

const DETECTORS: Detector[] = [
  { name: 'openai', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'anthropic', pattern: /\bsk-ant-[a-zA-Z0-9_-]{40,}\b/ },
  { name: 'openrouter', pattern: /\bsk-or-v\d+-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'slack-bot-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'aws-secret', pattern: /\baws(?:.{0,20})?(?:secret|key)[^:\n]{0,20}[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i },
  { name: 'google-api', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'stripe', pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/ },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { name: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  // Generic catch-all for "secret=" / "token=" patterns with long high-entropy values.
  { name: 'generic-secret-assignment', pattern: /\b(?:password|passwd|api[_-]?key|secret|token|auth)\s*[:=]\s*['"][A-Za-z0-9_\-./+=]{16,}['"]/i },
];

export interface SecretFinding {
  detector: string;
  match: string;
  index: number;
}

export function scanForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const det of DETECTORS) {
    const re = new RegExp(det.pattern.source, det.pattern.flags.includes('g') ? det.pattern.flags : `${det.pattern.flags}g`);
    for (const m of text.matchAll(re)) {
      findings.push({
        detector: det.name,
        match: redact(m[0] ?? ''),
        index: m.index ?? -1,
      });
    }
  }
  return findings;
}

export function containsSecrets(text: string): boolean {
  for (const det of DETECTORS) {
    if (det.pattern.test(text)) return true;
  }
  return false;
}

/** Never surface the raw match in logs or errors. Keep a short prefix + length. */
function redact(s: string): string {
  if (s.length <= 8) return '[REDACTED]';
  return `${s.slice(0, 4)}…${s.slice(-2)} (len=${s.length})`;
}

export class SecretScanError extends Error {
  constructor(readonly findings: SecretFinding[]) {
    super(
      `Refusing to write memory containing secrets: ${findings
        .map((f) => `${f.detector}(${f.match})`)
        .join(', ')}`,
    );
    this.name = 'SecretScanError';
  }
}

/**
 * Throws `SecretScanError` if the content contains any detected secret.
 * Callers MUST invoke this before persisting any memory fact.
 */
export function assertNoSecrets(...parts: string[]): void {
  const joined = parts.join('\n');
  const findings = scanForSecrets(joined);
  if (findings.length > 0) throw new SecretScanError(findings);
}
