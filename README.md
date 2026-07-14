# QA Lab

## Phase 10 Safety Lab + Cost–Quality–Latency Optimizer

Safety Lab trong `src/safety-lab.ts` là policy-contract fixture dùng schema/version và deterministic policy-first evaluator cho child safety, PII, boundary/manipulation/distress escalation, injection từ student text/web/image-metadata placeholder, tool/domain/shell/cloud/payment denial, và data/artifact redaction. Đây không phải real tutor red-team implementation. Structured actions phải qua allowlist trước controller; fixture chỉ dùng scripted/mock agent và dữ liệu tổng hợp được diễn đạt an toàn, không gọi harmful/live provider, staging hay production.

Optimizer trong `src/quality-optimizer.ts` là fixture algorithm foundation, không phải real provider-configuration optimizer. Nó áp constraints quality/p95 latency/cost/critical failure, giữ provenance `observed`/`estimated`/`unknown`, đưa required unknown về `NEEDS_REVIEW` thay vì giả zero, tính Pareto quality/latency/cost và ranking/tie deterministic. Cost formula v1 cùng assumptions được ghi rõ; routing simple turn/repeated confusion/vision board/verifier final/degraded text chỉ là proposal có evidence/limitations, không mutate provider config và không deploy.

Chạy `npm.cmd run qa:phase10:fixture`. Evidence JSON/Markdown nằm dưới ignored `runs/phase10-safety-optimizer-fixture-evidence/`. Framework Phase 0–10 đã được triển khai và kiểm chứng ở phạm vi local deterministic fixture, scripted brain, synthetic personas/WAV và provider-free replay. Real Gia Su AI staging acceptance là **NOT STARTED / NOT READY**. Staging browser/auth/reset, real providers/evaluators, native Linux voice và FFmpeg real recording đều cần task riêng. Production, real child data khi chưa có policy, auto-fix và deploy bị cấm.

## Phase 9 Model Arena + Synthetic Student Cohorts

Model Arena và cohorts được triển khai provider-free trong `src/model-arena.ts` và `src/synthetic-cohorts.ts`. Arena dùng config/version/hash vendor-neutral, cùng scenario/cohort/seed/rubric/build/evidence version, ít nhất hai scripted brain configurations với evaluator độc lập, hard-blocker exclusion, deterministic ranking/tie, reliability, consistency variance, và latency/cost provenance `observed`/`estimated`/`unknown`. Đây là internal fixture evidence, không phải marketing benchmark.

Golden cohort gồm ba persona cố định; exploratory cohort sinh sáu persona từ seed, bounded, PII-free, có đủ ability/misconception/behavior/communication/environment/learning psychology. `toStudentPersona` và `selectCohortPersonas` tích hợp contract Student QA mà không gọi provider. Chạy `npm.cmd run qa:arena:fixture`; evidence gồm `arena.json`, `report.md`, và `cohort-manifest.json` dưới ignored `runs/phase9-arena-cohort-fixture-evidence/`.

Provider thật, staging/production và dashboard không được triển khai.

## Phase 7 Education/UX Evaluation

Deterministic-first Education Eval is implemented in `src/education-eval.ts` with versioned input/result contracts, evidence/confidence/limitations, hard-blocker precedence, response/turn/whiteboard metrics, and `PASS` / `PASS_WITH_RISKS` / `FAIL` / `BLOCKED` / `NEEDS_REVIEW` policy. The first rubric is `rubrics/fractions-compare-unlike-denominators.yaml`. `UxEvaluator` is vendor-neutral, but only a scripted mock exists: no provider, key, or external model call. Scores are **NON_AUTHORITATIVE**, human calibration remains marked, and unknown product/model/prompt versions remain null rather than invented. Run `npm.cmd run qa:evaluation:fixture` for integrated Student artifact evidence.

## Phase 6 Voice Bridge

Voice Bridge là opt-in, vendor-neutral và mặc định tắt (`QA_ENABLE_VOICE=true` mới bật). Contracts `VoiceRequest`/`VoiceArtifact`, providers silent/text/deterministic WAV, external TTS interface không vendor/key, Linux PulseAudio/PipeWire probe, routing hai sink chống echo, Chromium microphone permission chỉ khi voice bật, text fallback, recorder audio metadata và deterministic one/multi-turn fixture đã có.

Chạy `npm.cmd run qa:voice:fixture`. Trên Windows hiện tại, native PulseAudio voice E2E là **BLOCKED**; fixture chỉ chứng minh synthetic WAV/media plumbing, không giả physical mic. Xem [`docs/VOICE_LINUX_SETUP.md`](docs/VOICE_LINUX_SETUP.md).

## Phase 4 Student QA text-mode MVP

Liệt kê cả Web QA và Student QA scenario bằng `npm.cmd run qa:list`. Chạy real-mode bằng `npm.cmd run qa:run -- --scenario weak-fractions-lesson`; khi thiếu staging target/account/reset, run trả `BLOCKED`, không giả PASS và không truy cập production. Chạy fixture tường minh bằng `npm.cmd run qa:student:fixture`.

Phase 4 có persona/scenario YAML typed + versioned, vendor-neutral `StudentBrain`, deterministic `ScriptedStudentBrain`, context 3–5 lượt, structured browser-only actions, lifecycle/limits, manual/stub reset boundary, `/lesson-mock` tám lượt, transcript/whiteboard/screenshot artifacts, deterministic checks, UX diary và report. Observed metrics và estimated UX scores được gắn nhãn riêng.

Không có provider thật, credential, Education Eval, replay, dashboard, deployment hay Phase 7+.

## Product authority

Founder strategy: [`docs/QA_LAB_PRODUCT_STRATEGY.md`](docs/QA_LAB_PRODUCT_STRATEGY.md). Delivery order: [`docs/ROADMAP.md`](docs/ROADMAP.md). Capability truth: [`docs/CAPABILITY_GAP_MAP.md`](docs/CAPABILITY_GAP_MAP.md). Authoritative Phase 0–10 system security model and future staging gates: [`docs/threat-model.md`](docs/threat-model.md). Governance: [`AGENTS.md`](AGENTS.md).

## Requirements and setup

- Windows 10-compatible environment
- Node.js 20+, npm, Git

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Real staging execution is not currently authorized or ready. A separate task must approve the exact staging hostname, dedicated test account, auth/reset integration, and acceptance procedure. Never add production, wildcard hosts, credentials in source, or arbitrary ports.

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
npm.cmd run qa:arena:fixture
npm.cmd run qa:phase10:fixture
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run validate
```

`qa:doctor` remains offline-friendly and does not contact staging or production. Fixture commands explicitly enable exact-port loopback mode and write ignored evidence under `runs/`.

### Deterministic test gate

`npm.cmd test` is the required full gate on Node.js 20+ (including audited Node.js 24 hosts). It runs every `*.test.ts` file exactly once in two sequential groups with `--test-concurrency=1`: `test:unit` contains pure/non-browser contract tests, then `test:browser` contains Playwright/browser fixture integration and E2E tests. Browser fixtures are therefore serial and bounded for Windows or resource-limited CI hosts; do not run full suites concurrently. Run the default gate twice sequentially when validating gate stability.

`qa:recording:fixture` is a capability probe, not part of `npm test`: missing FFmpeg must report `BLOCKED` and exit non-zero. That expected host limitation is not a fake overall PASS and must be reported separately from the deterministic test gate.

## Security model

The authoritative system threat model is [`docs/threat-model.md`](docs/threat-model.md). Staging navigation, redirects, popups, subresources, and WebSockets require exact normalized hostname membership and HTTPS/WSS. Fixture HTTP requires explicit loopback mode and exact ephemeral port. StudentBrain can propose only typed lesson input/click, bounded wait, issue report, or finish actions; it receives no shell, source, filesystem editing, Git, cloud console, arbitrary navigation, provider, voice, or deploy capability. Run artifacts are redacted and run paths are validated. Phase 10 Safety evidence is a contract fixture, not a real tutor red-team result.

See [`docs/threat-model.md`](docs/threat-model.md), [`docs/environment-audit.md`](docs/environment-audit.md), and [`STATUS.md`](STATUS.md).

## Phase 5 recording

Set QA_ENABLE_RECORDING=true to opt in. QA_FFMPEG_PATH may select FFmpeg. Missing FFmpeg yields truthful blocked recording plus screenshot/checkpoint fallback. PASS video is deleted early by default; FAIL/release video is retained. Phase 6 adds audio artifact metadata, but never claims an audio file unless it exists and is valid.
