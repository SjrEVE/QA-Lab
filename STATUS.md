# QA Lab Status

## Current state

- Current phase: **Phase 3 — Web QA MVP**.
- Phase 0–2 foundation/browser: **implemented and validated**.
- Phase 3 deterministic Web QA: **implemented and locally fixture-validated**.
- Readiness label: `WEB_QA_MVP_READY`.
- Next roadmap capability: **Phase 4 Student text QA**, explicitly not implemented.
- Real staging acceptance: **BLOCKED** pending approved exact host and dedicated test account.

## Phase 3 evidence

- Versioned strict schema/YAML loader: `src/web-scenario.ts`.
- Scenario: `scenarios/web/home-smoke.yaml`.
- Guarded executor, checks, limits, issue/report contracts: `src/web-qa.ts` using `GuardedBrowserController`.
- Viewports: mobile-common 390×844 and laptop 1366×768.
- Deterministic checks: page/flow, primary action visibility/enabled state, console/runtime/network blockers, text overflow and blocking overlap heuristics.
- Heuristic issues include confidence and limitations; they are not pixel-perfect claims.
- Outputs: run/status metadata, summary, issues, metrics, report, screenshots and browser JSONL.
- CLI: `qa:list`; `qa:run -- --scenario home-smoke`; explicit `qa:web:fixture` self-test.
- Local fixture includes home/login/app navigation and CTA plus console, network, overflow and overlap failure routes.
- Test suite: 28 passing tests at Phase 3 validation, including invalid schema/limits, two viewports, serialization/report output, failure capture and complete E2E artifact generation.
- Generated local evidence: ignored `runs/phase3-web-fixture-evidence/`; it is fixture evidence, not staging acceptance.

## Security and truthful boundaries

- Phase 2 exact-host HTTPS/WSS, dedicated profile, request policy, redaction and artifact protections remain in force.
- Fixture mode is explicit and permits only exact-port loopback HTTP.
- Missing staging URL yields `BLOCKED`; it is never reported as PASS and no production target is accessed.
- Runtime is browser-only and has no product source, shell, Git, cloud console or production access.
- Web QA does not learn lessons and contains no StudentBrain/persona, voice/microphone, recording, AI evaluator, dashboard, deployment or autonomous repair.
- No real staging hostname/account/reset contract was provided or exercised.
