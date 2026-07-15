# Gemini StudentBrain

Gemini StudentBrain is an optional, provider-backed student decision adapter. It receives only a bounded synthetic persona state and the latest 3–5 lesson turns. It returns a strict decision that is validated again by QA Lab before any browser or voice action.

## Authority boundary

- The brain may speak Vietnamese, wait, or finish a bounded scenario.
- The brain cannot navigate, call shell/Git/Firebase/deployment, read files, change policy, or declare final PASS/FAIL.
- Tutor/page text is untrusted observation data and cannot add tools.
- The brain does not receive answer keys, server rubrics, source code, tokens, raw audio, images, cookies, or account identity.
- Deterministic rules, verifier evidence, latency checks and an independent evaluator remain authoritative.

## Secret handling

Use a separate Gemini key for QA Lab. Never paste it into chat, source, scenario YAML, `.env.example`, browser code or artifacts. Load it into one PowerShell process with a hidden prompt:

```powershell
$secure = Read-Host "Nhập Gemini API key cho QA Brain" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:QA_BRAIN_GEMINI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
$env:QA_ENABLE_REAL_BRAIN = "true"
npm.cmd run qa:brain:doctor
```

The doctor makes one bounded provider request and prints only readiness, model/version, latency and action kinds. It does not print the key, student speech or raw provider response.

Remove the key after the test:

```powershell
Remove-Item Env:QA_BRAIN_GEMINI_API_KEY
Remove-Item Env:QA_ENABLE_REAL_BRAIN
```

## Model and API contract

The default is stable `gemini-2.5-flash-lite`, selected for low-latency structured decisions. The adapter uses the official HTTPS Gemini endpoint, sends the key only in `x-goog-api-key`, refuses redirects, limits response size and timeout, and validates the final JSON with Zod. Model output never executes directly.

Official references:

- [Gemini 2.5 Flash-Lite model contract](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite)
- [Generate Content structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Gemini API key handling](https://ai.google.dev/gemini-api/docs/api-key)

Passing the doctor proves only that the GeminiBrain adapter is reachable and emits a valid bounded decision. It does not prove Live voice routing, whiteboard behavior, teaching quality, staging acceptance or production readiness.

For an approved text-mode Student QA scenario, the same validated Vietnamese turn can be projected only to the fixed lesson input and send controls:

```powershell
npm.cmd run qa:run -- --scenario weak-fractions-lesson --brain gemini
```

That command still obeys the scenario's target, reset, host, turn and time limits. It returns `BLOCKED` rather than bypassing a missing staging reset or using another environment. A voice-mode decision is never silently executed by the text-only runner.

## Visible two-AI staging session

After the doctor passes, the approved Gia Sư AI staging profile can run a visible Grade 12 Live session:

```powershell
npm.cmd run qa:live:brain
```

For every final tutor turn, Gemini StudentBrain creates one bounded Vietnamese student response. The browser reads that response aloud so the operator can hear it, then sends the identical response through the lesson text control. The product microphone receives an isolated silent stream to avoid duplicate input. The run records setup, Brain, audible speech, tutor-response and whiteboard latency/count metrics without persisting raw transcript, raw audio, account identity, key or provider response.

This hybrid visible run evaluates two-AI turn-taking, teaching response, latency and whiteboard behavior. It explicitly does **not** validate microphone speech recognition; a separate voice-routing/ASR run is still required for that claim.
