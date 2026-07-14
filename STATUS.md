# QA Lab Status

## Current state

- Current phase: **Phase 0–1 — Foundation**.
- Phase 0 environment audit: **implemented and validated**.
- Phase 1 local foundation: **implemented and validated**.
- Readiness label: `FOUNDATION_READY`.
- Next roadmap capability: **Browser / Phase 2**, planned and not authorized by this docs-only task.
- Runtime target: Node.js 20+ / strict TypeScript / Windows 10 compatible.

## Authority and evidence

- Product strategy: `docs/QA_LAB_PRODUCT_STRATEGY.md`.
- Delivery order: `docs/ROADMAP.md`.
- Capability/gap truth: `docs/CAPABILITY_GAP_MAP.md`.
- Supporting notes only: `docs/planning/FUTURE_ARCHITECTURE_DECISIONS.md`.

## Implemented

- Independent repository governance and local environment audit.
- Typed, strict, schema-versioned YAML configuration with environment overrides.
- Exact-host HTTPS staging URL authorization primitive.
- Safe run IDs, run/status directories, and exclusive artifact creation.
- Recursive secret redaction and structured JSON logger.
- Offline-friendly `status` and `doctor` CLI commands.
- Unit and negative security tests for current foundation boundaries.

## Partial

- Run/artifact primitives exist, but complete run orchestration, event timeline, evaluation, reporting, retention, and replay do not.
- URL authorization exists, but browser-level navigation/redirect enforcement does not because no browser driver exists.
- Foundation security/redaction supports later work, but later browser/provider/voice boundaries have not been implemented or tested.

## Planned in authoritative order

1. Browser.
2. Web QA.
3. Student text.
4. Recording.
5. Voice.
6. Education Eval.
7. Replay / Regression.
8. Model Arena.
9. Cohorts.
10. Safety / Optimizer.

## Blocked inputs for later phases

- No approved real staging hostname or authorization was used by this task.
- No dedicated Web QA/Student QA accounts or reset contract are available in this repository.
- No transcript or whiteboard observability integration contract has been validated.
- Voice/recording host readiness, privacy, disk quota, and retention policy require later explicit work.
- No model, voice, or evaluator provider credentials/configuration are present.

## Explicitly unavailable

Production access, browser automation, guarded browser profile, screenshot/console/network capture, Web QA scenarios, Student QA, voice/microphone, recording, Education Eval, unified timeline, replay/regression, Model Arena, cohorts, safety suite, optimizer, dashboard, deployment, model-provider execution, autonomous repair, and external-repository integration.

## Validation record

The final validation evidence for this documentation alignment is recorded in the commit/report for the task. Repository governance requires lint, tests, build, status, doctor, and working-tree inspection even though source code is unchanged.
