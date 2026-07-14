# QA Lab — Supporting Architecture Notes

> **Authority notice:** This file is non-authoritative supporting context preserved from the Phase 0–1 foundation work. Product intent, architecture direction, and roadmap order are controlled by [`../QA_LAB_PRODUCT_STRATEGY.md`](../QA_LAB_PRODUCT_STRATEGY.md). Current capability truth is recorded in [`../CAPABILITY_GAP_MAP.md`](../CAPABILITY_GAP_MAP.md), and delivery order in [`../ROADMAP.md`](../ROADMAP.md).
>
> Nothing below proves a runtime capability. Browser automation, Web QA, Student QA, recording, voice, Education Eval, replay/regression, Model Arena, cohorts, safety, optimization, provider execution, deployment, and production access are not implemented by these notes.

## Preserved Phase 0–1 reasoning

These notes captured useful architectural reasoning before the authoritative Founder strategy was recorded. They are retained as evidence and implementation context, not as a competing source of product authority.

### Controller and provider boundary

QA Lab must not depend on Hermes. Hermes is an optional brain/provider, never the whole system. The controller selects bounded scenarios before invoking an agent. Models propose typed actions; policy validates them; deterministic executors perform them.

A future shape considered during foundation was:

```text
QA Lab Core / QA Controller
├── Scenario engine / risk-based selector
├── Web Smoke Runner
├── Visual/Copy Runner
├── Student UX Runner
├── Browser driver
├── Brain and voice adapters
├── Rule and independent UX evaluators
├── Artifact store
└── Report, regression, and issue deduplication
```

This shape remains broadly compatible with the strategy but does not authorize implementation or override its ordered roadmap.

### Bounded scenario execution

A future run may receive approved staging metadata such as base URL, build ID, commit, changed areas, and run mode. The controller—not a model—selects scenarios from changed areas. Models must not discover arbitrary scope. Scenarios require explicit goals, bounded behavior, stop conditions, maximum duration/turns/failures, and terminal status.

Risk tiers considered:

1. **Fast Gate:** deterministic availability, login, API, lesson start, control, console/network, and principal layout checks.
2. **Focused UX:** bounded layout, responsive, copy, CTA, animation, loading, navigation, accessibility, and screenshot review.
3. **Student Session:** bounded lesson evaluation only for relevant runtime/prompt/voice/whiteboard/mastery/exercise changes or scheduled release checks.

### Observation and evaluator separation

Prefer structured sources in this order when they exist: DOM/accessibility tree, transcript events, whiteboard debug events, screenshot checkpoints, then vision for genuinely visual judgments.

The student actor may emit an experience diary but cannot be the sole final judge. Deterministic rules evaluate hard failures first; an independent evaluator may assess subjective teaching, age appropriateness, copy, and UX but cannot override a hard blocker.

### Artifacts, retention, and deduplication

Future runs may produce summaries, reports, issues, transcripts, student turns, metrics, console/network logs, screenshots, and video. Passing runs should retain minimal evidence; failures and release runs may retain richer evidence under an explicit privacy, disk, and retention policy.

Potential issue lifecycle:

```text
NEW | PERSISTING | REGRESSED | RESOLVED | FLAKY
```

Fingerprinting may use category, route, element, normalized error, and scenario to reduce duplicate issues. This remains planned until replay/regression is implemented and validated.

### Resource and provider notes

Foundation reasoning favored one browser process/profile for sequential scenarios, one student voice session at a time, deterministic checks before model calls, and a simple file-based queue before introducing database/queue infrastructure.

Scenario code should remain provider-neutral. Scripted/mock adapters support deterministic tests; provider adapters may be added only in their authorized phases. Brain and voice remain separate contracts even when supplied by the same vendor.

### Security boundary

Future model capabilities must be allowlisted and validated by the controller: approved observation, click/type/scroll targets, speak, wait, issue reporting, and finish. No model receives shell, arbitrary filesystem editing, Git, Firebase, deployment, production, unknown-domain navigation, payment, or real child data access.

The exact-host HTTPS staging guard implemented in Phase 1 is a foundation primitive. Browser-level enforcement does not exist until Phase 2 is implemented and validated.
