import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const CONFIG_VERSION = 1 as const;

const hostname = z.string().trim().min(1).transform((value) => value.toLowerCase()).refine(
  (value) => !value.includes('://') && !value.includes('/') && !value.includes(':') && value !== 'localhost',
  'must be a bare non-local hostname',
);

export const qaConfigSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  environment: z.literal('staging'),
  staging: z.object({ allowedHosts: z.array(hostname).min(1) }),
  artifacts: z.object({ root: z.string().trim().min(1).default('runs') }),
  logging: z.object({ level: z.enum(['debug', 'info', 'warn', 'error']).default('info') }),
}).strict();

export type QaConfig = z.infer<typeof qaConfigSchema>;

export interface LoadConfigOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly loadEnvFile?: boolean;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<QaConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (options.loadEnvFile !== false) loadDotenv({ path: path.join(cwd, '.env'), quiet: true });
  const env = options.env ?? process.env;
  const configPath = path.resolve(cwd, options.configPath ?? env.QA_CONFIG_PATH ?? 'config/qa-lab.yaml');
  const raw = parseYaml(await readFile(configPath, 'utf8')) as unknown;
  const parsed = qaConfigSchema.parse(raw);
  const envHosts = env.QA_STAGING_ALLOWED_HOSTS?.split(',').map((value) => value.trim()).filter(Boolean);
  const artifactRoot = env.QA_ARTIFACT_ROOT?.trim();
  return qaConfigSchema.parse({
    ...parsed,
    staging: envHosts?.length ? { allowedHosts: envHosts } : parsed.staging,
    artifacts: artifactRoot ? { root: artifactRoot } : parsed.artifacts,
  });
}
