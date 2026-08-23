/**
 * scripts/scrapers/leetcode.js
 *
 * LeetCode Scraper Adapter
 * Implements the standard fetchProblems({ limit }) interface.
 *
 * Returns: Array<{
 *   id: string,
 *   title: string,
 *   url: string,
 *   description: string | null,
 *   platform: 'LeetCode',
 *   difficulty: string | null,
 *   tags: string[]
 * }>
 */

import puppeteer from "puppeteer";

const BASE_URL = "https://leetcode.com";
const PROBLEM_LIST_URL = ${BASE_URL}/problemset/;

/** Selector that targets each problem card in the infinite-scroll list. */
const CARD_SELECTOR =
  "a.group.flex.flex-col.rounded-\[8px\].duration-300";

/**
 * Scroll the problem list page until we have collected at least 	arget stubs.
 * Returns an array of { title, url, difficulty, tags } objects.
 */
async function collectStubs(page, target) {
  let stubs = [];
  let prevCount = 0;

  while (stubs.length < target) {
    // Scroll last visible card into view to trigger the next batch.
    await page.evaluate((sel) => {
      const cards = document.querySelectorAll(sel);
      if (cards.length) {
        cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }, CARD_SELECTOR);

    // Wait until new cards appear.
    try {
      await page.waitForFunction(
        (sel, prev) => document.querySelectorAll(sel).length > prev,
        { timeout: 15_000 },
        CARD_SELECTOR,
        prevCount
      );
    } catch {
      // No more cards loaded — we've reached the end of the list.
      console.warn("[LeetCode] No more cards loaded — stopping scroll.");
      break;
    }

    stubs = await page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel)).map((el) => {
        // Title: strip the leading "1234. " numbering if present.
        const rawTitle =
          el.querySelector(".ellipsis.line-clamp-1")?.textContent.trim() ?? "";
        const title = rawTitle.includes(". ")
          ? rawTitle.split(". ").slice(1).join(". ")
          : rawTitle;

        // Difficulty badge — text content of the first colored span.
        const diffEl = el.querySelector(
          "span.text-difficulty-easy, span.text-difficulty-medium, span.text-difficulty-hard"
        );
        const difficulty = diffEl ? diffEl.textContent.trim() : null;

        return { title, url: el.href, difficulty, tags: [] };
      });
    }, CARD_SELECTOR);

    prevCount = stubs.length;
  }

  return stubs.slice(0, target);
}

/**
 * Navigate to a single problem page and extract its description text.
 * Returns null on any failure so the adapter can skip and continue.
 */
async function extractDescription(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  return page.evaluate(() => {
    const trySel = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const text = (el.innerText || el.textContent || "").trim();
      return text.length >= 20 ? text.replace(/\r\n/g, " ").replace(/\n+/g, " ") : null;
    };

    return (
      trySel('div[data-track-load="description_content"]') ||
      trySel(".question-content") ||
      trySel(".content__u3I1") ||
      trySel("#description") ||
      null
    );
  });
}

/**
 * Main adapter entry point.
 * @param {{ limit: number }} options
 * @returns {Promise<Array>}
 */
export async function fetchProblems({ limit = 50 } = {}) {
  console.log([LeetCode] Starting — target  problem(s).);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/114.0.5735.199 Safari/537.36"
    );

    await page.goto(PROBLEM_LIST_URL, { waitUntil: "domcontentloaded" });
    const stubs = await collectStubs(page, limit);
    console.log([LeetCode] Collected  stub(s). Fetching descriptions...);

    const problems = [];

    for (let i = 0; i < stubs.length; i++) {
      const stub = stubs[i];
      // Derive a stable id from the URL slug.
      const id = stub.url.replace(/\/$/, "").split("/").pop() ?? String(i);

      let description = null;
      try {
        description = await extractDescription(page, stub.url);
      } catch (err) {
        // Refinement #1: per-problem error isolation — log and skip.
        console.warn(
          [LeetCode] ⚠️  Failed to fetch description for "" (): 
        );
      }

      problems.push({
        id,
        title: stub.title,
        url: stub.url,
        description,
        platform: "LeetCode",
        difficulty: stub.difficulty,
        tags: stub.tags,
      });

      if ((i + 1) % 10 === 0) {
        console.log([LeetCode] Progress: /);
      }

      // Polite delay to avoid rate-limiting.
      await new Promise((r) => setTimeout(r, 600));
    }

    console.log([LeetCode] Done —  problem(s) collected.);
    return problems;
  } finally {
    // Refinement #3: always close the browser, even on error.
    await browser.close();
  }
}
