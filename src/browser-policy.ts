import { isIP } from 'node:net';
import { assertAllowedStagingUrl, TargetDeniedError } from './security.js';

export type BrowserResourceKind = 'navigation' | 'redirect' | 'subresource' | 'websocket';

export interface BrowserTargetPolicy {
  readonly allowedHosts: readonly string[];
  readonly deniedHosts?: readonly string[];
  readonly fixtureMode?: boolean;
  readonly fixturePort?: number;
}

export interface BrowserPolicyDecision {
  readonly allowed: boolean;
  readonly kind: BrowserResourceKind;
  readonly url: string;
  readonly reason: string;
}

function isLoopback(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  const normalized = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (isIP(normalized) === 4) return normalized.startsWith('127.');
  return normalized === '::1';
}

export function assertAllowedBrowserUrl(input: string, policy: BrowserTargetPolicy): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TargetDeniedError('Browser target must be an absolute URL.');
  }

  const deniedHosts = new Set((policy.deniedHosts ?? []).map((host) => host.trim().toLowerCase()));
  if (deniedHosts.has(url.hostname.toLowerCase())) {
    throw new TargetDeniedError(`Host is explicitly denied for this browser run: ${url.hostname}`);
  }

  if (policy.fixtureMode === true) {
    if (url.protocol !== 'http:') throw new TargetDeniedError('Fixture mode permits only loopback HTTP.');
    if (url.username || url.password) throw new TargetDeniedError('URL credentials are forbidden.');
    if (!isLoopback(url.hostname)) throw new TargetDeniedError('Fixture mode permits only loopback hosts.');
    if (policy.fixturePort === undefined || url.port !== String(policy.fixturePort)) {
      throw new TargetDeniedError('Fixture target must use the bound fixture port.');
    }
    return url;
  }

  if (url.protocol === 'wss:') {
    const httpsEquivalent = new URL(url.href);
    httpsEquivalent.protocol = 'https:';
    return assertAllowedStagingUrl(httpsEquivalent.href, policy.allowedHosts);
  }
  return assertAllowedStagingUrl(input, policy.allowedHosts);
}

export function decideBrowserRequest(
  input: string,
  kind: BrowserResourceKind,
  policy: BrowserTargetPolicy,
): BrowserPolicyDecision {
  try {
    assertAllowedBrowserUrl(input, policy);
    return { allowed: true, kind, url: input, reason: 'allowed' };
  } catch (error) {
    return {
      allowed: false,
      kind,
      url: input,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
