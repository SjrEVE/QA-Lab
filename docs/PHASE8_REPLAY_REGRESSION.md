# Phase 8 — Replay & Regression Engine

## Scope

Phase 8 provides offline, provider-free replay and artifact comparison. It does not call real models, run Model Arena/cohorts, access staging/production, display a dashboard, or modify/fix product code.

## Unified timeline

`timeline.jsonl` schema version 1 records ordered events from `browser`, `tutor`, `student`, `whiteboard`, `evaluation`, and `checkpoint` sources. Every row contains sequence, session-relative `timestampMs`, scenario ID, event name, optional route/turn, and redacted structured data.

The writer rejects decreasing timestamps. The loader rejects empty/missing files, corrupt JSON, unknown versions, invalid rows, sequence gaps/reordering, and decreasing timestamps. Payloads pass through recursive secret redaction before writing.

Web QA emits this timeline directly. Existing Student `tutor-turns.jsonl`, `student-turns.jsonl`, and `whiteboard-events.jsonl` remain recorded source evidence and can be normalized without changing Student browser, voice, recording, or evaluation behavior.

## Replay

Modes:

- `same-session-fixture`: replays every recorded event on the current deterministic fixture runner representation.
- `transcript-action`: replays tutor/student/whiteboard and allowlisted recorded browser actions.

Replay is an event interpreter: it does not invoke brain, tutor, voice, evaluator, or other providers. Identical input and mode produce the same SHA-256 digest. Missing/corrupt/version-mismatched/inconsistent input fails closed.

```powershell
npm.cmd run qa:replay -- --run <run-id> --mode same-session-fixture
npm.cmd run qa:replay:fixture
```

## Baseline comparison

Selectors are validated run IDs or relative paths resolved below the configured artifact root. Absolute paths, empty/dot/traversal segments, backslash variants, and any resolved escape are rejected.

```powershell
npm.cmd run qa:compare -- --baseline <baseline-run-id> --candidate <candidate-run-id>
```

Issue fingerprint input is category + route + element + normalized error + scenario. Volatile numbers, IDs, URLs, case, and whitespace are normalized. Duplicate fingerprints within one run collapse before lifecycle classification:

- `NEW`: candidate only.
- `PERSISTING`: present in both.
- `RESOLVED`: baseline only.
- `REGRESSED`: a previously resolved fingerprint returned.
- `FLAKY`: either artifact explicitly marks it flaky; it is never silently treated as fixed.

Every issue delta retains explicit baseline/candidate evidence references or explicit absence. Metric deltas include baseline, candidate, delta, threshold, direction, regression decision, and observed/estimated quality.

Outputs are written exclusively and never overwrite existing evidence:

- `regression.json`
- `regression-summary.json`
- `regression-delta.md`

## Incident packaging

The incident packaging interface accepts only `anonymized: true` packages, recursively redacts secrets, and rejects fields representing raw child identity, audio, image, or transcript data. Packages contain normalized issue/scenario facts, bounded structured decisions, expected behavior, and artifact references only.

## Fixture evidence

`npm.cmd run qa:regression:fixture` creates ignored local baseline/candidate timelines, issues and metrics, comparison reports, and deterministic replay digest under `runs/phase8-regression-fixture-evidence/`. This is local fixture evidence, not staging or provider acceptance.
