// Playwright smoke test: build first (npm run build), then `npm run smoke`.
// Loads a save, switches tabs, collapses the panel, runs one enemy and all enemies.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'test', 'screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4179', '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const errors = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME|fonts/.test(m.text())) errors.push(m.text()); });
  await page.goto('http://localhost:4179/');
  await page.setInputFiles('input[type=file]', join(root, 'test', 'fixtures', 'player-karl.dat'));
  await page.waitForSelector('text=Karl');
  await page.screenshot({ path: join(shots, '1-combat-start.png'), fullPage: true });
  await page.click('button.primary');
  await page.waitForSelector('text=Outcome', { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, '2-combat-results.png'), fullPage: true });
  await page.click('text=All enemies');
  await page.waitForSelector('text=How many can this character beat?', { timeout: 180000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, '3-all-enemies.png'), fullPage: true });
  await page.click('.collapse');
  await page.click('.tab[data-tab=skills]');
  await page.waitForSelector('#view-skills:not([hidden]) h3');
  await page.waitForTimeout(800);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, '4-skills.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, '5-phone.png'), fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) errors.push('horizontal overflow at phone width');
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error('FAIL\n' + errors.join('\n')); process.exit(1); }
console.log('smoke ok; screenshots in test/screenshots');
