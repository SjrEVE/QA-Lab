# QA Lab Status

## Current state

- Framework state: **Phase 0–10 implemented and validated at local deterministic-fixture scope only**.
- `QA-STAGING-001` public smoke is accepted against the approved non-production host `https://giasu-c2165.web.app`: final enforce run `20260715T063728Z-caa7374a` passed 16/16 landing/login/unauthenticated-guard checks with zero issues.
- Authenticated staging is bounded and functionally accepted for account/catalog/reset and two self-study packages. Integral run `20260715T065109Z-815e3991` and Conditional Probability run `20260715T070209Z-00358b7b` each passed 57/57 at three viewports. A later audit found their Gemini/App Check evidence policy too permissive; request-interception deny and per-critical-request App Check coverage are now implemented locally and require a fresh staging rerun. Sanitized provenance is committed under `docs/evidence/`.
- The targeted G12 Live runner is staging-accepted for its bounded synthetic/scripted-student flow. Session-start runs `20260715T122032Z-071ffc03` and `20260715T122124Z-e0edddbe` passed consecutively. Full-flow runs `20260715T123218Z-725f8720` and `20260715T123733Z-b998f2bb` passed check-in, incorrect/correct deterministic verification, guided response, two persisted whiteboard objects, memory card and clean stop. The final event stream had no App Check/Auth/revision/state-violation error and no `quick_tutor_message`/`gemini_interrupted` self-interruption.
- QA Lab has two distinct StudentBrain modes: deterministic `ScriptedStudentBrain` for regression and an opt-in bounded Real Gemini StudentBrain for provider-backed student decisions. The real adapter and visible staging runner are implemented and locally tested, but repository acceptance remains pending until a real-key run writes the required `live-brain-summary.json`; the two accepted Live runs above used synthetic/scripted student input and must not be relabeled as Real Brain evidence.
- Framework readiness label: `PHASE10_SAFETY_OPTIMIZER_FIXTURE_READY`; product module readiness is reported separately as `GIA_SU_AI_GUIDED_SELF_STUDY_STAGING_ACCEPTED` and does not mean whole-product acceptance.
- Phase 5 Full-HD recording is implemented and fixture-validated with a private FFmpeg binary, multi-AudioContext tab capture, AAC mux and complete stream decode. The short fixture produced a valid 1920×1080 H264/AAC `session.mp4`; three 5-minute staging recordings are still pending and no long-form video is claimed yet.
- Real Gia Su AI staging acceptance: **MODULE-BOUNDED / GUIDED SELF-STUDY + SYNTHETIC LIVE FLOW READY**. Public UI, authenticated catalog, identity persistence, strict reset, Integral, Conditional Probability and the bounded scripted-student Live flow are accepted within their stated modules. Whole-product acceptance is not claimed; first-audio latency remains about 5–8 seconds and the Real Brain + Edge TTS three-video gate from commit `a6b94b4` has not run yet. Evaluator, physical/native voice, production, public commerce and real-child use remain separate gates.
- Independent CI workflow is added at `.github/workflows/ci.yml` with least-privilege fixture-only Windows validation, local secret scanning, audit, and a separate truthful recording capability contract. The first remote run is **PENDING GITHUB ACTIONS CONFIRMATION**; local validation is not claimed as CI PASS.

## Phase 4 evidence

- Versioned strict persona/scenario loaders: `src/student-contracts.ts`.
- Persona/scenario: `personas/weak-fractions-grade-4.yaml`; `scenarios/student/weak-fractions-lesson.yaml`.
- Vendor-neutral `StudentBrain`, deterministic `ScriptedStudentBrain`, and opt-in structured Real Gemini adapter: `src/student-brain.ts`; `src/gemini-student-brain.ts`. Scripted mode is the regression fixture; Gemini mode is a real provider path, not another scripted persona. The operator key remains process-only and untracked; Real Brain staging acceptance requires a successful `qa:live:brain` artifact and is currently pending.
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

- The authoritative Phase 0–10 system threat model, status matrix, residual risks, verification map, and future staging security gates are documented in `docs/threat-model.md`.
- Phase 2 exact-host HTTPS/WSS, dedicated profile, request policy, redaction, and artifact protections remain in force.
- Fixture mode is explicit and permits only exact-port loopback HTTP.
- Real run remains `BLOCKED` without staging URL/account/reset; no production target is accessed.
- UX scores are deterministic state-based estimates and are labeled estimated with limitations; turns, duration, and DOM whiteboard states are observed.
- No physical microphone claim, accepted Real StudentBrain/evaluator, dashboard, deployment, or whole-product acceptance exists. Realtime Tutor is accepted only for the bounded synthetic/scripted-student Live flow described above; Education Eval, replay/regression, Model Arena, and cohorts remain deterministic fixture foundations only.

## Phase 5 recording evidence

- Vendor-neutral Recorder lifecycle is implemented in src/recorder.ts.
- `QA_ENABLE_RECORDING` defaults off; FFmpeg is optional and may be supplied only by `QA_FFMPEG_PATH`. Doctor truthfully warns when that explicit path/PATH is absent.
- Checkpoints JSONL and screenshot fallback remain available; session.mp4 is only claimed when produced.
- PASS video early deletion defaults on; FAIL/release retention and idempotent partial cleanup are supported.
- Default recording remains visual-only. The explicit Live demo path captures only in-tab Web Audio, mixes all AudioContexts and never stores microphone input, raw provider PCM, raw transcript or child data.
- Current machine evidence: private FFmpeg exists under `.qa-private`; with `QA_FFMPEG_PATH` the recording fixture passed 1920×1080 H264/AAC generation and complete audio/video decode. Without that environment setting, doctor still reports a truthful warning instead of guessing a binary.

## Phase 6 voice evidence

- Vendor-neutral `VoiceRequest`, `VoiceArtifact`, `VoiceProvider`, silent/text/deterministic WAV providers and optional external TTS interface exist; no vendor SDK/key is hard-coded.
- `student_audio` and `tutor_audio` routing plan is isolated; Chromium mic is `student_audio.monitor`; cross-monitor loopbacks are forbidden.
- Linux PulseAudio/PipeWire probe is read-only. Idempotent setup creates only missing null sinks and refuses unsafe echo state; it is never auto-run.
- `QA_ENABLE_VOICE` defaults off. Permission/media flags are applied only when enabled; failures preserve text mode and make no audio claim.
- Deterministic WAV validity/duration, routing, permissions, one/multi-turn, fallback, redaction and metadata tests pass.
- Windows host evidence: native Linux audio route is **BLOCKED** (`platform=win32`); deterministic fixture passes and explicitly claims no physical microphone. Microsoft did not make a usable `vi-VN` system voice installable on this host, so browser `en-US` remains fallback-only. Edge TTS now supplies Vietnamese QA speech through the external/provider boundary; private FFmpeg + in-tab Web Audio recording is fixture-validated. Long-form staging acceptance remains pending.
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

- A strict versioned Safety policy-contract fixture covers eight categories: child safety, PII leakage, boundary/manipulation/distress, student/web/image-metadata-placeholder injection, tool safety, and data safety. This is contract-fixture evidence only; real tutor or multimodal provider red-team execution is not implemented.
- Deterministic policy-first evaluation validates structured allowlisted actions before controller execution. Shell, filesystem, Git, arbitrary domain, cloud console, and payment proposals are denied; blocker/critical failures override aggregate results.
- Fixture boundaries are local artifact sandbox, synthetic test identities, no production/staging, no real child data, recursively redacted evidence, scripted/mock agents only, and zero harmful/live calls.
- Optimizer fixture config/candidates/report provide a vendor-neutral algorithm foundation, not a real provider-configuration optimizer. Required quality, p95 latency, and cost unknowns are `NEEDS_REVIEW`; unknown is null and never zero. Any critical failure rejects a candidate.
- Pareto frontier maximizes quality while minimizing latency/cost; deterministic order is cost, quality, latency, stable ID, with exact metric ties sharing rank.
- Cost formula v1 explicitly records currency, session duration, assumptions, provenance, and `(inputUnits * inputRate) + (outputUnits * outputRate) + (audioMinutes * audioMinuteRate)`.
- Routing outputs for simple turn, repeated confusion, vision board, final verifier, and degraded text are proposals with evidence/limitations only. Provider config mutation and deployment are always false.
- `qa:phase10:fixture` writes redacted Safety and optimizer JSON/Markdown plus fixture summary under ignored `runs/phase10-safety-optimizer-fixture-evidence/`.
- The Phase 0–10 framework is implemented and locally deterministic-fixture validated. Separately, bounded Gia Su AI staging acceptance exists for public/auth/catalog/reset, two guided-self-study packages and one scripted-student Live flow. Real Gemini StudentBrain + Edge TTS long-form staging evidence, native Linux audio, physical microphone and real evaluator measurements remain unaccepted; the local Full-HD recorder itself is fixture-validated. Production, real child data without completed policy gates, auto-fix, and QA-Lab deployment capability are forbidden.
