import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type Finding = { file: string; line: number; kind: string };
type Rule = readonly [kind: string, pattern: RegExp];

const allowedPlaceholder = /(?:example|placeholder|dummy|fake|test|fixture|redacted|changeme|your[_-]?(?:key|token|secret)|\.invalid)/i;
const rules: readonly Rule[] = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['assigned secret', /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*["']?([A-Za-z0-9+/_=-]{20,})["']?/gi],
];

export function scanText(text: string, file = '<memory>'): Finding[] {
  const findings: Finding[] = [];
  for (const [kind, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      const line = text.slice(0, match.index).split('\n').length;
      if (!allowedPlaceholder.test(value)) findings.push({ file, line, kind });
    }
  }
  return findings;
}

export function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

export function scanTrackedFiles(files = trackedFiles()): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    let content;
    try { content = readFileSync(file, 'utf8'); } catch { continue; }
    if (content.includes('\0')) continue;
    findings.push(...scanText(content, file));
  }
  return findings;
}

if (process.argv[1] && new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)).replaceAll('/', '\\').toLowerCase() === process.argv[1].replaceAll('/', '\\').toLowerCase()) {
  const findings = scanTrackedFiles();
  if (findings.length) {
    for (const finding of findings) process.stderr.write(`${finding.file}:${finding.line}: potential ${finding.kind}\n`);
    process.stderr.write(`Secret scan failed with ${findings.length} finding(s). Values are intentionally not printed.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Secret scan passed for tracked text files.\n');
  }
}
