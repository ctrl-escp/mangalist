#!/usr/bin/env node
// scrape-manga.js
// Requires Node.js v22+ and cheerio installed
// package.json should have: { "type": "module" }

import fs from 'fs/promises';
import path from 'path';
import { load } from 'cheerio';

const JSON_PATH = path.resolve(process.cwd(), 'reincarnation.json');
let allManga = [];

// Load or initialize existing JSON
async function loadExisting() {
  try {
    const txt = await fs.readFile(JSON_PATH, 'utf8');
    const arr = JSON.parse(txt);
    allManga = Array.isArray(arr) ? arr : [];
  } catch (e) {
    if (e.code === 'ENOENT') allManga = [];
    else throw e;
  }
}

// Save out to JSON
async function saveResults() {
  await fs.writeFile(JSON_PATH, JSON.stringify(allManga, null, 2), 'utf8');
  console.log(`→ Saved ${allManga.length} entries to ${JSON_PATH}`);
}

['SIGINT','SIGTERM','uncaughtException'].forEach(sig =>
  process.on(sig, async () => {
    console.log(`\nCaught ${sig}, saving…`);
    await saveResults();
    process.exit();
  })
);

async function scrapePage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
  const html = await resp.text();
  const $ = load(html);

  const pageItems = [];
  $('.badge-pos-1').each((_, el) => {
    const block = $(el);

    // title & link
    const a = block.find('.item-summary .post-title h3 a').first();
    const name = a.text().trim();
    const link = a.attr('href') || null;

    // rating
    const ratingTxt = block
      .find('.item-summary .meta-item.rating .total_votes, .score')
      .first()
      .text()
      .trim();
    const rating = ratingTxt ? parseFloat(ratingTxt) : null;

    // === chapter count from the FIRST chapter-item ===
    const firstChapText = block
      .find('.item-summary .list-chapter .chapter-item a')
      .first()
      .text()
      .trim();
    const chapMatch = firstChapText.match(/Chapter\s+(\d+)/i);
    const chapters = chapMatch ? parseInt(chapMatch[1], 10) : 0;

    // cover image URL (we’ll convert to data:URI later)
    const imgSrc = block.find('.item-thumb img').first().attr('src') || null;

    pageItems.push({ name, rating, chapters, link, imgSrc });
  });

  // convert images to data URI
  for (const item of pageItems) {
    if (!item.imgSrc) continue;
    try {
      const imgRes = await fetch(item.imgSrc);
      if (imgRes.ok) {
        const ct = imgRes.headers.get('content-type') || 'image/jpeg';
        const buf = Buffer.from(await imgRes.arrayBuffer());
        item.image = `data:${ct};base64,${buf.toString('base64')}`;
      }
    } catch (e) {
      console.warn(`⚠️  Couldn't fetch image for "${item.name}": ${e.message}`);
    }
    delete item.imgSrc;
  }

  // next page
  const nextHref = $('a[aria-label="Next Page"]').attr('href');
  const nextPage = nextHref ? new URL(nextHref, url).href : null;

  return { pageItems, nextPage };
}

(async () => {
  await loadExisting();

  let url = 'https://manhwaclan.com/manga-genre/reincarnation/';  // ← your start URL
  while (url) {
    console.log(`→ Scraping ${url}`);
    try {
      const { pageItems, nextPage } = await scrapePage(url);
      allManga.push(...pageItems);
      url = nextPage;
    } catch (e) {
      console.error('Error:', e.message);
      break;
    }
  }

  await saveResults();
})();