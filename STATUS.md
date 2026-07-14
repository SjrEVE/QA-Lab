# QA Lab Status

## Current state

- Current phase: **Phase 5 — Recording MVP**.
- Phase 0–3 foundation/browser/Web QA: **implemented and locally validated**.
- Phase 4 deterministic Student text QA: **implemented and locally fixture-validated**.
- Readiness label: `RECORDING_MVP_READY`.
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
- No voice/microphone, provider brain, provider evaluator, replay/regression, dashboard, deployment, model arena, cohort, or Phase 5+ capability exists.

## Phase 5 recording evidence

- Vendor-neutral Recorder lifecycle is implemented in src/recorder.ts.
- QA_ENABLE_RECORDING defaults off; FFmpeg is optional and doctor warns when absent.
- Checkpoints JSONL and screenshot fallback remain available; session.mp4 is only claimed when produced.
- PASS video early deletion defaults on; FAIL/release retention and idempotent partial cleanup are supported.
- Browser visuals only: no audio, microphone, TTS, voice, replay, or raw child data by default.
- Current machine evidence: doctor reports FFmpeg `warn/not found`; `qa:recording:fixture` writes explicit `BLOCKED` evidence and exits non-zero rather than fabricating video success.
