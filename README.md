# QA Lab

Local-first, policy-guarded foundation for a future QA Controller. Không kiếm được người kiểm thì mình tự kiểm thôi.

## Scope

This repository currently implements only Phase 0 and Phase 1: Windows runtime audit, strict TypeScript foundation, versioned configuration, staging guardrails, safe local artifacts, redacted structured logs, offline doctor/status CLI, documentation, and tests.

It does **not** access production or provide browser automation, voice, microphone, recording, dashboard, deployment, or model-provider execution.

## Requirements

- Windows 10-compatible environment (cross-platform Node APIs are used)
- Node.js 20+
- npm
- Git

## Setup

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Before any later staging execution is introduced, replace the `.invalid` placeholder with the exact approved staging hostname. Never add a scheme, path, wildcard, production hostname, credentials, or arbitrary port.

## Commands

```powershell
npm.cmd run qa:status
npm.cmd run qa:doctor
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run validate
```

`qa:doctor` is intentionally offline-friendly. Missing Docker, Firebase CLI, or GitHub CLI produces warnings, not failure. It does not contact staging or production.

## Configuration

`config/qa-lab.yaml` has schema version `1`. Supported environment overrides:

- `QA_CONFIG_PATH`
- `QA_STAGING_ALLOWED_HOSTS` (comma-separated exact hostnames)
- `QA_ARTIFACT_ROOT`

Unknown YAML keys, unsupported versions, non-staging environments, malformed hosts, and empty allowlists are rejected.

## Security model

All future targets must pass exact normalized hostname equality and HTTPS checks. URL credentials and non-default ports are denied. Run/artifact names are safe single path segments and writes use exclusive creation. Logger payloads are recursively redacted.

See `docs/threat-model.md`, `docs/environment-audit.md`, `AGENTS.md`, and `STATUS.md`.
