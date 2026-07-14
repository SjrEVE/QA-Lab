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
| Web QA | Planned | Minimal fixture exists only to validate Browser Phase 2 | No web scenario schema, viewport executor, assertions, issue contract, report generator, or Web QA run evidence. Fixture endpoints are not a Web QA scenario. |
| Student text QA | Planned | Strategy and supporting notes only | No persona/scenario schema, StudentBrain adapter, transcript-driven loop, UX diary, turn artifacts, or student report. |
| Recording | Planned | Environment audit records future disk risk | No recorder interface, screenshot timeline, FFmpeg integration, video/audio artifact, timestamp muxing, or retention enforcement. |
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
- **Voice/recording host readiness:** FFmpeg, virtual audio routing, microphone permissions, display capture, disk quota, and retention policy require a later local audit and explicit phase authorization.
- **Provider credentials and data policy:** future model/voice/evaluator integrations require approved secret handling and provider-specific privacy review; no credentials are present or requested now.

## Truthful current conclusion

QA Lab is `BROWSER_FOUNDATION_READY`, not staging-accepted and not MVP-complete. Phase 0–2 establishes local policy/storage primitives and a guarded browser runtime proven against a loopback fixture. Web QA, Student QA, recording, voice, Education Eval, replay/regression, Model Arena, cohorts, and safety/optimization remain future work in the authoritative order.
