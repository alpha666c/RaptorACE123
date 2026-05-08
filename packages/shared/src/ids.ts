import { randomUUID, createHash } from 'node:crypto';

export function newId(prefix = ''): string {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function hashContent(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}
