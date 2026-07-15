const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|credential)/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const ASSIGNMENT = /\b(api[-_]?key|password|secret|token)\s*[:=]\s*([^\s,;]+)/gi;
const URL_SECRET_QUERY = /([?&](?:key|api[-_]?key|token|access[-_]?token|authorization|secret)=)[^&#\s"']+/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
export const REDACTED = '[REDACTED]';
export const REDACTED_EMAIL = '[REDACTED_EMAIL]';

function redactString(value: string): string {
  return value
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(URL_SECRET_QUERY, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(ASSIGNMENT, (_match, key: string) => `${key}=${REDACTED}`)
    .replace(EMAIL, REDACTED_EMAIL);
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
