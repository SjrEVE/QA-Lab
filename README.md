# QA Lab

Local-first, policy-guarded QA Controller foundation with a guarded Chromium runtime. Không kiếm được người kiểm thì mình tự kiểm thôi.

## Product authority

The Founder-approved product strategy is [`docs/QA_LAB_PRODUCT_STRATEGY.md`](docs/QA_LAB_PRODUCT_STRATEGY.md). Use [`docs/ROADMAP.md`](docs/ROADMAP.md) for the authoritative delivery order and [`docs/CAPABILITY_GAP_MAP.md`](docs/CAPABILITY_GAP_MAP.md) for implemented/partial/planned/blocked capability truth. [`docs/planning/FUTURE_ARCHITECTURE_DECISIONS.md`](docs/planning/FUTURE_ARCHITECTURE_DECISIONS.md) is supporting context only.

## Scope

This repository implements Phase 0–2: foundation plus a Playwright/Chromium Browser Controller with a dedicated QA profile, exact-host HTTPS request guards, redirect evidence, screenshots, console/failed-network JSONL capture, bounded actions, cleanup/timeouts, and a credential-neutral login adapter interface.

It does **not** access production. No real staging URL/account has been configured or exercised, so this is not staging acceptance. Web QA scenarios/reports, Student QA, voice, microphone, recording, evaluator, dashboard, deployment, model-provider execution, shell access, and source access by the runtime agent remain unavailable.

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
npm.cmd run qa:browser:fixture
```

`qa:doctor` is intentionally offline-friendly. Missing Docker, Firebase CLI, or GitHub CLI produces warnings, not failure. It does not contact staging or production. `qa:browser:fixture` is the only local smoke command: it explicitly enables loopback fixture mode and writes real screenshot/event evidence under `runs/phase2-browser-fixture-evidence/` (ignored by Git). It cannot accept a staging target.

## Configuration

`config/qa-lab.yaml` has schema version `1`. Supported environment overrides:

- `QA_CONFIG_PATH`
- `QA_STAGING_ALLOWED_HOSTS` (comma-separated exact hostnames)
- `QA_ARTIFACT_ROOT`

Unknown YAML keys, unsupported versions, non-staging environments, malformed hosts, and empty allowlists are rejected.

## Security model

Staging navigation, redirects, subresources, and WebSocket handshakes must pass exact normalized hostname equality and HTTPS/WSS checks. URL credentials and non-default ports are denied. Local HTTP is allowed only with explicit fixture mode, loopback host, and the exact ephemeral fixture port. Browser actions are limited to navigate, screenshot, and wait; the Browser Controller exposes no shell, source, Git, or arbitrary filesystem action. Profiles are per-run and removed on idempotent cleanup by default. Browser event payloads are recursively redacted.

See [`docs/threat-model.md`](docs/threat-model.md), [`docs/environment-audit.md`](docs/environment-audit.md), [`AGENTS.md`](AGENTS.md), and [`STATUS.md`](STATUS.md).
