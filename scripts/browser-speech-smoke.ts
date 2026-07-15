import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { speakVietnameseAudibly } from '../src/browser-speech.js';

const sentences = [
  'Con chào cô, hôm nay con muốn học Toán lớp mười hai.',
  'Con chưa hiểu bước biến đổi này, cô giải thích chậm hơn được không ạ?',
  'Theo con, trước tiên mình cần xác định đạo hàm của hàm số.',
  'Con hiểu hơn rồi, bây giờ con sẽ tự thử bước tiếp theo.',
];

const chromePath = path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
if (!existsSync(chromePath)) throw new Error('System Google Chrome is required for Windows Vietnamese TTS.');
const browser = await chromium.launch({ executablePath: chromePath, headless: false, ignoreDefaultArgs: ['--mute-audio'] });
try {
  const page = await browser.newPage();
  await page.setContent('<main><h1>QA Lab — kiểm tra giọng tiếng Việt</h1><p id="status">Đang chuẩn bị…</p></main>');
  const results = [];
  for (let index = 0; index < sentences.length; index += 1) {
    await page.locator('#status').evaluate((node, value) => { node.textContent = value; }, `Đang nói câu ${index + 1}/${sentences.length}`);
    const result = await speakVietnameseAudibly(page, sentences[index]!);
    results.push({ turn: index + 1, ...result });
    process.stdout.write(`${JSON.stringify({ event: 'speech_end', turn: index + 1, ...result })}\n`);
    await page.waitForTimeout(350);
  }
  await page.locator('#status').evaluate((node) => { node.textContent = 'PASS — đã phát đủ 4 câu.'; });
  process.stdout.write(`${JSON.stringify({ status: 'PASSED', turns: results.length, results })}\n`);
  await page.waitForTimeout(1_500);
} finally {
  await browser.close();
}
