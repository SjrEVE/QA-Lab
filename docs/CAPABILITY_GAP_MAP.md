# QA Lab — Capability and Gap Map

**Audit date:** 15/07/2026

**Authority:** [`QA_LAB_PRODUCT_STRATEGY.md`](QA_LAB_PRODUCT_STRATEGY.md)

## Status semantics

- **Implemented:** source, tests, validation evidence, and current runtime behavior exist.
- **Partial:** a bounded foundation primitive exists, but the end capability does not.
- **Planned:** approved by strategy but not implemented.
- **Blocked:** cannot truthfully proceed without an external prerequisite or a later explicit authorization.

A planning note, interface idea, config flag, tool detected by doctor, or artifact directory primitive is not evidence that a runtime capability exists.

For authenticated staging expansion, status is reported with four independent booleans: `implemented`, `locallyTested`, `stagingValidated`, and `accepted`. Acceptance is module-bounded and never implies whole-product, provider, voice, production, commerce, or real-child acceptance.

| Staging capability | implemented | locallyTested | stagingValidated | accepted | Evidence / boundary |
|---|---:|---:|---:|---:|---|
| Public Web smoke | true | true | true | true | Enforce run `20260715T063728Z-caa7374a` passed 16/16 public checks with zero issues; authenticated product acceptance is separate. |
| Typed authenticated staging profile | true | true | true | true | Exact `giasu-c2165.web.app` target, `.qa-private/` containment, verified identity hash, and strict request allowlist were exercised without committing account state. |
| Verified Firebase auth bootstrap | true | true | true | true | The dedicated test account completed Google Auth and persisted in a fresh browser process; email, cookies, and credentials remain private and untracked. |
| Local Control Center | true | true | false | false | Loopback-only UI uses a random token, exact Host/Origin checks, fixed action allowlist, bounded bodies, and non-active HTML artifact delivery; no authenticated staging action has passed. |
| Authenticated account/catalog/mode | true | true | true | true | Enforce run `20260715T063715Z-978f9b25` passed hashed identity, account controls, hierarchy, canonical modes, lesson continuity and clinic readiness. The single conservative geometry heuristic was screenshot-reviewed as non-blocking. |
| Strict reset contract | true | true | true | true | Staging-only reset scopes are exact-host, token-from-env, identity/lesson-bound, bounded and idempotent; they preserve unrelated product data and fail closed outside their declared scope. |
| Integral guided self-study | true | true | true | true | Historical run `20260715T065109Z-815e3991` passed 57/57 across 390×844, 768×1024 and 1440×900 for the functional package journey. The sanitized manifest records its exact QA commit, package fingerprint and artifact digests. Hardened Gemini-deny and per-request App Check gates require a fresh rerun. |
| Conditional Probability guided self-study | true | true | true | true | Historical run `20260715T070209Z-00358b7b` passed the independent L18 journey 57/57 across all three viewports. Functional acceptance remains module-bounded; the two hardened security gates require a fresh rerun. |
| App Check staging enforcement | true | true | true | true | A registered private debug token is injected before Firebase initialization and never persisted to browser event logs. Session/full-flow runs listed below reached Auth/App Check protected Functions with no 401/403; backend enforcement was not weakened. |
| Targeted authenticated session start | true | true | true | true | Runs `20260715T122032Z-071ffc03` and `20260715T122124Z-e0edddbe` passed consecutively with `setupComplete`, `lessonReady` and clean session lifecycle. |
| Authenticated Live full flow — scripted student | true | true | true | true | Runs `20260715T123218Z-725f8720` and `20260715T123733Z-b998f2bb` passed check-in, incorrect/correct deterministic verification, guided response, two whiteboard objects, memory card and clean stop. Final event evidence had no audio self-interruption, 401/403/409, revision conflict or state violation. First-audio remains about 5–8 seconds. |
| Real Gemini StudentBrain full flow | true | true | false | false | The bounded provider adapter, doctor and `qa:live:brain` visible runner exist and are locally contract-tested. Acceptance requires a successful real-key run producing `live-brain-summary.json`; no such artifact exists in the current run store. Scripted Live evidence is not substituted for Real Brain evidence. |

## Foundation Phase 0–1 audit

| Capability | Status | Evidence | Gap / boundary |
|---|---|---|---|
| Independent repository and governance | Implemented | `AGENTS.md`; Git history; Phase 0 audit | Repository is independent; product repositories and production remain out of bounds. |
| Windows runtime audit | Implemented | `docs/environment-audit.md` | Audit is a point-in-time local observation, not proof of staging readiness. |
| Node.js 20+ and strict TypeScript foundation | Implemented | `package.json`; `tsconfig.json`; build/lint commands | No browser or provider runtime follows from this foundation. |
| Typed, schema-versioned YAML config | Implemented | `src/config.ts`; `test/config.test.ts`; `config/qa-lab.yaml` | Current schema covers foundation settings only, not scenario/persona/provider contracts. |
| Fail-closed staging target authorization | Implemented; bounded staging validated | `src/security.ts`; `src/browser-policy.ts`; security/policy tests; approved staging runs | Browser requests apply exact-host HTTPS/WSS policy; loopback HTTP requires explicit fixture mode and exact bound port. Only `giasu-c2165.web.app` and declared modules have real staging evidence. |
| Safe run ID and artifact primitives | Implemented | `src/run-store.ts`; `test/run-store.test.ts` | Can create run/status files and exclusive artifacts; full run lifecycle, timeline, report, and retention are absent. |
| Structured redacted logging | Implemented | `src/redaction.ts`; `src/logger.ts`; `test/redaction-logger.test.ts` | Foundation redaction exists; future browser/provider artifacts require additional boundary tests. |
| Offline status and doctor CLI | Implemented | `src/cli.ts`; `src/doctor.ts`; package scripts | Doctor does not contact staging or launch Chromium; it now performs a read-only local voice routing capability probe. |
| Security tests | Implemented | `test/security.test.ts`; negative config/run-store/redaction tests | Future browser/action/filesystem/provider boundaries need their own positive and negative tests. |
| Full scenario orchestration | Implemented at bounded fixture/module scope | Typed Web, Student, authenticated catalog/session and guided-self-study runners; reset and lifecycle tests | Generic production-wide orchestration, arbitrary-product discovery and autonomous repair remain unimplemented and unauthorized. |
| Deterministic evaluation and final verdict engine | Implemented at deterministic fixture scope | `src/education-eval.ts`; rule/blocker precedence; fixture integration and artifacts | Provider-backed independent evaluation, human calibration and whole-product staging acceptance remain unimplemented. |

## Roadmap capability map

| Ordered capability | Status | Current evidence | Missing capability / prerequisite |
|---|---|---|---|
| Foundation | Implemented | Phase 0 audit; typed config; guards; safe artifacts; redaction; offline CLI; tests | Maintain governance and validation as later phases extend boundaries. |
| Browser | Implemented; bounded staging validated | `src/browser-controller.ts`; `src/browser-policy.ts`; Playwright Chromium; fixture and authenticated staging integration tests | Dedicated profile, bounded actions, exact-host navigation/subresource/WebSocket policy, screenshots, console/network evidence, auth persistence, timeout and cleanup are validated for the approved staging modules only. |
| Web QA | Implemented; bounded staging accepted | Public/auth/catalog/self-study scenarios and final runs listed above | Public smoke and two authenticated self-study journeys passed. This does not establish realtime Gemini, physical voice, provider evaluation, production, commerce, or whole-product acceptance. Geometry heuristics still require evidence review. |
| Student text QA | Implemented; scripted regression and real-provider adapter locally validated | `src/student-contracts.ts`; `src/student-brain.ts`; `src/gemini-student-brain.ts`; `src/student-qa.ts`; `scripts/visible-live-brain-session.ts`; positive/negative provider-boundary tests; ignored fixture evidence | Deterministic text-mode MVP and `ScriptedStudentBrain` remain regression infrastructure. Real Gemini StudentBrain is a separate opt-in provider adapter with bounded context, strict structured actions, Vietnamese speech validation, secret-safe transport and reset boundary. A successful dedicated staging artifact is still required before provider-backed full-flow acceptance. No real evaluator acceptance. |
| Recording | Implemented; local Full-HD fixture validated | `src/recorder.ts`; `src/tab-audio-capture.ts`; recorder/browser tests; private fixture evidence | Playwright video, all in-tab AudioContexts, offset-aware mix, AAC mux, complete FFmpeg decode, 1920×1080 geometry, duration and audio-coverage gates are implemented. A short local fixture passed; three 5-minute staging artifacts remain pending. |
| Voice | Implemented; native route blocked, external Vietnamese TTS locally validated | `src/edge-tts.ts`; `src/voice-provider.ts`; `src/audio-routing.ts`; browser audio tests | Windows cannot prove native Pulse/PipeWire or physical mic and cannot install a usable `vi-VN` system voice. Edge TTS Vietnamese speech now uses the external/provider boundary and is captured audibly in-tab; long-form staging acceptance remains pending. |
| Education Eval | Implemented; deterministic fixture validated | `src/education-eval.ts`; fractions rubric; evaluator and Student integration tests; `evaluation.json` fixture artifact | Scripted/mock UX evaluator only; score is non-authoritative and human calibration remains marked. No real provider/key or staging acceptance. |
| Replay / Regression | Implemented; deterministic fixture validated | `src/event-timeline.ts`; `src/replay-engine.ts`; `src/regression.ts`; `src/incident-regression.ts`; CLI/tests and ignored Phase 8 fixture evidence | Provider-free replay and artifact comparison are implemented. Web emits unified timeline; Student JSONL can be normalized as recorded source evidence. No live provider replay, staging acceptance, Model Arena, cohorts, dashboard, or auto-fix. |
| Model Arena | Implemented; deterministic fixture validated | `src/model-arena.ts`; versioned fixture config; tests; `qa:arena` and `qa:arena:fixture`; ignored arena JSON/Markdown evidence | Scripted configurations only. Latency is fixture-observed and cost is unknown; no provider/staging calls or marketing benchmark claim. |
| Synthetic Cohorts | Implemented; deterministic fixture validated | `src/synthetic-cohorts.ts`; golden/exploratory configs; tests; cohort manifest fixture evidence | Small bounded fixture cohorts only; no real child data, provider calls, large dataset, or Safety Lab behavior. |
| Safety policy contract / optimizer algorithm foundation | Implemented; deterministic fixture validated | `src/safety-lab.ts`; `src/quality-optimizer.ts`; versioned config/scenarios; tests; Phase 10 JSON/Markdown fixture evidence | Safety is a policy-contract fixture, not real tutor red-team implementation. Optimizer is a fixture algorithm foundation, not a real provider-configuration optimizer. Scripted/mock synthetic scope only; no harmful live call, real child data, real provider measurement, provider mutation, staging/production, auto-fix, or deployment. Routing outputs are proposals, not runtime policy changes. |

## Explicit blockers and external prerequisites

These are **blocked inputs**, not implemented capabilities:

- **Approved staging hostname and authorization:** bounded Web QA is authorized and validated only for `giasu-c2165.web.app`; typed `QA_STAGING_BASE_URL` and exact-host allowlist fail closed. Committed placeholders authorize no real target by default.
- **Dedicated test account and reset contract:** implemented and accepted for the declared account/catalog/session-start/Integral/Conditional scopes. Credentials, reset token and browser state remain private and untracked; new scopes require explicit product reset contracts.
- **Gia Sư AI authenticated journey:** Google Auth, catalog and guided self-study are accepted only for the modules above. The full-web orchestrator can run every linked staging module after its Fast Gate passes, but this does not turn local provider-adapter tests into StudentBrain/evaluator, physical voice or arbitrary-lesson acceptance.
- **Product transcript/whiteboard observability contracts:** required for precise Student QA and replay; screenshots may provide estimated evidence but must not be presented as exact event timing.
- **Long-form recording acceptance:** a private FFmpeg binary and Full-HD audio/video fixture now work. The remaining gate is three real staging sessions lasting 5 minutes each; a short fixture must not be relabeled as product video acceptance.
- **Voice host readiness:** implementation and deterministic fixture evidence exist, but this Windows host reports native PulseAudio/PipeWire routing `BLOCKED`. Linux VPS validation is still required for native microphone route and echo-isolated E2E.
- **Provider credentials and data policy:** the Real Gemini StudentBrain uses an operator-supplied process environment key, an explicit opt-in flag, the fixed official host, bounded synthetic context and no raw-provider persistence. No credential is committed. A dedicated `live-brain-summary.json` and provider/privacy review remain required before broader provider acceptance; scripted Live evidence cannot satisfy this gate.

## Truthful current conclusion

QA Lab is `PHASE10_SAFETY_OPTIMIZER_FIXTURE_READY` and `GIA_SU_AI_GUIDED_SELF_STUDY_PLUS_SYNTHETIC_LIVE_STAGING_ACCEPTED`: the deterministic framework remains fixture-scoped, while separately authorized public/auth/catalog/reset/Integral/Conditional and scripted-student Live modules have real staging evidence. Full-HD recording and external Vietnamese TTS are locally fixture-validated, not yet long-form staging-accepted. Real Gemini StudentBrain full-flow, physical microphone, real evaluator metrics, production, public commerce and real-child use remain unaccepted or forbidden by their existing gates.
