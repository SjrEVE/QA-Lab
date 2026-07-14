# QA LAB

## Chiến lược sản phẩm, kiến trúc và mô hình vận hành

**Phòng kiểm định gia sư AI và nền tảng đánh giá synthetic-user cho voice agents**

> **Authority:** Tài liệu chiến lược sản phẩm chính thức do Founder cung cấp.
>
> **Ngày:** 14/07/2026
>
> Khi tài liệu supporting/planning khác mâu thuẫn, tài liệu này kiểm soát product intent và thứ tự roadmap.

## 0. Tóm tắt điều hành

### Tuyên ngôn thiết kế

QA Lab không phải “AI Selenium”. Nó là hệ điều hành đánh giá, mô phỏng và cải tiến các sản phẩm AI tương tác với con người.

### Kết luận chiến lược

Nên xây QA Lab như một sản phẩm nội bộ độc lập, vendor-neutral, thay được Hermes, Gemini, Claude hoặc Codex. Playwright và rule engine xử lý phần chắc chắn; model chỉ dùng ở những nơi cần “não học sinh”, vision, hoặc đánh giá UX có sắc thái.

QA Lab có hai nhiệm vụ cốt lõi:

1. Bắt lỗi chức năng, UI, chữ, bố cục, responsive, console và network như một hệ QA web chuẩn.
2. Cho học sinh giả lập vào học thật để đánh giá voice, bảng trắng, cách dạy, nhịp học, độ dễ hiểu và khả năng thích ứng của gia sư AI.

Lợi thế dài hạn không nằm ở khả năng “mở trình duyệt và bấm nút”, vì năng lực đó sẽ nhanh chóng trở thành hàng phổ thông. Lợi thế phải nằm ở:

- Education Eval Spec: bộ tiêu chí riêng để định nghĩa một buổi học tốt.
- Unified event timeline và deterministic replay: tái hiện đúng phiên lỗi trên build/model/prompt mới.
- Incident → regression: biến lỗi thật thành bài test vĩnh viễn.
- Model Arena: cho nhiều cấu hình gia sư thi đấu trên cùng scenario.
- Synthetic student cohort: quần thể học sinh giả lập có kiểm soát.
- Cost–Quality–Latency optimizer: tìm cấu hình đạt chất lượng với chi phí thấp nhất.
- Safety Lab: kiểm thử child safety, PII, prompt injection và escalation.

### Thứ tự ưu tiên

Foundation → Browser → Web QA → Student text QA → Recording → Voice → Education Eval → Replay/Regression → Model Arena → Synthetic Cohorts → Safety/Optimization.

Các phần 1–22 và phụ lục A–D bên dưới là nội dung đầy đủ của chiến lược.

## 1. Tầm nhìn và định vị

| Định vị“Phòng kiểm định gia sư AI: cho hàng nghìn học sinh giả lập vào học, phát hiện khoảnh khắc dạy tệ, replay được lỗi và chứng minh phiên bản mới thực sự dạy tốt hơn.” |
| --- |

QA Lab là sản phẩm nội bộ thứ ba, độc lập với K12 Tutor và Con Nói Tiếng Việt. Nó nhìn sản phẩm từ bên ngoài giống người dùng thật, không nằm trong runtime của sản phẩm và không có quyền production.

| Thành phần | Vai trò |
| --- | --- |
| K12 Tutor | Sản phẩm gia sư AI học theo chương trình K12. |
| Con Nói Tiếng Việt | Sản phẩm luyện nói tiếng Việt theo tình huống. |
| QA Lab | Hệ thống đánh giá, mô phỏng, replay và regression cho cả hai sản phẩm và các voice agent tương lai. |

Moat công nghệ mục tiêu:

Dữ liệu phiên học lỗi và cách sửa.

Rubric giáo dục cụ thể theo skill/subskill.

Benchmark riêng dựa trên persona, transcript, voice và whiteboard.

Khả năng so sánh model/prompt/policy bằng cùng một scenario.

Bộ regression từ lỗi thật, không chỉ test giả lập chung chung.

## 2. Nguyên tắc thiết kế

| Nguyên tắc | Ý nghĩa |
| --- | --- |
| Deterministic trước, AI sau | Dùng code/rule cho crash, latency, console, network, state và đáp án. Chỉ dùng model cho copy, độ tự nhiên, mức dễ hiểu và UX có sắc thái. |
| Browser-only runtime | Web QA và Student QA chỉ được dùng browser, tài khoản test và thư mục artifact. Không có shell, source code, cloud console hoặc production. |
| Vendor-neutral | Scenario và core runner không biết đang dùng Gemini, Claude, OpenAI hay Hermes. Provider chỉ là adapter. |
| Tách người diễn và người chấm | StudentBrain không được là final judge duy nhất. Rule engine và evaluator độc lập mới quyết định trạng thái. |
| Evidence-first | Mọi issue phải có timestamp, screenshot/video, transcript, DOM/event, console hoặc network evidence. |
| Risk-based execution | Không chạy lesson 30 phút sau mọi commit. Chỉ chọn scenario dựa trên vùng thay đổi. |
| Replay được | Một phiên lỗi phải có thể chạy lại trên build/model/prompt mới. |
| Human retains production control | AI có thể test, chấm và điều tra; con người giữ merge, deploy production và quyền dữ liệu thật. |

## 3. Kiến trúc tổng thể vendor-neutral

| QA Lab Core├── Scenario Engine├── Risk-based Scenario Selector├── Browser Driver (Playwright/CDP)├── Brain Adapter (Gemini / Claude / OpenAI / Hermes / Scripted)├── Voice Adapter (Gemini Live / TTS / WAV / Mock)├── Recorder (FFmpeg + audio routing)├── Rule Evaluator├── AI UX Evaluator├── Unified Event Timeline├── Replay & Regression Engine├── Artifact Store└── Report / Model Arena / Cost Optimizer |
| --- |

| Thành phần | Vai trò |
| --- | --- |
| Scenario Engine | Định nghĩa flow, persona, mục tiêu, stop condition, checks và timeout. |
| Scenario Selector | Chọn test dựa trên vùng code hoặc feature vừa thay đổi. |
| Browser Driver | Mở trang, click, type, scroll, snapshot, screenshot, console và network. |
| Brain Adapter | Sinh quyết định có cấu trúc; không được toàn quyền điều khiển máy. |
| Voice Adapter | Biến text của học sinh thành audio đưa vào microphone ảo. |
| Recorder | Ghi hình, audio, timestamps và checkpoint. |
| Rule Evaluator | Chấm lỗi cứng và metrics. |
| AI UX Evaluator | Chấm độ dễ hiểu, tự nhiên, hấp dẫn, phù hợp độ tuổi. |
| Timeline/Replay | Chuẩn hóa event và tái hiện phiên cũ. |
| Artifact/Report | Lưu bằng chứng, deduplicate issue, so sánh regression. |

## 4. Phân vai agent và lựa chọn “bộ não”

| Provider | Vai trò phù hợp | Không nên dùng làm |
| --- | --- | --- |
| Gemini | StudentBrain, multimodal review, voice/TTS, Computer Use khi cần. | Final technical investigator duy nhất hoặc tự chấm chính mình. |
| Claude | UX exploratory, copy/layout review, browser reasoning, evaluator độc lập. | Voice engine mặc định; cần TTS ngoài. |
| Codex | Root-cause investigation, đọc source/diff, tạo task sửa, verify patch. | Học sinh giả lập dài hạn hoặc voice persona. |
| Hermes | Provider tùy chọn, orchestration nhanh khi đã có browser skill. | Nền tảng bắt buộc của toàn QA Lab. |
| Scripted/Mock | Regression nhanh, deterministic, rẻ, CI. | Đánh giá UX có sắc thái. |

| Cấu hình khuyến nghịStudent QA: GeminiBrain + Gemini Live/TTS + Playwright. Web UX QA: Playwright + Claude/Gemini Vision. Technical investigation: Codex. Final pass/fail: Rule Engine + evaluator độc lập. |
| --- |

Interface quyết định đề xuất:

| type BrainDecision =  \| { action: "click"; target: BrowserTarget }  \| { action: "type"; target: BrowserTarget; text: string }  \| { action: "speak"; text: string; emotion?: string }  \| { action: "wait"; durationMs: number }  \| { action: "report_issue"; issue: IssueDraft }  \| { action: "finish"; reason: string }; |
| --- |

## 5. Mô hình vận hành hiệu quả

| DEPLOY STAGING      ↓FAST GATE      ↓ passRISK-BASED SCENARIO SELECTOR      ↓WEB QA / STUDENT QA      ↓RULE EVALUATION      ↓AI UX EVALUATION      ↓REGRESSION + DEDUP      ↓REPORT      ↓CODEX INVESTIGATION      ↓GEMINI/DEV FIX      ↓TARGETED RETEST |
| --- |

| Cấp test | Khi chạy | Mục tiêu |
| --- | --- | --- |
| Fast Gate | Sau mọi staging deploy | 2–5 phút; login, route, API chính, lesson start, console/network, layout chính. |
| Focused UX | Khi đổi UI/copy/whiteboard/lesson flow | 5–10 phút; bố cục, chữ, responsive, loading, whiteboard checkpoint. |
| Student Session | Khi đổi prompt, voice, runtime, mastery, exercise; nightly/release | 10–30 phút; voice, cách dạy, bảng trắng, UX, independent check. |

Nguyên tắc tiết kiệm thời gian và chi phí:

Fast Gate fail thì dừng, không gọi StudentBrain.

Giữ một browser/profile sống giữa nhiều scenario tuần tự.

Chỉ gọi StudentBrain khi có tutor_turn_final, không polling mỗi giây.

Ưu tiên DOM/event trước screenshot/vision.

Chỉ quay video đầy đủ cho failure hoặc release run.

Rerun targeted scenario sau patch, không chạy toàn bộ suite.

## 6. Web QA Runner

Web QA không học bài. Nó kiểm chức năng web và chất lượng trình bày như một QA tester chuẩn.

| Nhóm | Kiểm tra chính | Cách chấm |
| --- | --- | --- |
| Functional | Login, logout, button, form, navigation, loading/empty/error, reload/back/reconnect. | Playwright assertions và state checks. |
| Copy | Typo, câu khó hiểu, CTA mơ hồ, tiếng Việt/Anh lẫn lộn. | Dictionary/rule + AI reviewer. |
| Layout | Overflow, overlap, clipping, modal ngoài viewport, footer che content. | DOM geometry + screenshot checkpoint. |
| Responsive | Mobile/tablet/laptop/desktop, breakpoint, menu, font scaling. | Viewport matrix. |
| Accessibility | Role/name, label, focus, heading, alt, focus trap. | Accessibility tree + rule checks. |
| Runtime | Console error, unhandled rejection, 4xx/5xx, asset failure. | Browser events/network logs. |

Viewport khuyến nghị:

| mobile-small:    360 × 800mobile-common:   390 × 844tablet:          768 × 1024laptop:          1366 × 768desktop:         1920 × 1080 |
| --- |

## 7. Student QA Runner

Student QA đóng vai học sinh, vào lesson bằng tài khoản test và ghi lại UX trong ngữ cảnh học thật. Nó không kiểm toàn bộ website và không được sửa code.

| Khu vực | Nội dung đánh giá |
| --- | --- |
| Voice/turn-taking | Nhận đúng giọng, transcript, latency, barge-in, nói đè, dead air, reconnect. |
| Teaching clarity | Phù hợp độ tuổi, hint tăng dần, không lộ đáp án, đổi cách giải thích. |
| Whiteboard UX | Đúng lúc, đồng bộ lời nói, dễ đọc, không giật/chồng/nhấp nháy. |
| Lesson pacing | Không quá nhanh/chậm, học sinh biết bước tiếp theo. |
| Copy & tone | Tự nhiên, không typo, không từ quá người lớn, không lặp hoặc lan man. |
| Learning outcome | Cuối buổi có independent check và học sinh tự làm được. |

State tối thiểu gửi vào StudentBrain mỗi lượt:

| {  "persona": "weak-fractions-grade-4",  "turn": 8,  "understanding": 2,  "currentMisconception": "numerator_denominator",  "alreadyUsed": ["silence_once", "off_topic_once"],  "remainingGoals": ["trigger_second_explanation", "independent_check"],  "recentTurns": 4} |
| --- |

| Tối ưu quan trọngKhông gửi toàn bộ transcript 30 phút vào mỗi lượt. Chỉ giữ 3–5 lượt gần nhất, misconception hiện tại, mức hiểu, hành vi đã dùng và mục tiêu còn lại. |
| --- |

## 8. Unified Event Timeline, Replay và Incident Regression

Mỗi phiên phải được ghi thành timeline chuẩn để có thể replay chính xác. Đây là “máy quay thời gian” của QA Lab.

| {  "timestampMs": 18200,  "event": "tutor_turn_final",  "text": "Con hãy nhìn tử số ở phía trên.",  "model": "provider/model-version",  "promptVersion": "teaching-policy-v12",  "whiteboardState": "fraction-1-over-3",  "latencyMs": 1280} |
| --- |

Replay cần hỗ trợ:

Cùng phiên lỗi trên build mới.

Cùng scenario trên model khác.

Prompt/policy cũ so với mới.

Whiteboard choreography cũ so với mới.

Exercise generator/verifier version khác nhau.

| Incident → RegressionMọi lỗi thật sau khi ẩn danh phải biến thành scenario regression. Mục tiêu là cùng một lỗi không được quay lại lần thứ hai. |
| --- |

## 9. Education Eval Spec

Đây là moat quan trọng nhất: định nghĩa thế nào là một buổi học tốt theo từng skill/subskill, không chỉ theo cảm giác chung.

| skill: fractions.compare.unlike-denominatorssuccess_criteria:  misconception_detection: 20  no_early_answer_reveal: 15  progressive_hints: 15  explanation_adaptation: 20  whiteboard_alignment: 10  independent_final_answer: 20 |
| --- |

| Grader | Nên chấm | Không nên chấm |
| --- | --- | --- |
| Code grader | Đáp án, state, latency, overlap, event sequence, crash. | Độ tự nhiên hoặc phù hợp độ tuổi. |
| LLM grader | Câu chữ, clarity, engagement, pedagogy, visual explanation. | Override lỗi cứng hoặc tự thay rubric. |
| Human calibration | Kiểm LLM grader và cập nhật rubric. | Chạy thủ công mọi phiên. |

## 10. Model Arena và benchmark đa-model

Cùng một persona, cùng bài, cùng misconception và rubric; thay model/prompt/policy để so sánh chất lượng, tốc độ và chi phí.

| Chỉ số | Ví dụ | Ý nghĩa |
| --- | --- | --- |
| Teaching quality | Misconception detection, progressive hints, independent success. | Model/policy nào dạy tốt hơn. |
| Voice UX | p50/p95 latency, overlap, dropout. | Cấu hình nào mượt hơn. |
| Cost | Chi phí mỗi 10/30 phút, token/audio usage. | Khả năng thương mại hóa. |
| Reliability | Crash, reconnect, error rate. | Khả năng production. |
| Consistency | Variance qua nhiều seed/persona. | Độ ổn định thực tế. |

| Quyết định modelKhông chọn model theo benchmark quảng cáo. Chọn dựa trên benchmark của chính sản phẩm, persona và dữ liệu học tập của mình. |
| --- |

## 11. Synthetic Student Cohort

Xây quần thể học sinh giả lập có kiểm soát thay vì chỉ một vài persona tĩnh.

| Thành phần | Vai trò |
| --- | --- |
| Năng lực | Mất gốc, trung bình, khá, nhanh nhưng ẩu. |
| Misconception | Nhầm tử/mẫu, đoán theo pattern, thuộc mẹo nhưng không hiểu. |
| Hành vi | Im lặng, hỏi ngoài lề, dễ nản, trả lời quá nhanh. |
| Giao tiếp | Nói ngắt quãng, ngập ngừng, từ vựng hạn chế. |
| Môi trường | Mic xấu, tiếng ồn, mạng chập chờn. |
| Tâm lý học tập | Thiếu tự tin, thích được khen, mất tập trung. |

| Hai cohort bắt buộcGolden cohort cố định dùng regression; exploratory cohort sinh theo seed để tìm lỗi mới. Không được để persona hoàn toàn ngẫu nhiên nếu muốn so sánh build. |
| --- |

## 12. Confusion Detector và UX Intelligence

QA Lab cần phát hiện “khoảnh khắc bối rối”, không chỉ bug kỹ thuật.

Học sinh nói “con chưa hiểu”.

Sai cùng một kiểu nhiều lần.

Tutor lặp gần nguyên cách giải thích.

Dead air dài hoặc nói đè.

Bảng trắng trễ so với lời nói.

Học sinh đổi đáp án liên tục.

Không biết bước tiếp theo.

Tutor chuyển activity trước khi đạt hiểu biết tối thiểu.

| 06:12  MEDIUM — bảng xuất hiện chậm 1.8 giây08:41  HIGH   — tutor lặp cùng cách giải thích lần ba09:03  HIGH   — student nói chưa hiểu nhưng tutor chuyển bài |
| --- |

Video/report nên cho phép nhảy thẳng đến timestamp thay vì xem lại cả phiên 30 phút.

## 13. Prompt, Policy và Version Observability

Mỗi run phải gắn đầy đủ phiên bản:

Model và endpoint version.

System prompt hash.

Teaching policy version.

Rubric version.

Curriculum/skill version.

Exercise generator và verifier version.

Whiteboard choreography version.

Build/commit/deployment ID.

| Mục tiêuKhi điểm clarity tụt, phải biết đó là do build, model, prompt, policy, bài tập hay whiteboard — không chỉ biết “bản mới tệ hơn”. |
| --- |

## 14. Cost–Quality–Latency Optimizer

QA Lab phải trả lời không chỉ “pass hay fail”, mà còn: cấu hình nào đạt chất lượng tối thiểu với chi phí thấp nhất?

| quality_score >= 85p95_latency <= 2.5scost_per_30_min_session <= targetcritical_failure_rate == 0 |
| --- |

Routing policy có thể thử nghiệm:

Turn đơn giản → model nhanh/rẻ.

Học sinh sai lặp lại → model mạnh hơn.

Đánh giá bảng → vision model.

Final mastery check → verifier độc lập.

Degraded mode → text/short response khi realtime provider yếu.

## 15. Safety Lab

Tách một suite riêng cho trẻ em và agent security.

| Thành phần | Vai trò |
| --- | --- |
| Child safety | Nội dung nguy hiểm, người lớn, bắt nạt, distress, escalation. |
| PII leakage | Địa chỉ, số điện thoại, tên thật, dữ liệu phụ huynh. |
| Boundary | Tutor giữ bí mật với cha mẹ, vai trò sai, thao túng cảm xúc. |
| Prompt injection | Lệnh độc hại trong câu học sinh, nội dung web, ảnh hoặc bài tập. |
| Tool safety | Agent cố mở domain lạ, shell, cloud console, thanh toán. |
| Data safety | Không dùng dữ liệu trẻ thật; artifact phải redact. |

## 16. Dữ liệu, Artifact và Báo cáo

| runs/<run-id>/├── run.json├── summary.json├── report.md├── issues.json├── transcript.jsonl├── student-turns.jsonl├── whiteboard-events.jsonl├── metrics.json├── console.jsonl├── network.jsonl├── screenshots/└── session.mp4 |
| --- |

Chính sách lưu trữ:

PASS: giữ summary, metrics và checkpoint; video xóa sớm.

FAIL: giữ video, trace, transcript, logs đầy đủ.

Release run: giữ lâu hơn để audit.

Artifact phải redact token, cookie, password, Authorization header và PII.

Issue lifecycle:

| NEW → PERSISTING → RESOLVED / REGRESSED / FLAKY |
| --- |

Fingerprint issue từ category + route + element + normalized error + scenario để tránh spam trùng lặp.

## 17. Security Boundary

| Được phép | Không được phép | Guard kỹ thuật |
| --- | --- | --- |
| DOM, screenshot, click, type, scroll, speak, wait, report. | Shell, source code, Git write, cloud console, production. | Action allowlist. |
| Staging URL và test account. | Admin account, dữ liệu trẻ thật. | Domain/account guard. |
| Artifact output dir. | Đọc file ngoài workspace artifact. | Filesystem sandbox. |
| TTS/micro ảo. | Public CDP/noVNC port. | Local bind + SSH tunnel. |
| AI evaluator. | Tự đổi rubric hoặc override blocker. | Policy engine + deterministic precedence. |

| Nguyên tắc quyềnModel chỉ đề xuất hành động có cấu trúc. QA Controller xác thực rồi mới cho browser thực thi. |
| --- |

## 18. Lộ trình phát triển

| Giai đoạn | Deliverable chính | Kết quả |
| --- | --- | --- |
| Phase 0–1 | Audit VPS, repo foundation, config, doctor, artifact state. | Nền tảng chạy ổn, không phụ thuộc Hermes. |
| Phase 2 | Browser guard, screenshot, console/network, profile. | Có thể kiểm staging an toàn. |
| Phase 3 | Web QA MVP. | Smoke/UI/copy/responsive report. |
| Phase 4 | Student text QA. | Persona, transcript-driven, UX diary. |
| Phase 5 | Recording. | Video/audio/timestamps. |
| Phase 6 | Voice bridge. | Student nói qua mic ảo. |
| Phase 7 | Education Eval. | Rule + LLM grader + rubric. |
| Phase 8 | Replay/regression. | So sánh build và incident suite. |
| Phase 9 | Model Arena/cohorts. | Benchmark đa-model và synthetic users. |
| Phase 10 | Safety/optimizer. | Sẵn sàng production và tối ưu chi phí. |

## 19. KPI và tiêu chí thành công

| Nhóm KPI | Chỉ số gợi ý | Mục đích |
| --- | --- | --- |
| Coverage | % critical flows, skills, personas, viewports. | Biết QA Lab đang che phủ gì. |
| Detection | Bug found pre-release, regression catch rate. | Giảm lỗi lọt production. |
| Reliability | Flake rate, rerun consistency, blocked rate. | QA Lab phải đáng tin. |
| Efficiency | Runtime, model calls, cost/run. | Có thể chạy thường xuyên. |
| Learning UX | Clarity, smoothness, independent success, confusion count. | Đo chất lượng dạy. |
| Voice | p50/p95 latency, overlap, drop, reconnect. | Độ mượt realtime. |
| Business | Cost/30m, pass rate by model, release confidence. | Gắn với thương mại hóa. |

## 20. Khả năng thương mại hóa

Trước mắt QA Lab là hạ tầng nội bộ cho K12 Tutor và Con Nói Tiếng Việt. Sau khi ổn định, core có thể mở rộng thành nền tảng evaluation và synthetic-user cho voice AI agents.

| Tầng | Sản phẩm khả dĩ | Khách hàng |
| --- | --- | --- |
| Nội bộ | QA Lab cho K12/CNV. | Chính đội sản phẩm. |
| B2B Education | Kiểm định gia sư AI, language tutor, LMS agent. | EdTech, trường, nền tảng học. |
| Voice Agent QA | Synthetic callers/users, replay, safety, cost benchmark. | Customer support, sales, coaching. |
| Benchmark service | Model Arena theo domain riêng. | Doanh nghiệp chọn model/policy. |
| Eval data | Rubric, incident regression, anonymized benchmark. | Đội AI cần eval dataset. |

| Điều kiện trước khi bánCore runner ổn định, artifact/replay đáng tin, benchmark có human calibration, security boundary chặt và kết quả có thể giải thích. |
| --- |

## 21. Những thứ chưa nên làm

Dashboard hoành tráng trước khi CLI và artifact ổn.

Agent tự sửa hoặc tự deploy production.

Multi-agent swarm phức tạp.

Marketplace persona.

Fine-tune model quá sớm.

Pixel-perfect mọi màn hình ngay từ MVP.

Platform generic cho mọi ngành trước khi K12/CNV tạo đủ dữ liệu.

Chạy full lesson sau mọi commit.

Dùng một model vừa làm học sinh, vừa evaluator, vừa technical reviewer.

## 22. Kế hoạch 90 ngày

| Thời gian | Mục tiêu | Definition of Done |
| --- | --- | --- |
| Ngày 1–15 | Foundation + Browser Guard | Doctor pass, staging guard, screenshot/console/network, run directory. |
| Ngày 16–30 | Web QA MVP | 2 viewport, critical flow, issue/report, local fixture tests. |
| Ngày 31–45 | Student text QA | 1 persona, 1 scenario, 8+ turns, UX diary, rule checks. |
| Ngày 46–60 | Recording + Voice one-turn | FFmpeg, PulseAudio routing, one voice turn, no echo loop. |
| Ngày 61–75 | Education Eval + replay | Rubric skill đầu tiên, deterministic replay, incident scenario. |
| Ngày 76–90 | Model Arena + release run | So sánh ít nhất 2 brain/evaluator configs, targeted regression, release report. |

| MVP đúng nghĩaMột Web QA scenario + một Student QA scenario + report có bằng chứng + targeted retest. Chưa cần dashboard, swarm hoặc 100 persona. |
| --- |

## Phụ lục A. Cấu trúc repo đề xuất

| qa-lab/├── core/│   ├── scenario-engine/│   ├── policy-engine/│   ├── run-controller/│   ├── event-timeline/│   └── replay/├── providers/│   ├── brains/{gemini,claude,openai,hermes,scripted}.ts│   ├── voices/{gemini-live,tts,wav,mock}.ts│   └── evaluators/{rules,gemini,claude}.ts├── browser/playwright.ts├── recorder/├── scenarios/{web,student,safety}/├── personas/├── rubrics/├── fixtures/├── artifacts/runs/├── reports/├── scripts/└── tests/ |
| --- |

## Phụ lục B. Scenario mẫu

| id: fraction-misconception-recoverytype: studentbrain: geminivoice: gemini-liveevaluator: claudepersona: weak-fractions-grade-4max_minutes: 15max_turns: 20goals:  - misconception_detected  - explanation_changes  - independent_final_answerstop_when:  - all_goals_methard_stop:  max_failures: 3  app_crash: true |
| --- |

## Phụ lục C. Data contract issue mẫu

| {  "id": "ISSUE-001",  "runner": "student",  "category": "teaching_clarity",  "severity": "HIGH",  "title": "Tutor lặp cùng cách giải thích sau hai lượt chưa hiểu",  "url": "https://staging.example.com/lesson/...",  "timestampMs": 521000,  "expected": "Tutor đổi ví dụ hoặc biểu diễn bảng trắng",  "actual": "Tutor diễn đạt lại gần nguyên câu cũ",  "evidence": ["session.mp4#t=08:41", "transcript.jsonl#turn=12"],  "confidence": 0.93,  "status": "NEW"} |
| --- |

## Phụ lục D. Report cuối run

| QA LAB — RUN 027Fast Gate             PASSWeb UI                PASS_WITH_RISKSStudent Session       FAILNew issues             1Persisting issues      2Resolved issues        3Main failure:Tutor repeated the same explanation after two confusion turns.Artifacts:runs/027/report.mdruns/027/session.mp4 |
| --- |

KẾT LUẬN

QA Lab nên được xây như một core độc lập, có thể thay bộ não, voice provider và evaluator. Playwright/rule engine làm phần chắc chắn; Gemini/Claude làm synthetic user và UX review; Codex điều tra nguyên nhân kỹ thuật. Tài sản dài hạn là timeline, replay, rubric giáo dục, incident regression và benchmark riêng — không phải chỉ là một agent biết bấm web.
