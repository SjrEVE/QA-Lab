# QA Lab Status

## Current state

- Current phase: **Phase 2 — Browser Foundation/Guard**.
- Phase 0–1 foundation: **implemented and validated**.
- Phase 2 guarded browser runtime: **implemented and locally fixture-validated**.
- Readiness label: `BROWSER_FOUNDATION_READY`.
- Next roadmap capability: **Web QA / Phase 3**, not implemented by this task.
- Runtime target: Node.js 20+ / strict TypeScript / Playwright Chromium / Windows 10 compatible.

## Authority and evidence

- Product strategy: `docs/QA_LAB_PRODUCT_STRATEGY.md`.
- Delivery order: `docs/ROADMAP.md`.
- Capability/gap truth: `docs/CAPABILITY_GAP_MAP.md`.
- Browser source: `src/browser-policy.ts`, `src/browser-controller.ts`.
- Browser tests: `test/browser-policy.test.ts`, `test/browser-controller.integration.test.ts`.
- Local fixture smoke: `scripts/browser-fixture-smoke.ts`; generated evidence under ignored `runs/phase2-browser-fixture-evidence/`.

## Implemented

- Existing strict configuration, exact-host staging authorization, safe artifacts, redaction, and offline doctor/status foundation.
- Playwright/Chromium persistent context with a dedicated QA profile.
- Browser Controller interface and bounded runtime actions: navigate, screenshot, and wait.
- Login adapter interface without credentials or provider/account implementation.
- Fail-closed staging policy for navigation, redirects, subresources, and WebSocket handshakes using exact allowlisted hosts and HTTPS/WSS.
- Explicit test-only loopback fixture mode requiring HTTP loopback and exact ephemeral port.
- External redirect denial with JSONL evidence.
- Screenshot, console, page error, failed request, denied request, and navigation event capture with recursive redaction.
- Default operation/navigation timeouts and idempotent cleanup; disposable profile removal by default.
- Fixture endpoints `/ok`, `/console-error`, `/network-error`, and `/redirect-external` with unit/integration coverage.

## Validation evidence

- Dependency installed only for this phase: `playwright` with Chromium; `npm audit` reported 0 vulnerabilities at installation.
- Unit/integration suite currently contains 18 passing tests, including guard, redirect, screenshot, console, network failure, profile isolation, and cleanup.
- Fixture screenshot observed at 6,325 bytes with SHA-256 `FAADC433CB88ED104F84CE05DBC49B2ED20D61ECB7FFF43723E8AB1138FA9191`.
- Fixture JSONL observed with `console`, `request-failed`, and external `request-denied` redirect evidence.
- These generated artifacts are ignored by Git and are local execution evidence, not committed fixtures.

## Blocked inputs / truthful limitations

- No approved real staging hostname or authorization is configured; no staging URL was accessed.
- No dedicated test account, credentials, or reset contract exists; the login adapter is interface-only.
- No production target is allowed or accessed.
- Phase 2 local fixture validation is not staging acceptance and not Web QA MVP acceptance.

## Explicitly unavailable

Web QA scenario/report execution, Student QA, recorder/video/audio, voice/microphone, Education Eval, replay/regression, Model Arena, cohorts, safety suite, optimizer, dashboard, deployment, provider execution, autonomous repair, and runtime shell/source/Git access remain unavailable.
