const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|credential)/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const ASSIGNMENT = /\b(api[-_]?key|password|secret|token)\s*[:=]\s*([^\s,;]+)/gi;
export const REDACTED = '[REDACTED]';

function redactString(value: string): string {
  return value.replace(BEARER, `Bearer ${REDACTED}`).replace(ASSIGNMENT, (_match, key: string) => `${key}=${REDACTED}`);
}

export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSecrets(item, seen);
  }
  return output;
}
