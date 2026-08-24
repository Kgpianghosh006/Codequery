/**
 * scripts/scrapers/codeforces.js
 * Scrapes Codeforces problem stubs and optionally fetches descriptions.
 */

import puppeteer from "puppeteer";

const BASE_URL = "https://codeforces.com";

async function collectAllStubs(page, limit) {
  const stubs = [];
  let pageNum = 1;

  while (stubs.length < limit) {
    const url = `${BASE_URL}/problemset/page/${pageNum}`;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (err) {
      break;
    }

    const rows = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll("table.problems tr")).slice(1);
      return trs.map((tr) => {
        const anchor = tr.querySelector("td:nth-of-type(2) > div:first-of-type > a");
        if (!anchor) return null;

        const tags = Array.from(tr.querySelectorAll("a.notice"))
          .map((el) => el.textContent.trim())
          .filter(Boolean);

        const ratingEl = tr.querySelector("td:nth-of-type(4)");
        const difficulty = ratingEl ? ratingEl.textContent.trim() || null : null;

        return {
          title: anchor.textContent.trim(),
          url: anchor.href,
          difficulty,
          tags,
        };
      }).filter(Boolean);
    });

    if (rows.length === 0) break;

    stubs.push(...rows);
    pageNum++;

    if (stubs.length % 500 === 0) {
      console.log(`[Codeforces] Fetched ${stubs.length} stubs...`);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  return stubs.slice(0, limit);
}

async function enrichWithDescriptions(page, stubs, descriptionLimit) {
  if (descriptionLimit <= 0) return stubs;

  const toEnrich = stubs.slice(0, descriptionLimit);

  for (let i = 0; i < toEnrich.length; i++) {
    try {
      await page.goto(toEnrich[i].url, { waitUntil: "domcontentloaded", timeout: 30_000 });

      const description = await page.evaluate(() => {
        const node = document.querySelector(".problem-statement");
        if (!node) return null;

        for (const div of node.querySelectorAll("div")) {
          const text = div.innerText?.trim();
          if (text && text.length > 20 && !/^(input|output|note|example)/i.test(text)) {
            return text.replace(/\r\n/g, " ").replace(/\n+/g, " ").trim();
          }
        }
        return node.innerText?.replace(/\r\n/g, " ").replace(/\n+/g, " ").trim() || null;
      });

      stubs[i].description = description;
    } catch (err) {}

    if ((i + 1) % 50 === 0) {
      console.log(`[Codeforces] Descriptions: ${i + 1}/${toEnrich.length}`);
    }

    await new Promise((r) => setTimeout(r, 600));
  }

  return stubs;
}

function deriveId(url) {
  const parts = url.replace(/\/$/, "").split("/");
  const idx = parts.lastIndexOf("problem");
  if (idx !== -1 && parts[idx + 2]) {
    return `${parts[idx + 1]}${parts[idx + 2]}`;
  }
  return parts.pop();
}

export async function fetchProblems({ limit = Infinity, descriptionLimit = 0 } = {}) {
  const effectiveLimit = isFinite(limit) ? limit : 99999;
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.199 Safari/537.36"
    );

    let stubs = await collectAllStubs(page, effectiveLimit);
    stubs = await enrichWithDescriptions(page, stubs, descriptionLimit);

    const problems = stubs.map((s) => ({
      id:          deriveId(s.url),
      title:       s.title,
      url:         s.url,
      description: s.description ?? null,
      platform:    "Codeforces",
      difficulty:  s.difficulty,
      tags:        s.tags,
    }));

    return problems;
  } finally {
    await browser.close();
  }
}