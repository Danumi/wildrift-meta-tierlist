// build_top5.mjs
import { chromium } from 'playwright';
import fs from 'fs/promises';

const PAGE = 'https://lolm.qq.com/act/a20220818raider/index.html';
const ROLE_TABS = { baron: '上单', jungle: '打野', mid: '中路', dragon: '下路', support: '辅助' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function pctNum(t) { return Number(String(t).replace(/[^0-9.]/g,'')) || 0; }
function normalizeRows(rows) {
  rows = rows.filter(r => r.champion && Number.isFinite(r.winrate));
  rows.sort((a,b) => b.winrate - a.winrate);
  return rows.slice(0,5);
}

async function extractFrom(pageOrFrame) {
  return pageOrFrame.$$eval('tbody tr', trs => trs.map(tr => {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
    // Heuristic: name cell is the first that contains letters/ideographs (not %/digits)
    const name = tds.find(t => /[A-Za-z\u4e00-\u9fff]/.test(t)) || '';
    const nums = tds.map(t => /%/.test(t) ? Number(t.replace(/[^0-9.]/g,'')) : null).filter(v => v!=null);
    const [win,pick,ban] = nums;
    return { champion: name, winrate: win, pickrate: pick, banrate: ban };
  }));
}

async function scrapeRole(page, roleLabel) {
  await page.getByRole('button', { name: roleLabel, exact: true }).click();
  // wait for table rows by any means necessary
  await Promise.race([
    page.waitForFunction(() => document.querySelectorAll('tbody tr').length >= 5, null, { timeout: 60000 }),
    page.waitForSelector('tbody tr', { state: 'visible', timeout: 60000 })
  ]);

  let rows = await extractFrom(page);

  // Fallback: try any iframes (site occasionally puts table inside one)
  if (!rows.length) {
    for (const f of page.frames()) {
      try {
        const has = await f.$$('tbody tr');
        if (has.length) {
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
    args: ['--no-sandbox','--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);

  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(()=>{});

  // Try to set Diamond+ if a filter exists
  try { await page.getByRole('button', { name: '钻石以上' }).click({ timeout: 3000 }); } catch {}

  const roles = {};
  for (const [key, label] of Object.entries(ROLE_TABS)) {
    // retry each role up to 2 times
    let lastErr;
    for (let i=0;i<2;i++){
      try { roles[key] = await scrapeRole(page, label); lastErr=null; break; }
      catch(e){ lastErr = e; await page.waitForTimeout(1500); }
    }
    if (lastErr) throw lastErr;
  }

  const payload = { last_updated: new Date().toISOString(), source: 'tencent_cn_diamond_plus', roles };
  await fs.writeFile('top5.json', JSON.stringify(payload, null, 2));
  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
