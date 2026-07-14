import { z } from 'zod';

export class TargetDeniedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TargetDeniedError';
  }
}

const allowedHostSchema = z.array(z.string().min(1)).min(1);

export function assertAllowedStagingUrl(input: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TargetDeniedError('Target must be an absolute URL.');
  }
  if (url.protocol !== 'https:') throw new TargetDeniedError('Only HTTPS staging targets are allowed.');
  if (url.username || url.password) throw new TargetDeniedError('URL credentials are forbidden.');
  if (url.port && url.port !== '443') throw new TargetDeniedError('Only the default HTTPS port is allowed.');
  const normalized = new Set(allowedHostSchema.parse(allowedHosts).map((host) => host.toLowerCase()));
  if (!normalized.has(url.hostname.toLowerCase())) {
    throw new TargetDeniedError(`Host is not in the exact staging allowlist: ${url.hostname}`);
  }
  return url;
}
