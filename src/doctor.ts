import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './config.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface DoctorCheck { readonly name: string; readonly status: CheckStatus; readonly detail: string }
export interface DoctorReport { readonly ok: boolean; readonly offline: true; readonly checks: readonly DoctorCheck[] }

function nodeCheck(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  return { name: 'node', status: major >= 20 ? 'pass' : 'fail', detail: `Node.js ${process.version}; required >=20` };
}

function commandCheck(command: string, required: boolean): DoctorCheck {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', shell: false });
  const found = result.status === 0;
  return {
    name: command,
    status: found ? 'pass' : required ? 'fail' : 'warn',
    detail: found ? (result.stdout || result.stderr).trim().split(/\r?\n/)[0] ?? 'available' : 'not found (optional)',
  };
}

export async function runDoctor(cwd = process.cwd()): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [nodeCheck(), commandCheck('git', true)];
  try {
    const config = await loadConfig({ cwd });
    checks.push({ name: 'config', status: 'pass', detail: `schema v${config.version}; ${config.staging.allowedHosts.length} exact host(s)` });
    const artifactRoot = path.resolve(cwd, config.artifacts.root);
    await mkdir(artifactRoot, { recursive: true });
    await access(artifactRoot, constants.R_OK | constants.W_OK);
    checks.push({ name: 'artifact-root', status: 'pass', detail: artifactRoot });
  } catch (error) {
    checks.push({ name: 'config/artifact-root', status: 'fail', detail: error instanceof Error ? error.message : String(error) });
  }
  checks.push(commandCheck('ffmpeg', false), commandCheck('docker', false), commandCheck('firebase', false), commandCheck('gh', false));
  return { ok: checks.every((check) => check.status !== 'fail'), offline: true, checks };
}
