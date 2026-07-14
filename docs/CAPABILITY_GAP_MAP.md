# QA Lab — Capability and Gap Map

**Audit date:** 14/07/2026

**Authority:** [`QA_LAB_PRODUCT_STRATEGY.md`](QA_LAB_PRODUCT_STRATEGY.md)

## Status semantics

- **Implemented:** source, tests, validation evidence, and current runtime behavior exist.
- **Partial:** a bounded foundation primitive exists, but the end capability does not.
- **Planned:** approved by strategy but not implemented.
- **Blocked:** cannot truthfully proceed without an external prerequisite or a later explicit authorization.

A planning note, interface idea, config flag, tool detected by doctor, or artifact directory primitive is not evidence that a runtime capability exists.

## Foundation Phase 0–1 audit

| Capability | Status | Evidence | Gap / boundary |
|---|---|---|---|
| Independent repository and governance | Implemented | `AGENTS.md`; Git history; Phase 0 audit | Repository is independent; product repositories and production remain out of bounds. |
| Windows runtime audit | Implemented | `docs/environment-audit.md` | Audit is a point-in-time local observation, not proof of staging readiness. |
| Node.js 20+ and strict TypeScript foundation | Implemented | `package.json`; `tsconfig.json`; build/lint commands | No browser or provider runtime follows from this foundation. |
| Typed, schema-versioned YAML config | Implemented | `src/config.ts`; `test/config.test.ts`; `config/qa-lab.yaml` | Current schema covers foundation settings only, not scenario/persona/provider contracts. |
| Fail-closed staging target authorization | Implemented | `src/security.ts`; `src/browser-policy.ts`; security/policy tests | Browser requests apply exact-host HTTPS/WSS policy; loopback HTTP requires explicit fixture mode and exact bound port. No real staging target has been exercised. |
| Safe run ID and artifact primitives | Implemented | `src/run-store.ts`; `test/run-store.test.ts` | Can create run/status files and exclusive artifacts; full run lifecycle, timeline, report, and retention are absent. |
| Structured redacted logging | Implemented | `src/redaction.ts`; `src/logger.ts`; `test/redaction-logger.test.ts` | Foundation redaction exists; future browser/provider artifacts require additional boundary tests. |
| Offline status and doctor CLI | Implemented | `src/cli.ts`; `src/doctor.ts`; package scripts | Doctor intentionally does not contact staging, launch Chromium, validate accounts, audio routing, or recording. |
| Security tests | Implemented | `test/security.test.ts`; negative config/run-store/redaction tests | Future browser/action/filesystem/provider boundaries need their own positive and negative tests. |
| Full scenario orchestration | Planned | Strategy sections 3 and 5 | No scenario engine, selector, executor, reset adapter, or complete lifecycle exists. |
| Deterministic evaluation and final verdict engine | Planned | Strategy sections 9 and 16 | Run status types are storage state, not Education Eval or PASS/FAIL evaluation. |

## Roadmap capability map

| Ordered capability | Status | Current evidence | Missing capability / prerequisite |
|---|---|---|---|
| Foundation | Implemented | Phase 0 audit; typed config; guards; safe artifacts; redaction; offline CLI; tests | Maintain governance and validation as later phases extend boundaries. |
| Browser | Implemented | `src/browser-controller.ts`; `src/browser-policy.ts`; Playwright Chromium; unit/integration tests; ignored fixture evidence | Dedicated profile, bounded Browser Controller actions, navigation/redirect/subresource/WebSocket policy, screenshot, console/failed-network JSONL, login adapter interface, timeout and cleanup exist. Local fixture evidence only; no staging acceptance. |
| Web QA | Implemented | `src/web-scenario.ts`; `src/web-qa.ts`; `scenarios/web/home-smoke.yaml`; Web QA tests and ignored fixture run | Two-viewport deterministic MVP with bounded flows, issues/reports and fixture evidence. Heuristic layout findings require review. No copy AI, accessibility suite, source access, lesson learning, or staging acceptance. |
| Student text QA | Implemented | `src/student-contracts.ts`; `src/student-brain.ts`; `src/student-qa.ts`; one persona/scenario; tests; ignored fixture evidence | Deterministic text-mode MVP has bounded context, browser-only structured actions, reset boundary, eight-turn fixture, artifacts/checks/UX estimates/report. Real staging is BLOCKED without host/account/reset. No provider brain/evaluator or Phase 5+ capability. |
| Recording | Implemented; host video capability blocked | `src/recorder.ts`; recorder tests; Web/Student reports; dedicated recording fixture evidence | Vendor-neutral lifecycle, FFmpeg probe/adapter, optional Playwright video, timestamps JSONL, screenshot fallback, report state/links, disk guard, cleanup, and PASS early-delete retention are implemented. Current Windows host lacks FFmpeg, so video fixture is explicitly `BLOCKED` and no `session.mp4` is claimed. Audio is excluded. |
| Voice | Planned | Strategy only | No voice provider adapter, virtual sink routing, Chromium microphone selection, one-turn test, echo isolation, or voice artifacts. |
| Education Eval | Planned | Deterministic-first policy is documented | No rubric registry, code grader, independent LLM grader, human calibration workflow, confidence model, or evaluation artifact. |
| Replay / Regression | Planned | Safe artifact primitives only | No unified event timeline, deterministic replay, baseline comparison, issue lifecycle/deduplication, incident anonymization, or regression suite. Do not claim replay exists. |
| Model Arena | Planned | Vendor-neutral direction only | No provider adapters, controlled benchmark matrix, cost/latency capture, repeated-seed comparison, or arena report. |
| Synthetic Cohorts | Planned | Cohort model is documented | No persona generator, golden cohort, exploratory seeded cohort, coverage controls, or cohort execution evidence. |
| Safety / Optimizer | Planned | Foundation guards and redaction partially support the future boundary | No child-safety suite, PII/prompt-injection cases, escalation rubric, tool-safety runtime, cost accounting, quality constraint solver, or routing optimizer. |

## Explicit blockers and external prerequisites

These are **blocked inputs**, not implemented capabilities:

- **Approved staging hostname and authorization:** required before any real staging browser execution; current placeholder configuration authorizes no real target. Phase 2 acceptance uses explicit loopback fixture mode only.
- **Dedicated test accounts and reset contract:** required for authenticated Web QA and Student QA; no account or reset integration has been supplied or tested.
- **Product transcript/whiteboard observability contracts:** required for precise Student QA and replay; screenshots may provide estimated evidence but must not be presented as exact event timing.
- **Recording host video capability:** current doctor evidence reports FFmpeg unavailable. The recording fixture therefore emits explicit `BLOCKED` evidence; installing/configuring FFmpeg is required before this host can prove `session.mp4` generation.
- **Voice host readiness:** virtual audio routing, microphone permissions, and echo isolation remain Phase 6 and were not inspected or changed in Phase 5.
- **Provider credentials and data policy:** future model/voice/evaluator integrations require approved secret handling and provider-specific privacy review; no credentials are present or requested now.

## Truthful current conclusion

QA Lab is `RECORDING_MVP_READY`, not staging-accepted. Phase 0–4 provides guarded browser execution, deterministic Web QA, and a browser-only Student text QA MVP proven against a loopback eight-turn lesson fixture. Voice, provider/AI Education Eval, replay/regression, Model Arena, cohorts, and safety/optimization remain future work in authoritative order.
