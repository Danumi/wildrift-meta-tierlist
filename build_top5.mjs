```js
// build_top5.mjs
// Scrapes Riot/Tencent's official CN stats page and writes top5.json
// Run locally or from GitHub Actions on a schedule.

import { chromium } from 'playwright';
import fs from 'fs/promises';

const PAGE = 'https://lolm.qq.com/act/a20220818raider/index.html';
const ROLE_TABS = { baron: '上单', jungle: '打野', mid: '中路', dragon: '下路', support: '辅助' };
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function normalizeRows(rows) {
  const clean = rows.filter(r => r.champion && Number.isFinite(r.winrate));
  clean.sort((a, b) => b.winrate - a.winrate);
  return clean.slice(0, 5);
}

async function extractFrom(pageOrFrame) {
  return pageOrFrame.$$eval('tbody tr', trs =>
    trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
      // Champion name = first cell that looks like a name (letters/ideographs)
      const name = tds.find(t => /[A-Za-z\u4e00-\u9fff]/.test(t)) || '';
      const nums = tds
        .map(t => (/%/.test(t) ? Number(t.replace(/[^0-9.]/g, '')) : null))
        .filter(v => v != null);
      const [win, pick, ban] = nums;
      return { champion: name, winrate: win, pickrate: pick, banrate: ban };
    })
  );
}

async function scrapeRole(page, roleLabel) {
  await page.getByRole('button', { name: roleLabel, exact: true }).click();
  // Wait for at least some rows to render
  await Promise.race([
    page.waitForFunction(() => document.querySelectorAll('tbody tr').length >= 5, null, { timeout: 60000 }),
    page.waitForSelector('tbody tr', { state: 'visible', timeout: 60000 }),
  ]);

  let rows = await extractFrom(page);

  // Fallback: check if any iframe contains the table
  if (!rows.length) {
    for (const f of page.frames()) {
      try {
        if ((await f.$$('tbody tr')).length) {
          rows = await extractFrom(f);
          if (rows.length) break;
        }
      } catch {}
    }
  }

  if (!rows.length) throw new Error(`No rows found for role ${roleLabel}`);
  return normalizeRows(rows);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    ignoreHTTPSErrors: true,
  });

  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(180000);

  // Robust navigation: avoid waiting for 'networkidle' (often never reached on CI)
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(PAGE, { waitUntil: 'commit', timeout: 120000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
      await page.waitForTimeout(1500);
    }
  }

  // Try to set Diamond+ if present
  try {
    await page.getByRole('button', { name: '钻石以上' }).click({ timeout: 3000 });
  } catch {}

  const roles = {};
  for (const [key, label] of Object.entries(ROLE_TABS)) {
    let lastErr;
    for (let i = 0; i < 2; i++) {
      try {
        roles[key] = await scrapeRole(page, label);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await page.waitForTimeout(1500);
      }
    }
    if (lastErr) throw lastErr;
  }

  const payload = {
    last_updated: new Date().toISOString(),
    source: 'tencent_cn_diamond_plus',
    roles,
  };

  await fs.writeFile('top5.json', JSON.stringify(payload, null, 2));
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```
