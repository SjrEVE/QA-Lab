# QA Lab — Future Architecture Decisions

> Preserved Founder direction for development after Phase 1. This document is planning context only. Browser automation, voice, recording, dashboards, model providers, deployment, and production access are explicitly out of scope for Phase 0–1.

## Core principle

QA Lab must not depend on Hermes. Hermes is an optional brain/provider and a specialized Student QA runner, never the whole system. The QA Controller selects bounded scenarios before invoking any agent. Models propose typed actions; policy validates them; deterministic executors perform them.

```text
QA Lab Core / QA Controller
├── Scenario engine / risk-based selector
├── Web Smoke Runner (fast, deterministic)
├── Visual/Copy Runner (layout, copy, responsive)
├── Student UX Runner (Hermes or another brain as student)
├── Browser driver (future Playwright adapter)
├── Brain adapters (Scripted, Gemini, Claude, OpenAI, Hermes)
├── Voice adapter (future Gemini Live/TTS or equivalent)
├── Rule evaluator (hard failures)
├── Independent AI UX evaluator (subjective review)
├── Artifact store
└── Report, regression, and issue deduplication
```

Codex is a technical investigator after an issue is confirmed: inspect artifacts/source/diff, identify root cause, and prepare a repair task. It is not the preferred student persona brain. Gemini is the preferred initial Student QA brain; Claude or Gemini may review UX independently. Scripted/Mock brains support cheap deterministic regression.

## Input contract and scenario selection

A run receives bounded metadata such as staging base URL, build ID, commit, changed areas, and run mode. The Controller—not Hermes—selects scenarios based on changed areas. A parent-report-only change must not trigger a 30-minute student lesson; whiteboard/Gemini Live/runtime changes may trigger relevant student, reconnect, and cleanup scenarios.

Models must not discover arbitrary test scope. Every scenario has explicit goals, deterministic persona behavior where possible, stop conditions, maximum duration/turns/failures, and terminal status:

```text
COMPLETED | FAILED | BLOCKED | TIMED_OUT | APP_CRASHED
```

## Three test tiers

1. **Fast Gate** — after every staging deploy; deterministic checks only; target a few minutes. Check availability, login, primary APIs, lesson start, key controls, severe console errors, responsive layout, and microphone permission flow. If this fails, stop before paid Student QA.
2. **Focused UX** — for UI, copy, whiteboard, or lesson-flow changes; target 5–10 minutes. Check layout, responsive behavior, copy, CTA, animation, loading, navigation, basic accessibility, and screenshot comparison. Deterministic checks precede AI vision.
3. **Student Session** — only for lesson runtime, prompt, voice, whiteboard, mastery, exercise changes, nightly, or release runs. Hermes/Gemini/Claude may act as a student for bounded 10–30 minute scenarios and must not modify code.

## Student QA lifecycle

1. Reset a test student account.
2. Reuse a dedicated authenticated staging browser profile.
3. Open the exact approved lesson scenario.
4. Verify microphone, audio, and transcript readiness.
5. Consume the latest final tutor transcript/event.
6. Decide a bounded student reaction from persona/scenario state.
7. Use the voice bridge when required.
8. Record transcript, whiteboard events, latency, and decisions.
9. Continue until scenario goal or hard stop.
10. Evaluate independently, write report, and clean up session.

Only minimal state should reach the brain: persona, goals, latest final tutor turn, current problem state, 3–5 recent turns, current misconception, understanding level, used behaviors, and remaining goals. Do not repeatedly send a full long transcript. Invoke a student brain on final tutor-turn events, not by frequent polling.

## Observation priority

Prefer, in order:

1. DOM/accessibility tree.
2. Transcript events.
3. Whiteboard debug events.
4. Screenshots at checkpoints.
5. Vision only when visual judgment is needed.

Checkpoint images include lesson start, major board change, error, activity end, and final screen. Structured timestamps should measure delays without requiring continuous visual inference.

## Student and evaluator separation

The student actor emits a diary (understanding, clarity, smoothness, reason) but cannot decide the entire verdict. An independent evaluator consumes transcript, timestamps, board events, console/network logs, screenshots, student diary, and final exercise outcome.

Verdicts:

```text
PASS | PASS_WITH_RISKS | FAIL | NEEDS_REVIEW
```

Rule evaluation runs first for crashes, latency, overlap, missing transcript, and request failures. AI evaluates subjective teaching, age appropriateness, copy, and UX. AI may not override a hard failure such as a WebSocket crash.

## Run modes

- **post-deploy:** Fast Gate plus scenarios selected from changed areas; no full lesson by default.
- **nightly:** all Web QA plus 2–3 student personas and one short lesson per persona; regression comparison.
- **release:** critical flows/viewports, multiple personas, voice, reconnect, 20–30 minute lessons, parent report, usage/session cleanup.
- **manual:** explicit scenario/persona/duration/recording flags.

Start with five high-value personas: weak/common misconception, average/moderate hints, strong/fast, distracted, and communication difficulty. Persona plans remain partly deterministic; AI naturalizes wording but cannot invent all behavior.

## Artifacts and retention

Each future run may produce:

```text
runs/<run-id>/
├── summary.json
├── report.md
├── issues.json
├── transcript.jsonl
├── student-turns.jsonl
├── metrics.json
├── console.jsonl
├── network.jsonl
├── screenshots/
└── session.mp4
```

Retain minimal summaries/metrics/checkpoint images for passing runs and delete video after a short period. Retain full evidence for failures and longer for release runs. Default recording policy should be retain-on-failure.

## Regression and issue deduplication

Fingerprint issues using category, route, element, normalized error, and scenario. Aggregate occurrences and affected runs instead of spamming duplicates. Classify each run's issue state as:

```text
NEW | PERSISTING | REGRESSED | RESOLVED | FLAKY
```

Repair flow: deploy staging build A, detect issue, Codex verifies code/artifacts, coder repairs, deploy build B, rerun Fast Gate plus the failing and related regression scenarios. Stop after `maxRepairCycles: 3` and mark `NEEDS_HUMAN_REVIEW`.

## Performance and resource policy

Reuse one browser process/profile across sequential scenarios; reset app state rather than the VPS. Login once with a dedicated staging profile. Use deterministic Web QA instead of Hermes. Capture vision/video only when necessary. Use cheap/fast models for simple behavior, stronger models for final UX review, and no model for deterministic checks.

Initial concurrency target:

```text
1 browser
1 student voice session at a time
2–4 deterministic Web QA workers
```

The resource controller observes CPU, RAM, disk, browser processes, audio sinks, and active sessions. Queue additional student voice runs with a simple file-based queue (`pending`, `running`, `completed`) before considering Redis/SQLite.

## Provider-neutral brain contract

Scenario code must not depend on a model provider. A brain returns a typed decision such as click, type, speak, wait, report issue, or finish. The Controller validates targets, domains, limits, and permissions before execution.

Future adapters:

```text
ScriptedBrain
MockBrain
GeminiBrain
ClaudeBrain
OpenAIBrain
HermesBrain
```

Recommended initial split:

```text
Playwright smoke → Gemini student → Claude independent UX evaluation
→ hard rule evaluation → regression/dedup → report
→ Codex technical investigation → coder repair → targeted retest
```

Brain and voice should remain separate even if both use Gemini, so failures are debuggable and behavior remains more deterministic.

## Security boundaries

A model may receive only allowlisted capabilities: observe approved DOM/screenshot/transcript, click/type/scroll on approved targets, speak, wait, report an issue, and finish a scenario. It must not receive shell, filesystem editing, Git, Firebase, deployment, production, arbitrary navigation, or unknown-domain access. Exact-host HTTPS staging enforcement belongs in the Controller before any future driver/provider executes an action.

## Delivery order

Phase 0–1 deliver only local foundation, typed/versioned configuration, guards, safe run/artifact primitives, redaction/logging, CLI status, offline-friendly doctor, documentation, and tests. Future phases may add deterministic browser runners first, then focused UX, then bounded Student QA/providers/voice, then regression/reporting maturity. A dashboard is deferred until run data is stable; a clear CLI is sufficient initially.
