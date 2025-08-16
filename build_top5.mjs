#!/usr/bin/env node
/*
 * Scrape top‑5 champion stats per role from Riot/Tencent’s official Wild Rift CN statistics page.
 *
 * Usage:
 *   node build_top5.mjs
 *
 * Requires: npm install playwright
 */
import { chromium } from 'playwright';
import fs from 'fs/promises';

async function scrapeRole(page, tabSelector) {
  // Click the tab for the given role and wait for table to update
  await page.click(tabSelector);
  // Wait for table rows to appear
  await page.waitForSelector('table tbody tr');
  // Extract the first 5 rows
  const rows = await page.$$eval('table tbody tr', trs => {
    return Array.from(trs).slice(0, 5).map(tr => {
      const cells = tr.querySelectorAll('td');
      const name = cells[2].innerText.trim();
      const win = cells[3].innerText.trim().replace('%','');
      const pick = cells[4].innerText.trim().replace('%','');
      const ban = cells[5].innerText.trim().replace('%','');
      return { name, winrate: parseFloat(win)/100, pickrate: parseFloat(pick)/100, banrate: parseFloat(ban)/100 };
    });
  });
  return rows;
}

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('https://lolm.qq.com/act/a20220818raider/index.html', { waitUntil: 'networkidle' });
  // Wait for initial table to load
  await page.waitForSelector('table tbody tr');
  const roles = {};
  roles.baron = await scrapeRole(page, 'text="上单"');
  roles.jungle = await scrapeRole(page, 'text="打野"');
  roles.mid = await scrapeRole(page, 'text="中路"');
  roles.dragon = await scrapeRole(page, 'text="下路"');
  roles.support = await scrapeRole(page, 'text="辅助"');

  await browser.close();
  const result = { last_updated: new Date().toISOString(), roles };
  await fs.writeFile('top5.json', JSON.stringify(result, null, 2), 'utf8');
  console.log('Generated top5.json');
}

scrape().catch(err => {
  console.error(err);
  process.exit(1);
});
