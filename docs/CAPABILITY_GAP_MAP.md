# QA Lab — Capability and Gap Map

**Audit date:** 14/07/2026

**Authority:** [`QA_LAB_PRODUCT_STRATEGY.md`](QA_LAB_PRODUCT_STRATEGY.md)

## Status semantics

- **Implemented:** source, tests, validation evidence, and current runtime behavior exist.
- **Partial:** a bounded foundation primitive exists, but the end capability does not.
- **Planned:** approved by strategy but not implemented.
- **Blocked:** cannot truthfully proceed without an external prerequisite or a later explicit authorization.

A planning note, interface idea, config flag, tool detected by doctor, or artifact directory primitive is not evidence that a runtime capability exists.

For authenticated staging expansion, status is reported with four independent booleans: `implemented`, `locallyTested`, `stagingValidated`, and `accepted`. Only the public staging smoke currently has `stagingValidated: true`; this does not imply acceptance of authenticated Gia Su AI staging.

| Staging capability | implemented | locallyTested | stagingValidated | accepted | Evidence / boundary |
|---|---:|---:|---:|---:|---|
| Public Web smoke | true | true | true | false | Run `20260714T182700Z-7e03242c` passed 16/16 public checks; authenticated product acceptance is separate. |
| Typed authenticated staging profile | true | true | false | false | Strict versioned schema, exact typed target match, `.qa-private/` containment, and negative tests; no credential or authenticated run. |
| Verified Firebase auth bootstrap | true | true | false | false | Headed manual login uses a dedicated persistent Chromium profile, hashes account identity, and must prove the session in a fresh browser process; no staging account has been supplied or validated. |
| Local Control Center | true | true | false | false | Loopback-only UI uses a random token, exact Host/Origin checks, fixed action allowlist, bounded bodies, and non-active HTML artifact delivery; no authenticated staging action has passed. |
| Authenticated dashboard/catalog | false | false | false | false | Not implemented or run. |
| Strict reset contract | false | false | false | false | Not implemented or run. |
| Scripted authenticated lesson journey | false | false | false | false | Not implemented or run. |

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
| Offline status and doctor CLI | Implemented | `src/cli.ts`; `src/doctor.ts`; package scripts | Doctor does not contact staging or launch Chromium; it now performs a read-only local voice routing capability probe. |
| Security tests | Implemented | `test/security.test.ts`; negative config/run-store/redaction tests | Future browser/action/filesystem/provider boundaries need their own positive and negative tests. |
| Full scenario orchestration | Planned | Strategy sections 3 and 5 | No scenario engine, selector, executor, reset adapter, or complete lifecycle exists. |
| Deterministic evaluation and final verdict engine | Planned | Strategy sections 9 and 16 | Run status types are storage state, not Education Eval or PASS/FAIL evaluation. |

## Roadmap capability map

| Ordered capability | Status | Current evidence | Missing capability / prerequisite |
|---|---|---|---|
| Foundation | Implemented | Phase 0 audit; typed config; guards; safe artifacts; redaction; offline CLI; tests | Maintain governance and validation as later phases extend boundaries. |
| Browser | Implemented | `src/browser-controller.ts`; `src/browser-policy.ts`; Playwright Chromium; unit/integration tests; ignored fixture evidence | Dedicated profile, bounded Browser Controller actions, navigation/redirect/subresource/WebSocket policy, screenshot, console/failed-network JSONL, login adapter interface, timeout and cleanup exist. Local fixture evidence only; no staging acceptance. |
| Web QA | Implemented; public staging smoke validated | `src/web-scenario.ts`; `src/web-qa.ts`; fixture `scenarios/web/home-smoke.yaml`; product-specific `scenarios/web/gia-su-ai-public-smoke.yaml`; Web QA tests; staging run `20260714T182700Z-7e03242c` | Two-viewport bounded public flow passed landing → login UI and unauthenticated `/app` + `/app/tutor` route guards on approved Gia Sư AI staging with 16/16 checks and zero issues. This does not establish Google Auth, authenticated dashboard/lesson, reset, Student QA, voice, or full staging acceptance. Heuristic layout findings still require evidence review. |
| Student text QA | Implemented | `src/student-contracts.ts`; `src/student-brain.ts`; `src/student-qa.ts`; one persona/scenario; tests; ignored fixture evidence | Deterministic text-mode MVP has bounded context, browser-only structured actions, reset boundary, eight-turn fixture, artifacts/checks/UX estimates/report. Real staging is BLOCKED without host/account/reset. No provider brain/evaluator or Phase 5+ capability. |
| Recording | Implemented; host video capability blocked | `src/recorder.ts`; recorder tests; Web/Student reports; dedicated recording fixture evidence | Vendor-neutral lifecycle, FFmpeg probe/adapter, optional Playwright video, timestamps JSONL, screenshot fallback, report state/links, disk guard, cleanup, and PASS early-delete retention are implemented. Current Windows host lacks FFmpeg, so video fixture is explicitly `BLOCKED` and no `session.mp4` is claimed. Audio is excluded. |
| Voice | Implemented; native host blocked | `src/voice-provider.ts`; `src/audio-routing.ts`; `src/voice-bridge.ts`; setup/docs/tests/fixture evidence | Vendor-neutral contracts/providers, optional external TTS boundary, isolated route plan/probe, safe Linux setup, opt-in Chromium config, deterministic one/multi-turn WAV and fallback exist. Windows cannot prove native Pulse/PipeWire or physical mic; no real provider/staging voice acceptance is claimed. |
| Education Eval | Implemented; deterministic fixture validated | `src/education-eval.ts`; fractions rubric; evaluator and Student integration tests; `evaluation.json` fixture artifact | Scripted/mock UX evaluator only; score is non-authoritative and human calibration remains marked. No real provider/key or staging acceptance. |
| Replay / Regression | Implemented; deterministic fixture validated | `src/event-timeline.ts`; `src/replay-engine.ts`; `src/regression.ts`; `src/incident-regression.ts`; CLI/tests and ignored Phase 8 fixture evidence | Provider-free replay and artifact comparison are implemented. Web emits unified timeline; Student JSONL can be normalized as recorded source evidence. No live provider replay, staging acceptance, Model Arena, cohorts, dashboard, or auto-fix. |
| Model Arena | Implemented; deterministic fixture validated | `src/model-arena.ts`; versioned fixture config; tests; `qa:arena` and `qa:arena:fixture`; ignored arena JSON/Markdown evidence | Scripted configurations only. Latency is fixture-observed and cost is unknown; no provider/staging calls or marketing benchmark claim. |
| Synthetic Cohorts | Implemented; deterministic fixture validated | `src/synthetic-cohorts.ts`; golden/exploratory configs; tests; cohort manifest fixture evidence | Small bounded fixture cohorts only; no real child data, provider calls, large dataset, or Safety Lab behavior. |
| Safety policy contract / optimizer algorithm foundation | Implemented; deterministic fixture validated | `src/safety-lab.ts`; `src/quality-optimizer.ts`; versioned config/scenarios; tests; Phase 10 JSON/Markdown fixture evidence | Safety is a policy-contract fixture, not real tutor red-team implementation. Optimizer is a fixture algorithm foundation, not a real provider-configuration optimizer. Scripted/mock synthetic scope only; no harmful live call, real child data, real provider measurement, provider mutation, staging/production, auto-fix, or deployment. Routing outputs are proposals, not runtime policy changes. |

## Explicit blockers and external prerequisites

These are **blocked inputs**, not implemented capabilities:

- **Approved staging hostname and authorization:** public Web QA is authorized and validated only for `giasu-c2165.web.app`; typed `QA_STAGING_BASE_URL` and the exact-host allowlist fail closed. The committed placeholder authorizes no real target by default, and authenticated/reset/provider execution still requires separate authorization and inputs.
- **Dedicated test accounts and reset contract:** required for authenticated Web QA and Student QA; no account or reset integration has been supplied or tested.
- **Gia Sư AI authenticated journey:** Google Auth bootstrap is not accepted; authenticated dashboard is not started; catalog and lesson navigation are not tested; session/reset/mastery remain blocked pending an approved reset contract; real StudentBrain and voice have not been tested on staging.
- **Product transcript/whiteboard observability contracts:** required for precise Student QA and replay; screenshots may provide estimated evidence but must not be presented as exact event timing.
- **Recording host video capability:** current doctor evidence reports FFmpeg unavailable. The recording fixture therefore emits explicit `BLOCKED` evidence; installing/configuring FFmpeg is required before this host can prove `session.mp4` generation.
- **Voice host readiness:** implementation and deterministic fixture evidence exist, but this Windows host reports native PulseAudio/PipeWire routing `BLOCKED`. Linux VPS validation is still required for native microphone route and echo-isolated E2E.
- **Provider credentials and data policy:** future model/voice/evaluator integrations require approved secret handling and provider-specific privacy review; no credentials are present or requested now.

## Truthful current conclusion

QA Lab is `PHASE10_SAFETY_OPTIMIZER_FIXTURE_READY`: the Phase 0–10 framework is implemented and locally deterministic-fixture validated using scripted brains, synthetic personas/WAV, and provider-free replay. Real Gia Su AI staging acceptance is **NOT STARTED / NOT READY**. Separate tasks are mandatory for staging browser/auth/reset, real providers/evaluators, native Linux voice, and FFmpeg real recording. Physical microphone proof, provider/evaluator metrics, and privacy review remain unaccepted. Dashboard and provider mutation are not implemented; production, real child data without approved policy, auto-fix, and deployment are forbidden.
