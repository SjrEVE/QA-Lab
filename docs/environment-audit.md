# QA Lab Runtime Environment Audit

**Phase:** 0

**Audit date:** 2026-07-14 (Asia/Saigon)

**Target:** Local QA Lab workstation only (`C:\qa-lab`)

**Production access:** Not performed and not permitted

## Repository preflight

- `C:\qa-lab` existed and was an empty directory before initialization (`ITEM_COUNT=0`).
- No source tree or `.git` metadata was present.
- A new Git repository was initialized with local branch `main`.
- `origin` is configured as `https://github.com/SjrEVE/QA-Lab.git`.
- Remote history was fetched before local work was committed.
- `origin/main` contained one existing commit: `39c6763c91d4fe291fae3bc7a89b506669b740fc` (`Initial commit`).
- That commit contained only a two-line `README.md`.
- Local `main` was attached to that existing history without force push, history rewrite, or replacement of remote content.

## Host inventory

| Component | Observed value | Phase 1 assessment |
|---|---|---|
| Operating system | Microsoft Windows 10 Pro | Supported local target |
| OS version | `10.0.19045` | Windows 10 22H2 build family |
| OS build | `19045` | Recorded for reproducibility |
| Architecture | 64-bit | Supported |
| Windows PowerShell | `5.1.19041.4412` | Available for local diagnostics |
| Git | `2.55.0.windows.2` | Meets foundation needs |
| Node.js | `v24.15.0` | Passes required Node.js 20+ baseline |
| npm | `11.12.1` | Available through `npm.cmd` |
| Corepack | Present at `C:\Program Files\nodejs\corepack.cmd` | Available but not required by Phase 1 |
| npx | Present at `C:\Program Files\nodejs\npx.cmd` | Available but not required at runtime |
| Docker | Not found | Non-blocking; out of Phase 0–1 scope |
| Firebase CLI | Not found | Non-blocking; deployment is prohibited in this phase |
| GitHub CLI | Not found | Non-blocking; Git HTTPS remote is sufficient |
| Python | Hermes virtual-environment executable found | Not inherited or used by QA Lab |
| Free space on `C:` | Approximately `9.76 GB` at audit time | Adequate for foundation; future recording retention needs a disk guard |

## Windows-specific conclusions

1. Project scripts must work through Node.js and npm without depending on Unix-only shell utilities.
2. Documentation should show Windows-compatible commands (`npm.cmd` where shell ambiguity matters).
3. File and run creation must use Node filesystem APIs, not shell interpolation.
4. Paths must be resolved beneath an explicit local artifact root and checked against traversal.
5. Atomic file creation must prevent accidental overwrite and race-prone run ID reuse.
6. An offline-friendly doctor command must distinguish required local checks from optional network/tool checks.
7. Docker, Firebase CLI, GitHub CLI, browser automation, virtual audio, recording, and deployment are not prerequisites for Phase 1.
8. The discovered Python belongs to an external Hermes virtual environment. QA Lab must not read, import, inherit, or modify that environment.

## Security boundary for the foundation

Phase 0–1 operates locally and must not:

- access production;
- infer or probe production hosts;
- read source, credentials, configuration, or artifacts from another repository;
- execute browser automation, microphone/audio, voice, video recording, dashboards, or deployment;
- accept HTTP staging targets;
- accept HTTPS targets by suffix, substring, wildcard, redirect destination, or arbitrary port when an exact host allowlist is configured;
- write artifacts outside the configured local runs directory;
- log unredacted secrets.

The Phase 1 staging guard is therefore fail-closed: HTTPS is mandatory and the normalized URL hostname must exactly match one configured hostname. URL credentials are forbidden. Production-like hosts remain denied unless explicitly and exactly configured as staging by the operator; placeholder configuration must not authorize a real host.

## Risks and follow-up

- Free disk space is limited enough that future video/trace retention requires quotas and cleanup policy before recording is introduced.
- Optional operational tools are absent, which is acceptable now and should be reported as warnings—not hard failures—by offline doctor checks.
- Node.js is newer than the minimum baseline. The package must declare `>=20` and CI should eventually test an active Node LTS line.
- Remote authentication for push has not yet been proven by this audit; push verification occurs only after both local phase commits pass validation.
- Future browser/model/voice providers remain architectural planning only and must be introduced behind typed policy-controlled adapters in later phases.

## Audit evidence commands

The inventory was obtained locally with read-only commands equivalent to:

```powershell
Get-CimInstance Win32_OperatingSystem
git --version
node --version
npm.cmd --version
Get-Command corepack.cmd,npx.cmd,docker.exe,firebase.cmd,gh.exe,python.exe
Get-PSDrive C
git -C C:\qa-lab show --stat origin/main
git -C C:\qa-lab ls-tree -r --name-only origin/main
```

No production endpoint, browser, microphone, recorder, deployment command, or external project source was accessed during the audit.
