# QA Lab Status

## Current state

- Phase 0: environment audit complete.
- Phase 1: local foundation implemented.
- Readiness label: `FOUNDATION_READY` after validation.
- Runtime target: Node.js 20+ / TypeScript / Windows 10 compatible.

## Available

- Typed, strict, versioned YAML configuration with environment overrides.
- Exact-host HTTPS staging URL authorization.
- Safe run IDs, statuses, directories, and exclusive artifact creation.
- Recursive secret redaction and structured JSON logger.
- Offline-friendly `status` and `doctor` CLI commands.
- Unit and negative security tests.

## Explicitly unavailable

Production access, browser automation, voice/microphone, recording, dashboard, deployment, model-provider adapters, autonomous repair, and external-repository integration.

Future architecture decisions are preserved in `docs/planning/FUTURE_ARCHITECTURE_DECISIONS.md`; they are not current runtime capabilities.
