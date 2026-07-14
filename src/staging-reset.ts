import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { loadAuthVerification } from './auth-bootstrap.js';
import { loadConfig, type QaConfig } from './config.js';
import { assertAllowedStagingUrl } from './security.js';
import { assertPrivatePath, loadStagingProfile, type StagingProfile } from './staging-profile.js';

const identityHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const scopeSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/);
const envNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/);
const commonResetConfig = {
  version: z.literal(1),
  expectedAccountIdentityHash: identityHashSchema,
  allowedScopes: z.array(scopeSchema).min(1).max(50),
};

const manualResetConfigSchema = z.object({
  ...commonResetConfig,
  mode: z.literal('manual'),
  confirmationEnv: envNameSchema.default('QA_MANUAL_RESET_CONFIRMED'),
}).strict();

const httpResetConfigSchema = z.object({
  ...commonResetConfig,
  mode: z.literal('http'),
  url: z.string().trim().url(),
  tokenEnv: envNameSchema.default('QA_RESET_TOKEN'),
  timeoutMs: z.number().int().min(1_000).max(30_000).default(10_000),
}).strict();

export const stagingResetConfigSchema = z.discriminatedUnion('mode', [manualResetConfigSchema, httpResetConfigSchema]);
export type StagingResetConfig = z.infer<typeof stagingResetConfigSchema>;

const resetResponseSchema = z.object({
  ok: z.literal(true),
  accountIdentityHash: identityHashSchema,
  scope: scopeSchema,
  resetVersion: z.string().trim().regex(/^[A-Za-z0-9._-]{1,64}$/),
  resetAt: z.string().datetime({ offset: true }),
}).strict();

export interface StagingResetRequest {
  readonly accountIdentityHash: string;
  readonly scope: string;
}

export interface StagingResetResult {
  readonly status: 'READY' | 'BLOCKED';
  readonly reason: string;
  readonly accountIdentityHash?: string;
  readonly scope?: string;
  readonly resetVersion?: string;
  readonly resetAt?: string;
}

export type ResetHttpClient = (url: string, init: RequestInit) => Promise<Response>;

export interface StagingResetAdapterOptions {
  readonly config: QaConfig;
  readonly resetConfig: StagingResetConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly httpClient?: ResetHttpClient;
}

export interface ConfiguredStagingResetOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly loadEnvFile?: boolean;
  readonly httpClient?: ResetHttpClient;
}

function blocked(reason: string): StagingResetResult {
  return { status: 'BLOCKED', reason };
}

function idempotencyKey(request: StagingResetRequest): string {
  return createHash('sha256')
    .update(`tutorproof-reset-v1\0${request.accountIdentityHash}\0${request.scope}`)
    .digest('hex');
}

async function boundedResponseText(response: Response, maxBytes = 64 * 1024): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let value = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new Error('Reset response exceeded the maximum size.');
      value += decoder.decode(chunk.value, { stream: true });
    }
    return value + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export class StrictStagingResetAdapter {
  readonly #options: StagingResetAdapterOptions;

  public constructor(options: StagingResetAdapterOptions) {
    this.#options = options;
  }

  public async reset(requestInput: StagingResetRequest): Promise<StagingResetResult> {
    let request: StagingResetRequest;
    try {
      request = z.object({ accountIdentityHash: identityHashSchema, scope: scopeSchema }).strict().parse(requestInput);
    } catch {
      return blocked('Reset request identity or scope is invalid.');
    }
    const resetConfig = this.#options.resetConfig;
    if (request.accountIdentityHash !== resetConfig.expectedAccountIdentityHash) {
      return blocked('Reset request account does not match the verified staging account.');
    }
    if (!resetConfig.allowedScopes.includes(request.scope)) return blocked('Reset scope is not allowlisted.');
    const env = this.#options.env ?? process.env;

    if (resetConfig.mode === 'manual') {
      if (env[resetConfig.confirmationEnv] !== 'true') {
        return blocked(`Manual reset requires literal ${resetConfig.confirmationEnv}=true confirmation.`);
      }
      return {
        status: 'READY',
        reason: 'Operator confirmed the scoped manual staging reset.',
        accountIdentityHash: request.accountIdentityHash,
        scope: request.scope,
      };
    }

    try {
      assertAllowedStagingUrl(resetConfig.url, this.#options.config.staging.allowedHosts);
    } catch {
      return blocked('Reset endpoint failed the exact HTTPS staging-host policy.');
    }
    const token = env[resetConfig.tokenEnv]?.trim();
    if (!token) return blocked(`Reset authorization is missing from ${resetConfig.tokenEnv}.`);
    const key = idempotencyKey(request);
    let response: Response;
    try {
      response = await (this.#options.httpClient ?? fetch)(resetConfig.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          accountIdentityHash: request.accountIdentityHash,
          scope: request.scope,
          idempotencyKey: key,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(resetConfig.timeoutMs),
      });
    } catch {
      return blocked('Reset endpoint request failed safely.');
    }
    if (!response.ok) return blocked('Reset endpoint returned a non-success status.');
    const mediaType = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return blocked('Reset endpoint did not return strict JSON.');
    }

    let parsed: z.infer<typeof resetResponseSchema>;
    try {
      parsed = resetResponseSchema.parse(JSON.parse(await boundedResponseText(response)) as unknown);
    } catch {
      return blocked('Reset endpoint JSON failed the strict response contract.');
    }
    if (parsed.accountIdentityHash !== request.accountIdentityHash) {
      return blocked('Reset response account does not match the verified staging account.');
    }
    if (parsed.scope !== request.scope) return blocked('Reset response scope does not match the requested scenario.');
    return {
      status: 'READY',
      reason: 'Strict staging reset contract completed.',
      accountIdentityHash: parsed.accountIdentityHash,
      scope: parsed.scope,
      resetVersion: parsed.resetVersion,
      resetAt: parsed.resetAt,
    };
  }
}

export async function loadStagingResetConfig(cwd: string, profile: StagingProfile): Promise<StagingResetConfig> {
  const filename = await assertPrivatePath(cwd, profile.privatePaths.resetConfigPath);
  return stagingResetConfigSchema.parse(parseYaml(await readFile(filename, 'utf8')) as unknown);
}

export async function runConfiguredStagingReset(
  scope: string,
  options: ConfiguredStagingResetOptions = {},
): Promise<StagingResetResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  try {
    const config = await loadConfig({
      cwd,
      env,
      ...(options.loadEnvFile === undefined ? {} : { loadEnvFile: options.loadEnvFile }),
    });
    const profile = await loadStagingProfile({ config, cwd, env });
    const resetConfig = await loadStagingResetConfig(cwd, profile);
    const verification = await loadAuthVerification(cwd, profile);
    if (verification.profileId !== profile.id || verification.identityHash !== resetConfig.expectedAccountIdentityHash) {
      return blocked('Reset config does not match the verified staging profile identity.');
    }
    return new StrictStagingResetAdapter({
      config,
      resetConfig,
      env,
      ...(options.httpClient ? { httpClient: options.httpClient } : {}),
    }).reset({ accountIdentityHash: verification.identityHash, scope });
  } catch {
    return blocked('Reset configuration or verified staging identity is missing, malformed, or unsafe.');
  }
}
