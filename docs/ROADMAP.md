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

3. **Web QA — Phase 3 — Planned**
   - Web scenario contract, risk-bounded flow execution, viewport matrix, deterministic checks, evidence-backed issue schema, report, summary, and fixture coverage.

4. **Student text — Phase 4 — Planned**
   - Persona and student scenario contracts, bounded StudentBrain decisions, transcript-driven loop, UX diary, turn artifacts, stop conditions, and independent report.

5. **Recording — Phase 5 — Planned**
   - Recorder interface, screenshot timeline, FFmpeg integration when locally viable, synchronized timestamps, artifact links, retention policy, disk guard, and cleanup.

6. **Voice — Phase 6 — Planned**
   - Provider-neutral voice adapter, virtual student/tutor audio routing, Chromium microphone selection, one-turn then multi-turn validation, echo isolation, feature flag, and text-mode fallback.

7. **Education Eval — Phase 7 — Planned**
   - Skill/subskill rubric registry, deterministic graders, independent AI-assisted UX grader, human calibration, confidence/limitations, and hard-failure precedence.

8. **Replay / Regression — Phase 8 — Planned**
   - Unified event timeline, deterministic replay, baseline comparison, incident-to-regression conversion, issue fingerprinting/deduplication, and delta reports.

9. **Model Arena — Phase 9A — Planned**
   - Controlled comparison of model/prompt/policy configurations on identical scenarios, personas, seeds, rubrics, build, and observability contracts.

10. **Cohorts — Phase 9B — Planned**
    - Fixed golden cohort for regression and seeded exploratory cohort for discovery, with controlled dimensions and coverage accounting.

11. **Safety / Optimizer — Phase 10 — Planned**
    - Child safety, PII, prompt injection, boundary/escalation and tool-safety suites; then cost–quality–latency measurement and constrained routing optimization.

## Current execution gate

Phase 2 implementation is complete with local fixture evidence. Phase 3 is next in roadmap order but is not implemented by this task. Real staging execution remains blocked until an approved exact hostname and dedicated test account are configured. Web QA, Student QA, recording, voice, replay, and later-phase capabilities remain out of scope.
