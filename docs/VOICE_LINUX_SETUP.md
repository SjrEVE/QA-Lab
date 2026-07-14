# Phase 6 Voice Bridge — Linux VPS setup

## Safety boundary

Voice is off unless `QA_ENABLE_VOICE=true`. Keep text input enabled as fallback. Use a dedicated non-production Linux QA account and approved staging target. Do not use child recordings, physical microphones, production, or provider keys in source/config/artifacts.

The setup script creates only two null sinks. It does not install packages, change defaults, kill/restart servers, unload modules, create loopbacks, or run automatically.

## Prerequisites

- Node.js 20+, Playwright Chromium, and a user-session PulseAudio server or PipeWire with `pipewire-pulse`.
- `pactl` available to the QA user.
- Optional FFmpeg for combined recording; absence must remain `BLOCKED`, never a false audio claim.
- Chromium must run in the same user/session where `pactl info` succeeds.

## Setup

1. Inspect without changing state: `pactl info`, `pactl list short sinks`, `pactl list short sources`, and `pactl list short modules`.
2. Review `scripts/setup-linux-audio.sh`.
3. Run it explicitly: `bash scripts/setup-linux-audio.sh`.
4. Re-run safely to confirm idempotency.
5. Run `npm run qa:doctor`; require both sinks, both monitors, and `echo_isolated=true`.

Routing contract:

- Voice provider/TTS/WAV playback -> `student_audio`.
- Chromium microphone -> `student_audio.monitor`.
- Chromium/tutor output -> `tutor_audio`.
- Tutor capture -> `tutor_audio.monitor`.
- Never loop `tutor_audio.monitor` to `student_audio`, nor `student_audio.monitor` to `tutor_audio`.

For a process-scoped Pulse client, set `PULSE_SINK=tutor_audio` when launching Chromium. Select the microphone source through the browser/session policy as `student_audio.monitor`; do not change the user's global defaults. Fixture tests may use Chromium's `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, and `--use-file-for-fake-audio-capture=<approved synthetic WAV>` flags. Those flags prove synthetic media plumbing only, not a physical microphone.

## Validation and troubleshooting

- Run `npm run qa:voice:fixture` for deterministic WAV one-turn/multi-turn evidence.
- Native E2E is permitted only when doctor reports routing available. Otherwise report `BLOCKED` while preserving text mode.
- If a monitor is missing, inspect null-sink creation; do not add a loopback.
- If echo is detected, stop the run and manually inspect modules. The script intentionally refuses to remove modules.
- Audio metadata may list student/tutor roles, sources, duration, and limitations. A file is `available` only after it exists and passes WAV validation; otherwise file remains null/unavailable.

## Cleanup

The script does not unload modules because doing so could disrupt a shared user session. On a dedicated disposable VPS session, an operator may inspect module IDs with `pactl list short modules` and unload only IDs they have verified were created for QA Lab. This is deliberately manual and must not be automated by the test runner.
