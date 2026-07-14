# QA Lab Status

## Current state

- Current phase: **Phase 10 — Safety Lab + Cost–Quality–Latency Optimizer (final authority roadmap phase)**.
- Phase 0–3 foundation/browser/Web QA: **implemented and locally validated**.
- Phase 4 deterministic Student text QA: **implemented and locally fixture-validated**.
- Readiness label: `PHASE10_SAFETY_OPTIMIZER_FIXTURE_READY`.
- Phase 5 recording: **implemented with fixture-validated screenshot fallback**; dedicated video fixture is `BLOCKED` on this Windows host because FFmpeg is unavailable, so no `session.mp4` is claimed.
- Real staging acceptance: **BLOCKED** pending approved exact host, dedicated test account, and working reset integration.

## Phase 4 evidence

- Versioned strict persona/scenario loaders: `src/student-contracts.ts`.
- Persona/scenario: `personas/weak-fractions-grade-4.yaml`; `scenarios/student/weak-fractions-lesson.yaml`.
- Vendor-neutral `StudentBrain` and deterministic `ScriptedStudentBrain`: `src/student-brain.ts`; no provider adapter or credentials.
- Browser-only structured action allowlist; no shell, source, Git, cloud, arbitrary navigation, voice, or provider action.
- Bounded context retains only 3–5 recent turns plus understanding, misconception, used behaviors, and remaining goals.
- Runner lifecycle and truthful limits: `src/student-qa.ts`; missing prerequisites/reset yield `BLOCKED`, never synthetic PASS.
- Reset boundary: manual adapter requires explicit confirmation; stub always blocks and never claims success.
- Local `/lesson-mock` supplies deterministic tutor text and whiteboard state for eight complete turns.
- Artifacts: student/tutor/whiteboard JSONL, per-turn screenshots, UX diary, observed/estimated metrics, issues, evaluation, status, summary, and report.
- Deterministic checks: minimum eight turns, whiteboard observation, explanation-change goal, independent-check goal, and independent-success goal.
- CLI: `qa:list`; `qa:run -- --scenario weak-fractions-lesson`; explicit `qa:student:fixture` self-test.
- Test suite: 37 passing tests at Phase 4 validation, including positive/negative schema, bounded context, action domain guard, complete E2E, missing target BLOCKED, and reset BLOCKED.
- Generated local evidence: ignored `runs/phase4-student-fixture-evidence/`; fixture evidence is not staging acceptance.

## Security and truthful boundaries

- Phase 2 exact-host HTTPS/WSS, dedicated profile, request policy, redaction, and artifact protections remain in force.
- Fixture mode is explicit and permits only exact-port loopback HTTP.
- Real run remains `BLOCKED` without staging URL/account/reset; no production target is accessed.
- UX scores are deterministic state-based estimates and are labeled estimated with limitations; turns, duration, and DOM whiteboard states are observed.
- No real voice vendor, physical microphone claim, provider brain/evaluator, Education Eval, replay/regression, dashboard, deployment, model arena, or cohort exists.

## Phase 5 recording evidence

- Vendor-neutral Recorder lifecycle is implemented in src/recorder.ts.
- QA_ENABLE_RECORDING defaults off; FFmpeg is optional and doctor warns when absent.
- Checkpoints JSONL and screenshot fallback remain available; session.mp4 is only claimed when produced.
- PASS video early deletion defaults on; FAIL/release retention and idempotent partial cleanup are supported.
- Browser visuals only: no audio, microphone, TTS, voice, replay, or raw child data by default.
- Current machine evidence: doctor reports FFmpeg `warn/not found`; `qa:recording:fixture` writes explicit `BLOCKED` evidence and exits non-zero rather than fabricating video success.

## Phase 6 voice evidence

- Vendor-neutral `VoiceRequest`, `VoiceArtifact`, `VoiceProvider`, silent/text/deterministic WAV providers and optional external TTS interface exist; no vendor SDK/key is hard-coded.
- `student_audio` and `tutor_audio` routing plan is isolated; Chromium mic is `student_audio.monitor`; cross-monitor loopbacks are forbidden.
- Linux PulseAudio/PipeWire probe is read-only. Idempotent setup creates only missing null sinks and refuses unsafe echo state; it is never auto-run.
- `QA_ENABLE_VOICE` defaults off. Permission/media flags are applied only when enabled; failures preserve text mode and make no audio claim.
- Deterministic WAV validity/duration, routing, permissions, one/multi-turn, fallback, redaction and metadata tests pass.
- Windows host evidence: native Linux audio route is **BLOCKED** (`platform=win32`); deterministic fixture passes and explicitly claims no physical microphone. FFmpeg remains unavailable.
## Phase 7 Education Eval evidence

- Strict versioned `EvaluationInput` / `EvaluationResult` and rubric loader; invalid versions and weights fail closed.
- Deterministic required-flow/page/lesson/turn/transcript/crash/stuck checks plus p50/p95/median latency, overlap, silence, repeated phrase, long turn, whiteboard delay measurement provenance, and blocker counts.
- Deterministic blockers always `FAIL`; missing integration is `BLOCKED`; mild concerns produce `PASS_WITH_RISKS`; evaluator disagreement produces `NEEDS_REVIEW`.
- Vendor-neutral evaluator interface has scripted/mock implementation only. No real provider, SDK, key, or external call.
- Fractions rubric weights misconception detection, no early reveal, progressive hints, adaptation, whiteboard alignment, and independent answer; rule/AI responsibilities are separated and human calibration is marked `UNCALIBRATED_SCRIPTED_EVALUATOR`.
- Student runs write integrated `evaluation.json`; Web remains deterministic-only where relevant. Scores are `NON_AUTHORITATIVE`; unavailable product/model/prompt versions are null, never invented.
- Real provider evaluation, staging/production, dashboard, Model Arena, cohorts, and Phase 9+ remain out of scope.

## Phase 8 Replay/Regression evidence

- Strict schema-versioned unified `timeline.jsonl` normalizes browser, tutor, student, whiteboard, evaluation, and checkpoint events; timestamps and sequences are validated monotonically and payloads are recursively redacted.
- Replay modes `same-session-fixture` and `transcript-action` operate only from recorded events/scenario decisions, are digest-deterministic, and make zero provider calls. Missing, corrupt, reordered, or version-mismatched inputs fail closed.
- Run selectors accept validated run IDs or relative paths resolved under the configured artifact root only; traversal/dot/backslash escapes and absolute paths are rejected.
- Issue fingerprint is category + route + element + normalized error + scenario. Comparison deduplicates and classifies `NEW`, `PERSISTING`, `RESOLVED`, `REGRESSED`, and `FLAKY`, retaining baseline/candidate evidence.
- Metric comparison records threshold, direction, delta, regression result, and `observed`/`estimated` quality. Outputs are `regression.json`, `regression-summary.json`, and `regression-delta.md` without overwrite.
- CLI: `qa:compare -- --baseline <run> --candidate <run>`; `qa:replay -- --run <run> --mode same-session-fixture`; deterministic fixture: `qa:replay:fixture`.
- Incident packaging requires `anonymized: true`, recursively redacts secrets, rejects raw child identity/audio/image/transcript fields, and never stores raw child data.
- Web QA now writes the unified timeline. Existing Student tutor/student/whiteboard timelines remain unchanged and usable as normalization sources; protected browser, voice, recording, and education-eval behavior is preserved.
- Fixture evidence is generated under ignored `runs/phase8-regression-fixture-evidence/` with baseline, candidate, comparison, and replay digest evidence.
- No code auto-fix, provider call, staging/production access, or dashboard behavior is implemented.

## Phase 9 Model Arena and cohort evidence

- Strict versioned arena config/observation/report contracts capture vendor-neutral brain/evaluator identities and stable configuration hashes.
- Fixture compares scripted baseline and scripted adaptive configurations on identical scenario, fixed Golden cohort, seed, rubric, build, and evidence version. The evaluator identity is independent from each brain; no model is its sole self-judge.
- Ranking is deterministic by quality, reliability, consistency variance, then stable ID. Entries with hard blockers are excluded; incompatible seed/evidence version prevents all ranking; exact ties share rank.
- Latency and cost carry `observed`/`estimated`/`unknown` provenance. Unknown cost remains null and is never interpreted as zero. Reports explicitly reject marketing benchmark claims.
- Versioned Golden cohort has three fixed personas. Seeded Exploratory cohort has six bounded PII-free personas spanning ability, misconception, behavior, communication, environment, and learning psychology.
- Same exploratory seed/config reproduces exactly; changed seed changes combinations. Cohort manifests record seed and configuration hash before baseline use.
- `selectCohortPersonas` and `toStudentPersona` integrate cohort selection with existing Student QA contracts without provider calls or protected browser/voice changes.
- `qa:arena` writes `arena.json` and `report.md`; `qa:arena:fixture` additionally writes `cohort-manifest.json` under ignored `runs/phase9-arena-cohort-fixture-evidence/`.
## Phase 10 Safety Lab and optimizer evidence

- Strict versioned Safety scenario/action/report contracts cover eight categories: child safety, PII leakage, boundary/manipulation/distress, student/web/image-metadata-placeholder injection, tool safety, and data safety.
- Deterministic policy-first evaluation validates structured allowlisted actions before controller execution. Shell, filesystem, Git, arbitrary domain, cloud console, and payment proposals are denied; blocker/critical failures override aggregate results.
- Fixture boundaries are local artifact sandbox, synthetic test identities, no production/staging, no real child data, recursively redacted evidence, scripted/mock agents only, and zero harmful/live calls.
- Optimizer config/candidates/report are vendor-neutral and versioned. Required quality, p95 latency, and cost unknowns are `NEEDS_REVIEW`; unknown is null and never zero. Any critical failure rejects a candidate.
- Pareto frontier maximizes quality while minimizing latency/cost; deterministic order is cost, quality, latency, stable ID, with exact metric ties sharing rank.
- Cost formula v1 explicitly records currency, session duration, assumptions, provenance, and `(inputUnits * inputRate) + (outputUnits * outputRate) + (audioMinutes * audioMinuteRate)`.
- Routing outputs for simple turn, repeated confusion, vision board, final verifier, and degraded text are proposals with evidence/limitations only. Provider config mutation and deployment are always false.
- `qa:phase10:fixture` writes redacted Safety and optimizer JSON/Markdown plus fixture summary under ignored `runs/phase10-safety-optimizer-fixture-evidence/`.
- Full authority roadmap Phase 0–10 is complete at local deterministic-fixture capability. Native Linux voice, FFmpeg recording, physical microphone, approved staging account/domain/reset, and real provider/evaluator measurements remain blocked or unaccepted. No dashboard, production, auto-fix, or deploy exists.
