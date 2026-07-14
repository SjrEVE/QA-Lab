# QA Lab Agent Rules

## Authority and scope

The Founder/Product Owner controls product intent. Technical agents own safe implementation and truthful validation. This repository is independent: do not read, inherit, modify, or copy source/config/secrets from another repository.

Read `docs/QA_LAB_PRODUCT_STRATEGY.md` as the authoritative product strategy, `docs/ROADMAP.md` as the authoritative delivery order, `docs/CAPABILITY_GAP_MAP.md` as capability truth, and `docs/threat-model.md` as the authoritative Phase 0–10 system threat model and future staging security gate. `docs/planning/FUTURE_ARCHITECTURE_DECISIONS.md` is supporting context only and cannot override those documents.

The Phase 0–10 framework is implemented and validated only through local deterministic fixtures. This means local fixture/scripted-brain/synthetic-persona/synthetic-WAV/provider-free replay capability; it does not mean Gia Su AI staging acceptance or production readiness. Real Gia Su AI staging acceptance is **NOT STARTED / NOT READY**. Inspect before editing and keep commits focused.

Separate, explicit tasks and acceptance evidence are required for each of: staging browser/auth/reset execution; real brain, voice, and evaluator providers; native Linux voice routing; and FFmpeg-backed real recording. None may be inferred from deterministic fixture success.

## Hard prohibitions

- Never access or probe production.
- Never use real child data without an approved child-data/privacy policy and explicit task authorization.
- Never bypass the exact-host HTTPS staging allowlist.
- Never commit credentials, tokens, cookies, API keys, `.env`, raw audio, raw images, or recordings.
- Do not execute staging browser/auth/reset, real providers/evaluators, native Linux voice, or FFmpeg real recording unless a separate task explicitly authorizes that capability and its prerequisites.
- Do not add dashboards, auto-fix/repair behavior, deployment, or production capability unless a later task explicitly authorizes it; automated deployment remains forbidden.
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
