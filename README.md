# QA Lab

## Phase 6 Voice Bridge

Voice Bridge là opt-in, vendor-neutral và mặc định tắt (`QA_ENABLE_VOICE=true` mới bật). Contracts `VoiceRequest`/`VoiceArtifact`, providers silent/text/deterministic WAV, external TTS interface không vendor/key, Linux PulseAudio/PipeWire probe, routing hai sink chống echo, Chromium microphone permission chỉ khi voice bật, text fallback, recorder audio metadata và deterministic one/multi-turn fixture đã có.

Chạy `npm.cmd run qa:voice:fixture`. Trên Windows hiện tại, native PulseAudio voice E2E là **BLOCKED**; fixture chỉ chứng minh synthetic WAV/media plumbing, không giả physical mic. Xem [`docs/VOICE_LINUX_SETUP.md`](docs/VOICE_LINUX_SETUP.md).

## Phase 4 Student QA text-mode MVP

Liệt kê cả Web QA và Student QA scenario bằng `npm.cmd run qa:list`. Chạy real-mode bằng `npm.cmd run qa:run -- --scenario weak-fractions-lesson`; khi thiếu staging target/account/reset, run trả `BLOCKED`, không giả PASS và không truy cập production. Chạy fixture tường minh bằng `npm.cmd run qa:student:fixture`.

Phase 4 có persona/scenario YAML typed + versioned, vendor-neutral `StudentBrain`, deterministic `ScriptedStudentBrain`, context 3–5 lượt, structured browser-only actions, lifecycle/limits, manual/stub reset boundary, `/lesson-mock` tám lượt, transcript/whiteboard/screenshot artifacts, deterministic checks, UX diary và report. Observed metrics và estimated UX scores được gắn nhãn riêng.

Không có provider thật, credential, Education Eval, replay, dashboard, deployment hay Phase 7+.

## Product authority

Founder strategy: [`docs/QA_LAB_PRODUCT_STRATEGY.md`](docs/QA_LAB_PRODUCT_STRATEGY.md). Delivery order: [`docs/ROADMAP.md`](docs/ROADMAP.md). Capability truth: [`docs/CAPABILITY_GAP_MAP.md`](docs/CAPABILITY_GAP_MAP.md). Governance: [`AGENTS.md`](AGENTS.md).

## Requirements and setup

- Windows 10-compatible environment
- Node.js 20+, npm, Git

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Before real staging execution, configure only the exact approved staging hostname and dedicated test account/reset integration. Never add production, wildcard hosts, credentials in source, or arbitrary ports.

## Commands

```powershell
npm.cmd run qa:status
npm.cmd run qa:doctor
npm.cmd run qa:list
npm.cmd run qa:run -- --scenario weak-fractions-lesson
npm.cmd run qa:browser:fixture
npm.cmd run qa:web:fixture
npm.cmd run qa:student:fixture
npm.cmd run qa:recording:fixture
npm.cmd run qa:voice:fixture
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run validate
```

`qa:doctor` remains offline-friendly and does not contact staging or production. Fixture commands explicitly enable exact-port loopback mode and write ignored evidence under `runs/`.

## Security model

Staging navigation, redirects, subresources, and WebSockets require exact normalized hostname membership and HTTPS/WSS. Fixture HTTP requires explicit loopback mode and exact ephemeral port. StudentBrain can propose only typed lesson input/click, bounded wait, issue report, or finish actions; it receives no shell, source, filesystem editing, Git, cloud console, arbitrary navigation, provider, voice, or deploy capability. Run artifacts are redacted and run paths are validated.

See [`docs/threat-model.md`](docs/threat-model.md), [`docs/environment-audit.md`](docs/environment-audit.md), and [`STATUS.md`](STATUS.md).

## Phase 5 recording

Set QA_ENABLE_RECORDING=true to opt in. QA_FFMPEG_PATH may select FFmpeg. Missing FFmpeg yields truthful blocked recording plus screenshot/checkpoint fallback. PASS video is deleted early by default; FAIL/release video is retained. Phase 6 adds audio artifact metadata, but never claims an audio file unless it exists and is valid.
