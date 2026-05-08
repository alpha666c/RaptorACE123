import { describe, expect, it } from 'vitest';
import { SecretScanError, assertNoSecrets, containsSecrets, scanForSecrets } from '../src/secret-scanner.js';

describe('secret-scanner — detects real-looking credentials', () => {
  it('flags OpenAI API keys', () => {
    const text = 'my key is sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij1234567890';
    expect(containsSecrets(text)).toBe(true);
  });

  it('flags Anthropic API keys', () => {
    const text = 'secret: sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz012345';
    expect(containsSecrets(text)).toBe(true);
  });

  it('flags OpenRouter keys', () => {
    expect(containsSecrets('key=sk-or-v1-abcdef1234567890abcdef1234567890')).toBe(true);
  });

  it('flags GitHub tokens', () => {
    expect(containsSecrets('ghp_AbcdeFghijKlmnoPqrstUvwxyZ1234567890')).toBe(true);
    expect(containsSecrets('ghs_AbcdeFghijKlmnoPqrstUvwxyZ1234567890')).toBe(true);
  });

  it('flags AWS access keys', () => {
    expect(containsSecrets('AKIAIOSFODNN7EXAMPLE')).toBe(true);
  });

  it('flags private keys', () => {
    expect(containsSecrets('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    expect(containsSecrets('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
  });

  it('flags Google API keys', () => {
    expect(containsSecrets('AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe')).toBe(true);
  });

  it('flags JWTs', () => {
    expect(containsSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef')).toBe(true);
  });

  it('flags generic secret= / token= assignments', () => {
    expect(containsSecrets('password = "hunter2hunter2hunter2"')).toBe(true);
    expect(containsSecrets('api_key: "abcd1234efgh5678ijkl"')).toBe(true);
  });
});

describe('secret-scanner — does not flag benign text', () => {
  it('does not flag normal code and prose', () => {
    expect(containsSecrets('User prefers pnpm over npm. Uses 2-space indent.')).toBe(false);
    expect(containsSecrets('export function greet(name: string) { return `Hello, ${name}!` }')).toBe(false);
  });

  it('does not flag short alphanumeric strings', () => {
    expect(containsSecrets('abc123')).toBe(false);
  });
});

describe('assertNoSecrets', () => {
  it('throws SecretScanError on match', () => {
    expect(() => assertNoSecrets('my key is sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz012345')).toThrow(SecretScanError);
  });

  it('does not throw on clean content', () => {
    expect(() => assertNoSecrets('Just a regular preference note.')).not.toThrow();
  });

  it('accepts multiple parts and joins them', () => {
    expect(() => assertNoSecrets('title', 'AKIAIOSFODNN7EXAMPLE')).toThrow(SecretScanError);
  });
});

describe('scanForSecrets — redaction', () => {
  it('redacts the secret in the finding', () => {
    const findings = scanForSecrets('sk-ant-api03-SuperSecretKeyThatShouldBeHidden0000000000000000000000');
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.match).not.toContain('SuperSecret');
      expect(f.match).toContain('…');
    }
  });
});
