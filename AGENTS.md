# QA Lab Agent Rules

## Authority and scope

The Founder/Product Owner controls product intent. Technical agents own safe implementation and truthful validation. This repository is independent: do not read, inherit, modify, or copy source/config/secrets from another repository.

Current approved scope is Phase 0–1 foundation only. Inspect before editing and keep commits focused.

## Hard prohibitions

- Never access or probe production.
- Never bypass the exact-host HTTPS staging allowlist.
- Never commit credentials, tokens, cookies, API keys, `.env`, raw audio, raw images, or recordings.
- Do not add browser automation, voice, microphone, recording, dashboards, deployment, provider SDKs, or repair agents unless a later task explicitly authorizes them.
- Do not grant models shell, filesystem editing, Git, deployment, Firebase, arbitrary navigation, or unknown-domain access.
- Do not force push or rewrite shared history.

## Engineering rules

- Node.js baseline is 20+ and TypeScript must remain strict.
- Configuration is typed, schema-versioned, and fail-closed.
- Runtime targets require HTTPS, no URL credentials, default HTTPS port, and exact normalized hostname membership.
- All run IDs/path segments must be validated. Create run directories and artifacts without overwrite.
- Structured logs must recursively redact sensitive keys and secret-like strings.
- Doctor checks must remain offline-friendly; optional missing tools are warnings.
- Add positive and negative tests for every security boundary.
- Prefer deterministic checks before AI judgment in future phases.

## Required validation

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run qa:status
npm.cmd run qa:doctor
git status --short
```

Commit only verified, scoped changes and report hashes plus an understood working tree.
