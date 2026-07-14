---
name: tutorproof-targeted-qa
description: Run or extend one explicitly requested TutorProof QA-Lab flow against an allowlisted staging target. Use for public web smoke, Firebase auth bootstrap, authenticated catalog checks, scoped staging reset, authenticated lesson session-start smoke, or a request to add another modular QA flow without running the entire suite.
---

# TutorProof Targeted QA

Run the smallest QA capability that answers the request. Treat every flow as an independent module; never chain all capabilities unless the user explicitly asks for a full suite.

## Start safely

1. Work from the QA-Lab repository root.
2. Read `AGENTS.md` and the governance files it requires before changing code or configuration.
3. Inspect `git status --short`; preserve unrelated work.
4. Confirm the typed staging profile, exact-host allowlist, verified private test profile, and requested scope. Never target production.
5. Do not print or commit email addresses, tokens, cookies, browser state, reset secrets, raw audio, or transcripts.

## Dispatch one flow

Map the request to exactly one command:

| Requested capability | Command |
| --- | --- |
| Public web smoke | `npm.cmd run qa:run -- --scenario <web-scenario-id>` |
| Google auth bootstrap or persistence | `npm.cmd run qa:auth` |
| Authenticated catalog and lesson continuity | `npm.cmd run qa:catalog -- --scenario <catalog-scenario-id>` |
| Scoped staging reset only | `npm.cmd run qa:reset -- --scope <allowlisted-scope>` |
| Authenticated G12 session start and clean stop | `npm.cmd run qa:session:start -- --scenario <session-scenario-id>` |
| Local capability diagnostics | `npm.cmd run qa:doctor` |

Do not substitute `npm test` or `npm run validate` for a requested staging flow. Those commands validate QA-Lab itself; they do not prove the staging capability.

## Run discipline

- Use only scenario IDs linked by `config/staging-profile.yaml`.
- Require the strict reset contract before a stateful journey. A manual or failed reset is `BLOCKED`, not `PASSED`.
- Use a synthetic silent microphone for session-start smoke. Stop as soon as the realtime connection reaches an accepted active state; do not send a student turn.
- Keep every run bounded by scenario timeouts and no-overwrite artifact directories under `runs/`.
- Preserve failed and blocked artifacts. Never overwrite evidence from an earlier run.
- Report `PASSED`, `FAILED`, and `BLOCKED` exactly as emitted. Provider billing, missing credentials, unavailable staging services, or required operator action are blockers; do not work around them.
- Do not deploy, mutate provider billing, switch API keys, or fix product code unless the user separately authorizes that action.

## Add a new modular flow

When the requested capability has no runner:

1. Add one typed YAML scenario with a distinct `type` and narrow scope.
2. Add one dedicated runner and CLI/package command. Do not add it to an implicit full-suite chain.
3. Reuse guarded browser, redaction, run-store, authentication verification, and strict reset primitives.
4. Add a positive fixture test and a negative boundary test proving safe refusal.
5. Run focused tests, `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run security:secrets`.
6. Update capability documentation only with evidence actually observed.

## Report evidence

State the scenario, target host, run ID, status, checks passed, exact blocker or issue category, artifact directory, and scope limits. A session-start pass proves only authenticated creation, provider connection, and clean stop; it does not accept pedagogy, voice quality, whiteboard behavior, verifier, mastery, OCR, or an end-to-end student journey.
