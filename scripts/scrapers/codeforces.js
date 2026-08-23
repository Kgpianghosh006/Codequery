/**
 * scripts/scrapers/codeforces.js
 *
 * Codeforces Scraper Adapter
 * Implements the standard fetchProblems({ limit }) interface.
 *
 * Returns: Array<{
 *   id: string,
 *   title: string,
 *   url: string,
 *   description: string | null,
 *   platform: 'Codeforces',
 *   difficulty: string | null,
 *   tags: string[]
 * }>
 */

import puppeteer from "puppeteer";

const BASE_URL = "https://codeforces.com";

/** Selector for problem links in the paginated table. */
const PROBLEM_LINK_SEL = "table.problems tr td:nth-of-type(2) > div:first-of-type > a";

/** Selector for tag pills in the problem list row. */
const TAG_SEL = "table.problems tr td:nth-of-type(2) .tag-box";

/** Selector for the difficulty rating in the problem list row. */
const RATING_SEL = "table.problems tr td:nth-of-type(4)";

/**
 * Collect problem stubs from paginated problem list pages.
 * Each page yields ~50 problems. We stop once we have 	arget stubs.
 */
async function collectStubs(page, target) {
  const stubs = [];
  let pageNum = 1;

  while (stubs.length < target) {
    const url = ${BASE_URL}/problemset/page/;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const rows = await page.evaluate(
      (linkSel, tagSel, ratingSel) => {
        const trs = Array.from(document.querySelectorAll("table.problems tr")).slice(1); // skip header
        return trs.map((tr) => {
          const anchor = tr.querySelector(linkSel.replace("table.problems tr ", ""));
          if (!anchor) return null;

          const tags = Array.from(tr.querySelectorAll(".tag-box"))
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
      },
      PROBLEM_LINK_SEL,
      TAG_SEL,
      RATING_SEL
    );

    if (rows.length === 0) {
      console.warn([Codeforces] No rows found on page  — stopping.);
      break;
    }

    stubs.push(...rows);
    console.log(
      [Codeforces] Page : collected  stubs (total: )
    );
    pageNum++;
  }

  return stubs.slice(0, target);
}

/**
 * Navigate to a single problem page and extract its statement text.
 * Returns null on any failure so the adapter can skip and continue.
 */
async function extractDescription(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  return page.evaluate(() => {
    const node = document.querySelector(".problem-statement");
    if (!node) return null;

    // Walk child divs and return the first substantial block that isn't
    // an Input/Output/Note section (those are implementation details).
    for (const div of node.querySelectorAll("div")) {
      const text = div.innerText?.trim();
      if (
        text &&
        text.length > 20 &&
        !/^(input|output|note|example)/i.test(text)
      ) {
        return text.replace(/\r\n/g, " ").replace(/\n+/g, " ").trim();
      }
    }

    // Fallback: return entire statement text.
    return node.innerText?.replace(/\r\n/g, " ").replace(/\n+/g, " ").trim() || null;
  });
}

/**
 * Derive a stable problem ID from the Codeforces URL.
 * e.g. https://codeforces.com/problemset/problem/1234/A  =>  "1234A"
 */
function deriveId(url) {
  const parts = url.replace(/\/$/, "").split("/");
  // URL format: /problemset/problem/<contestId>/<index>
  const idx = parts.lastIndexOf("problem");
  if (idx !== -1 && parts[idx + 2]) {
    return ${parts[idx + 1]};
  }
  return parts.pop();
}

/**
 * Main adapter entry point.
 * @param {{ limit: number }} options
 * @returns {Promise<Array>}
 */
export async function fetchProblems({ limit = 50 } = {}) {
  console.log([Codeforces] Starting — target  problem(s).);

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

    const stubs = await collectStubs(page, limit);
    console.log(
      [Codeforces] Collected  stub(s). Fetching descriptions...
    );

    const problems = [];

    for (let i = 0; i < stubs.length; i++) {
      const stub = stubs[i];
      const id = deriveId(stub.url);

      let description = null;
      try {
        description = await extractDescription(page, stub.url);
      } catch (err) {
        // Refinement #1: per-problem error isolation — log and skip.
        console.warn(
          [Codeforces] ⚠️  Failed to fetch description for "" (): 
        );
      }

      problems.push({
        id,
        title: stub.title,
        url: stub.url,
        description,
        platform: "Codeforces",
        difficulty: stub.difficulty,
        tags: stub.tags,
      });

      if ((i + 1) % 10 === 0) {
        console.log([Codeforces] Progress: /);
      }

      // Polite delay to avoid rate-limiting.
      await new Promise((r) => setTimeout(r, 600));
    }

    console.log([Codeforces] Done —  problem(s) collected.);
    return problems;
  } finally {
    // Refinement #3: always close the browser, even on error.
    await browser.close();
  }
}
