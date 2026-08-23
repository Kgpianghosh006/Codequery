/**
 * scripts/scrapers/atcoder.js
 *
 * AtCoder Scraper Adapter
 * Implements the standard fetchProblems({ limit }) interface.
 *
 * Scraping pipeline (3 steps):
 *   1. Contest Discovery  — paginate /contests/archive to collect contest IDs.
 *   2. Task Discovery     — visit /contests/{id}/tasks for task stubs.
 *   3. Statement Extract  — visit each task URL and extract title + description.
 *
 * Returns: Array<{
 *   id: string,
 *   title: string,
 *   url: string,
 *   description: string | null,
 *   platform: 'AtCoder',
 *   difficulty: string | null,
 *   tags: string[]
 * }>
 */

import puppeteer from "puppeteer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://atcoder.jp";

/** User-agent matching a real Chrome on Windows to avoid bot detection. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/114.0.5735.199 Safari/537.36";

/**
 * Map of contest-ID prefix -> { tags, difficulty }
 * Covers the three main AtCoder regular series.
 */
const CONTEST_META = {
  abc: { tags: ["ABC", "Beginner"], difficulty: "Beginner/Intermediate" },
  arc: { tags: ["ARC", "Regular"],  difficulty: "Intermediate/Advanced"  },
  agc: { tags: ["AGC", "Grand"],    difficulty: "Expert"                 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a random integer in [min, max] (inclusive). */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Polite randomised delay between 1000 ms and 2000 ms. */
function politeDelay() {
  return new Promise((r) => setTimeout(r, randInt(1_000, 2_000)));
}

/**
 * Derive { tags, difficulty } from a contest ID string.
 * e.g. "abc300"  -> { tags: ["ABC","Beginner"], difficulty: "Beginner/Intermediate" }
 *      "arc150"  -> { tags: ["ARC","Regular"],  difficulty: "Intermediate/Advanced"  }
 *      "agc060"  -> { tags: ["AGC","Grand"],     difficulty: "Expert"                 }
 *      anything else -> { tags: [prefix.toUpperCase()], difficulty: null }
 */
function deriveContestMeta(contestId) {
  const lower = (contestId || "").toLowerCase();
  for (const [prefix, meta] of Object.entries(CONTEST_META)) {
    if (lower.startsWith(prefix)) return { ...meta };
  }
  // Generic prefix fallback (e.g. "joi", "past", etc.)
  const prefix = lower.replace(/\d+$/, "").toUpperCase();
  return { tags: prefix ? [prefix] : [], difficulty: null };
}

/**
 * Navigate to a URL with exponential-backoff retry (up to maxAttempts).
 * Throws after exhausting all attempts.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {object} gotoOptions - passed directly to page.goto()
 * @param {number} maxAttempts
 */
async function gotoWithRetry(page, url, gotoOptions = {}, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000, ...gotoOptions });
      return; // success
    } catch (err) {
      lastErr = err;
      const backoff = 1_000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.warn(
        `[AtCoder] ⚠️  Attempt ${attempt}/${maxAttempts} failed for ${url}: ${err.message}. ` +
        `Retrying in ${backoff / 1000}s...`
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Step 1 — Contest Discovery
// ---------------------------------------------------------------------------

/**
 * Paginate /contests/archive starting at page 1.
 * Collects contest IDs until the table is empty or we have enough.
 *
 * @param {import('puppeteer').Page} page
 * @param {number} contestLimit - max contests to collect
 * @returns {Promise<string[]>} array of contest ID strings
 */
async function discoverContests(page, contestLimit) {
  const contestIds = [];
  let pageNum = 1;

  console.log(`[AtCoder] Step 1 — Contest Discovery (cap: ${contestLimit} contests)`);

  while (contestIds.length < contestLimit) {
    const url = `${BASE_URL}/contests/archive?page=${pageNum}`;
    console.log(`[AtCoder]   Fetching archive page ${pageNum}: ${url}`);

    try {
      await gotoWithRetry(page, url);
    } catch (err) {
      console.warn(`[AtCoder] ⚠️  Could not load archive page ${pageNum}: ${err.message}. Stopping.`);
      break;
    }

    // Each row in the contest archive table has a link like /contests/abc300
    const ids = await page.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll("table tbody tr")
      );
      return rows
        .map((tr) => {
          const anchor = tr.querySelector('td a[href*="/contests/"]');
          if (!anchor) return null;
          // href is like "/contests/abc300" — grab the last segment.
          const parts = anchor.getAttribute("href").split("/");
          return parts[parts.length - 1] || null;
        })
        .filter(Boolean);
    });

    if (ids.length === 0) {
      console.log(`[AtCoder]   No contests found on page ${pageNum} — archive exhausted.`);
      break;
    }

    contestIds.push(...ids);
    console.log(
      `[AtCoder]   Page ${pageNum}: +${ids.length} contests (total: ${contestIds.length})`
    );
    pageNum++;

    await politeDelay();
  }

  const result = contestIds.slice(0, contestLimit);
  console.log(`[AtCoder] Step 1 done — ${result.length} contest(s) collected.`);
  return result;
}

// ---------------------------------------------------------------------------
// Step 2 — Task Discovery
// ---------------------------------------------------------------------------

/**
 * Visit /contests/{contestId}/tasks and extract task stubs.
 * Returns [] on any failure (contest may not have a tasks page).
 *
 * @param {import('puppeteer').Page} page
 * @param {string} contestId
 * @returns {Promise<Array<{ id, letter, title, url, contestId }>>}
 */
async function discoverTasks(page, contestId) {
  const url = `${BASE_URL}/contests/${contestId}/tasks`;

  try {
    await gotoWithRetry(page, url);
  } catch (err) {
    console.warn(`[AtCoder] ⚠️  Tasks page failed for ${contestId}: ${err.message}`);
    return [];
  }

  const tasks = await page.evaluate((baseUrl, cid) => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    return rows
      .map((tr) => {
        const cols = tr.querySelectorAll("td");
        if (cols.length < 2) return null;

        const letter = cols[0]?.textContent.trim();           // e.g. "A"
        const anchor = cols[1]?.querySelector("a");
        if (!anchor) return null;

        const href = anchor.getAttribute("href");             // /contests/abc300/tasks/abc300_a
        const taskUrl = href.startsWith("http") ? href : `${baseUrl}${href}`;
        const taskId = href.split("/").pop();                  // abc300_a

        return {
          id: taskId,
          letter,
          title: anchor.textContent.trim(),
          url: taskUrl,
          contestId: cid,
        };
      })
      .filter(Boolean);
  }, BASE_URL, contestId);

  return tasks;
}

// ---------------------------------------------------------------------------
// Step 3 — Statement Extraction
// ---------------------------------------------------------------------------

/**
 * Visit a task page and extract its description.
 * Prioritises span.lang-en for English, falls back to #task-statement.
 * Uses gotoWithRetry (up to 3 attempts) as required.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function extractTaskStatement(page, url) {
  await gotoWithRetry(page, url, {}, 3);

  return page.evaluate(() => {
    const clean = (el) => {
      if (!el) return null;
      const text = (el.innerText || el.textContent || "").trim();
      return text.length >= 20
        ? text.replace(/\r\n/g, " ").replace(/\n+/g, " ")
        : null;
    };

    // Priority 1: English-language section (bilingual contests).
    const langEn = document.querySelector("span.lang-en");
    if (langEn) {
      // Within the English section, take only the first paragraph-level block.
      const firstPart = langEn.querySelector("p, div, section");
      const candidate = clean(firstPart) || clean(langEn);
      if (candidate) return candidate;
    }

    // Priority 2: Full task statement container.
    const taskStatement = document.querySelector("#task-statement");
    if (taskStatement) {
      // Try to grab just the problem body, not constraints/examples.
      const section = taskStatement.querySelector("section");
      return clean(section) || clean(taskStatement);
    }

    // Priority 3: Generic fallback.
    const main = document.querySelector("main, #main, .main");
    return clean(main);
  });
}

// ---------------------------------------------------------------------------
// Main adapter entry point
// ---------------------------------------------------------------------------

/**
 * @param {{ limit: number }} options  `limit` caps total problems collected.
 * @returns {Promise<Array>}
 */
export async function fetchProblems({ limit = 50 } = {}) {
  console.log(`[AtCoder] Starting — target ${limit} problem(s).`);

  // Heuristic: assume ~6 tasks per contest on average, so we need
  // roughly ceil(limit / 6) contests. We cap contests at `limit`
  // to handle edge cases (single-task contests, task-level early exit).
  const contestCap = Math.min(limit, Math.ceil(limit / 6) + 2);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    // ── Step 1: Discover contests ──────────────────────────────────────────
    const contestIds = await discoverContests(page, contestCap);

    // ── Step 2 + 3: Task discovery & statement extraction ──────────────────
    console.log(`\n[AtCoder] Step 2+3 — Task Discovery & Statement Extraction`);

    const problems = [];

    outerLoop:
    for (const contestId of contestIds) {
      const { tags, difficulty } = deriveContestMeta(contestId);

      console.log(`[AtCoder]   Contest: ${contestId} | difficulty: ${difficulty} | tags: ${tags.join(", ")}`);

      let taskStubs;
      try {
        taskStubs = await discoverTasks(page, contestId);
      } catch (err) {
        console.warn(`[AtCoder] ⚠️  Skipping contest ${contestId}: ${err.message}`);
        await politeDelay();
        continue;
      }

      if (taskStubs.length === 0) {
        console.log(`[AtCoder]   No tasks found for ${contestId} — skipping.`);
        await politeDelay();
        continue;
      }

      console.log(`[AtCoder]   Found ${taskStubs.length} task(s) in ${contestId}.`);

      for (const stub of taskStubs) {
        // Respect global limit — early exit across both loops.
        if (problems.length >= limit) break outerLoop;

        let description = null;
        try {
          description = await extractTaskStatement(page, stub.url);
        } catch (err) {
          // Per-problem isolation: log, skip description, still push record.
          console.warn(
            `[AtCoder] ⚠️  Failed statement for "${stub.title}" (${stub.url}): ${err.message}`
          );
        }

        problems.push({
          id:          stub.id,
          title:       stub.title,
          url:         stub.url,
          description,
          platform:    "AtCoder",
          difficulty,
          tags:        [...tags],    // copy so each problem gets its own array
        });

        if (problems.length % 10 === 0) {
          console.log(`[AtCoder]   Progress: ${problems.length}/${limit}`);
        }

        await politeDelay();
      }
    }

    console.log(`\n[AtCoder] Done — ${problems.length} problem(s) collected.`);
    return problems;
  } finally {
    // Always close the browser, even on unhandled errors.
    await browser.close();
  }
}
