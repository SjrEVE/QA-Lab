# Phase 1 Threat Model

## Assets

- Staging host policy and configuration integrity.
- Future QA run status and local artifacts.
- Credentials that may be introduced in later phases.
- Operator workstation and unrelated repositories.
- Trustworthiness of logs and QA evidence.

## Trust boundaries

1. Environment variables and YAML are untrusted operator input until schema validation.
2. URLs are untrusted until HTTPS and exact-host authorization succeeds.
3. Run IDs and artifact names are untrusted until safe-segment validation.
4. Log payloads are untrusted and may contain nested secrets or cycles.
5. Optional tools and network availability cannot be assumed.
6. Future model output is untrusted and must pass typed policy checks before any executor sees it.

## Threats and Phase 1 mitigations

| Threat | Mitigation |
|---|---|
| Accidental production access | No production capability; exact-host HTTPS allowlist; placeholder `.invalid` host; fail closed |
| Host suffix/subdomain confusion | Equality against normalized `URL.hostname`; no suffix, wildcard, substring, or redirect trust |
| HTTP downgrade or alternate port | Require `https:` and port empty/443 |
| URL credential leakage | Reject username/password in URL |
| Path traversal | Restrict run IDs and artifact filenames to safe single segments; verify resolved parent |
| Artifact overwrite/race | Exclusive directory creation and `wx` file writes |
| Secret leakage in logs | Recursive sensitive-key and inline token redaction; circular-reference handling |
| Config drift | Literal schema version and strict unknown-key rejection |
| External repo contamination | Repository rule forbids reading/inheriting unrelated source/config/secrets |
| Offline diagnosis failure | Required local checks separated from optional-tool warnings; no network probe |
| Agent overreach | No browser/voice/deploy/model provider in Phase 1; future actions require allowlisted typed policy |

## Known residual risks

- Secret redaction is defense in depth, not permission to log credentials; novel secret formats may evade pattern matching.
- Local users with filesystem access can read artifacts. Encryption and OS ACL hardening are future decisions.
- Symlink/reparse-point attacks require additional hardening before accepting hostile local artifact roots.
- DNS rebinding and redirect policy become relevant only when a future network/browser executor is added; authorization must be rechecked at navigation boundaries.
- Disk exhaustion controls are deferred until larger artifacts/recording are approved.
