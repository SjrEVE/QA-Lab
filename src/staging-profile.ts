import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { QaConfig } from './config.js';
import { assertAllowedStagingUrl } from './security.js';

export const STAGING_PROFILE_VERSION = 1 as const;
export const PRIVATE_ROOT = '.qa-private' as const;

const safeId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);
const routePath = z.string().trim().min(1).max(256).refine(
  (value) => value.startsWith('/') && !value.startsWith('//'),
  'must be an absolute application path',
);
const selector = z.string().trim().min(1).max(512);
const bareHost = z.string().trim().min(1).transform((value) => value.toLowerCase()).refine(
  (value) => !value.includes('://') && !value.includes('/') && !value.includes(':') && value !== 'localhost',
  'must be a bare non-local hostname',
);

function isPrivateRelativePath(value: string): boolean {
  if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  return parts[0] === PRIVATE_ROOT && parts.length > 1 && parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

const privateRelativePath = z.string().trim().max(512).refine(
  isPrivateRelativePath,
  `must be a relative child path beneath ${PRIVATE_ROOT}/`,
);

export const stagingProfileSchema = z.object({
  version: z.literal(STAGING_PROFILE_VERSION),
  id: safeId,
  name: z.string().trim().min(1).max(120),
  target: z.object({
    expectedHost: bareHost,
    loginPath: routePath,
    authenticatedPath: routePath,
  }).strict(),
  privatePaths: z.object({
    browserProfileDirectory: privateRelativePath,
    authStatePath: privateRelativePath,
    resetConfigPath: privateRelativePath,
  }).strict(),
  auth: z.object({
    authenticatedSelector: selector,
    accountIdentitySelector: selector,
    accountIdentitySource: z.enum(['textContent', 'value', 'data-email']).default('textContent'),
    allowedHosts: z.array(bareHost).max(20).default([]),
    bootstrapTimeoutMs: z.number().int().min(30_000).max(900_000),
  }).strict(),
  suites: z.object({
    publicWebScenarioIds: z.array(safeId).max(20).default([]),
    authenticatedWebScenarioIds: z.array(safeId).max(20).default([]),
    journeyIds: z.array(safeId).max(20).default([]),
  }).strict(),
}).strict();

export type StagingProfile = z.infer<typeof stagingProfileSchema>;

export interface LoadStagingProfileOptions {
  readonly config: QaConfig;
  readonly cwd?: string;
  readonly profilePath?: string;
  readonly env?: NodeJS.ProcessEnv;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function resolvePrivatePath(cwd: string, relativePath: string): string {
  if (!isPrivateRelativePath(relativePath)) throw new Error(`Private path must remain beneath ${PRIVATE_ROOT}/.`);
  const root = path.resolve(cwd, PRIVATE_ROOT);
  const target = path.resolve(cwd, relativePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Private path escaped ${PRIVATE_ROOT}/.`);
  }
  return target;
}

export async function assertPrivatePath(cwd: string, relativePath: string): Promise<string> {
  const root = path.resolve(cwd, PRIVATE_ROOT);
  const target = resolvePrivatePath(cwd, relativePath);
  const relative = path.relative(root, target);
  let current = root;
  for (const component of ['', ...relative.split(path.sep)]) {
    if (component) current = path.join(current, component);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error(`Private path contains a symbolic link or reparse point: ${current}`);
    } catch (error) {
      if (isMissing(error)) break;
      throw error;
    }
  }
  return target;
}

export async function loadStagingProfile(options: LoadStagingProfileOptions): Promise<StagingProfile> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const profilePath = path.resolve(cwd, options.profilePath ?? options.env?.QA_STAGING_PROFILE_PATH ?? 'config/staging-profile.yaml');
  const profile = stagingProfileSchema.parse(parseYaml(await readFile(profilePath, 'utf8')) as unknown);
  const baseUrl = options.config.staging.baseUrl;
  if (!baseUrl) throw new Error('Typed staging configuration is missing staging.baseUrl.');
  const target = assertAllowedStagingUrl(baseUrl, options.config.staging.allowedHosts);
  if (target.hostname.toLowerCase() !== profile.target.expectedHost) {
    throw new Error('Staging profile host does not match the exact typed staging target.');
  }
  await Promise.all(Object.values(profile.privatePaths).map((privatePath) => assertPrivatePath(cwd, privatePath)));
  return profile;
}
