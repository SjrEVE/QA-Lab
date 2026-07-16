# Sanitized evidence manifests

Raw `runs/` stay ignored because they may contain screenshots, browser events or account-adjacent data. A committed manifest contains only bounded provenance and SHA-256 digests; it is review evidence, not a replacement for the private artifacts.

[`GUIDED_SELF_STUDY_STAGING_MANIFEST.json`](GUIDED_SELF_STUDY_STAGING_MANIFEST.json) records the two historical guided-self-study staging runs. It explicitly leaves the product deployment version unknown because the old runner did not capture it, and it requires revalidation under the hardened Gemini-deny and per-request App Check policy.
