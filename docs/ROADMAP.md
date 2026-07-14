# QA Lab — Authoritative Delivery Roadmap

**Product authority:** [`QA_LAB_PRODUCT_STRATEGY.md`](QA_LAB_PRODUCT_STRATEGY.md)

**Capability evidence:** [`CAPABILITY_GAP_MAP.md`](CAPABILITY_GAP_MAP.md)

This roadmap preserves the Founder-approved sequence. A later capability must not be implemented to bypass acceptance of an earlier capability. Each phase requires scoped source, tests, command evidence, documentation/status updates, a commit, and an understood clean working tree before it is marked complete.

## Ordered roadmap

1. **Foundation — Phase 0–1 — Implemented**
   - Environment audit, independent repository, strict TypeScript, versioned config, exact-host HTTPS staging guard, safe run/artifact primitives, redacted logs, offline status/doctor CLI, and unit/security tests.
   - Current label: `FOUNDATION_READY`.

2. **Browser — Phase 2 — Implemented; local fixture validated**
   - Guarded Playwright/Chromium launcher, dedicated profile, navigation/redirect/subresource/WebSocket policy, screenshot, console/failed-network JSONL capture, basic navigation, login adapter interface, timeouts, and cleanup.
   - Validated only against explicit loopback fixture mode. No staging URL/account was configured or accessed; staging acceptance remains unclaimed.

3. **Web QA — Phase 3 — Implemented; local fixture validated**
   - Versioned typed web scenarios, bounded flow execution, mobile-common/laptop matrix, deterministic runtime/layout checks, evidence-backed issues, reports, listing/run CLI, and complete local fixture E2E.
   - Real staging acceptance remains blocked without an approved target/account; a missing target yields `BLOCKED`, never synthetic PASS.

4. **Student text — Phase 4 — Implemented; local fixture validated**
   - Versioned persona/student scenario contracts, vendor-neutral bounded StudentBrain, deterministic scripted adapter, browser-only transcript loop, reset boundary, truthful lifecycle/limits, UX diary, turn/whiteboard/screenshot artifacts, deterministic checks, and independent report.
   - Real staging execution is `BLOCKED` without approved exact host, dedicated account, and working reset integration. UX scores are explicitly estimated; no provider brain/evaluator is present.

5. **Recording — Phase 5 — Implemented; video fixture capability-blocked on this machine**
   - Vendor-neutral Recorder interface, lifecycle, screenshot timeline, FFmpeg/browser-video adapter, synchronized checkpoint timestamps, report links, retention policy, disk guard, and partial cleanup are implemented.
   - The Windows recording fixture emits explicit `BLOCKED` evidence because FFmpeg is unavailable; no `session.mp4` success is claimed. Web/Student fixture recording fallback is locally validated.

6. **Voice — Phase 6 — Implemented; deterministic fixture validated, native host blocked**
   - Provider-neutral voice adapter, silent/text/WAV implementations, optional external TTS boundary, isolated student/tutor route plan, Linux capability probe/setup, Chromium microphone permission/selection config, one/multi-turn deterministic validation, echo isolation, safe-off flag, text fallback, and audio metadata are implemented.
   - This Windows host cannot validate native PulseAudio/PipeWire routing and lacks FFmpeg. Native voice E2E is truthfully `BLOCKED`; synthetic WAV evidence does not claim a physical microphone.

7. **Education Eval — Phase 7 — Implemented; deterministic fixture validated**
   - Versioned evaluation/rubric contracts, fractions rubric, deterministic checks/metrics, hard-failure precedence, vendor-neutral UX evaluator boundary with scripted mock only, confidence/evidence/limitations, human-calibration marker, and integrated Student evaluation artifact/report.
   - Scores are explicitly non-authoritative. No real evaluator provider/key, replay, staging, production, or dashboard is claimed.

8. **Replay / Regression — Phase 8 — Planned**
   - Unified event timeline, deterministic replay, baseline comparison, incident-to-regression conversion, issue fingerprinting/deduplication, and delta reports.

9. **Model Arena — Phase 9A — Planned**
   - Controlled comparison of model/prompt/policy configurations on identical scenarios, personas, seeds, rubrics, build, and observability contracts.

10. **Cohorts — Phase 9B — Planned**
    - Fixed golden cohort for regression and seeded exploratory cohort for discovery, with controlled dimensions and coverage accounting.

11. **Safety / Optimizer — Phase 10 — Planned**
    - Child safety, PII, prompt injection, boundary/escalation and tool-safety suites; then cost–quality–latency measurement and constrained routing optimization.

## Current execution gate

Phase 7 Education Eval is implemented with deterministic fixture evidence and a scripted evaluator boundary only. Native PulseAudio/PipeWire voice E2E remains `BLOCKED` on this Windows host; FFmpeg is unavailable. Real staging remains blocked pending approved host/account/reset. Replay, real evaluator/provider, dashboard, staging/production execution, and later phases remain out of scope.
