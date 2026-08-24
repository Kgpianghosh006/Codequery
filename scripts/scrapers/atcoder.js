/**
 * scripts/scrapers/atcoder.js
 * Scrapes AtCoder problem stubs and fetches descriptions.
 */

import puppeteer from "puppeteer";

const BASE_URL = "https://atcoder.jp";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.199 Safari/537.36";

const CONTEST_META = {
  abc: { tags: ["ABC", "Beginner"], difficulty: "Beginner/Intermediate" },
  arc: { tags: ["ARC", "Regular"],  difficulty: "Intermediate/Advanced"  },
  agc: { tags: ["AGC", "Grand"],    difficulty: "Expert"                 },
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function politeDelay() {
  return new Promise((r) => setTimeout(r, randInt(1000, 2000)));
}

function deriveContestMeta(contestId) {
  const lower = (contestId || "").toLowerCase();
  for (const [prefix, meta] of Object.entries(CONTEST_META)) {
    if (lower.startsWith(prefix)) return { ...meta };
  }
  const prefix = lower.replace(/\d+$/, "").toUpperCase();
  return { tags: prefix ? [prefix] : [], difficulty: null };
}

async function gotoWithRetry(page, url, gotoOptions = {}, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000, ...gotoOptions });
      return;
    } catch (err) {
      lastErr = err;
      const backoff = 1000 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

async function discoverContests(page, contestLimit) {
  const contestIds = [];
  let pageNum = 1;

  while (contestIds.length < contestLimit) {
    const url = `${BASE_URL}/contests/archive?page=${pageNum}`;
    try {
      await gotoWithRetry(page, url);
    } catch (err) {
      break;
    }

    const ids = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      return rows
        .map((tr) => {
          const anchor = tr.querySelector('td a[href*="/contests/"]');
          if (!anchor) return null;
          const parts = anchor.getAttribute("href").split("/");
          return parts[parts.length - 1] || null;
        })
        .filter(Boolean);
    });

    if (ids.length === 0) break;

    contestIds.push(...ids);
    pageNum++;
    await politeDelay();
  }

  return contestIds.slice(0, contestLimit);
}

async function discoverTasks(page, contestId) {
  const url = `${BASE_URL}/contests/${contestId}/tasks`;

  try {
    await gotoWithRetry(page, url);
  } catch (err) {
    return [];
  }

  const tasks = await page.evaluate((baseUrl, cid) => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    return rows
      .map((tr) => {
        const cols = tr.querySelectorAll("td");
        if (cols.length < 2) return null;

        const letter = cols[0]?.textContent.trim();
        const anchor = cols[1]?.querySelector("a");
        if (!anchor) return null;

        const href = anchor.getAttribute("href");
        const taskUrl = href.startsWith("http") ? href : `${baseUrl}${href}`;
        const taskId = href.split("/").pop();

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

async function extractTaskStatement(page, url) {
  await gotoWithRetry(page, url, {}, 3);

  return page.evaluate(() => {
    const clean = (el) => {
      if (!el) return null;
      const text = (el.innerText || el.textContent || "").trim();
      return text.length >= 20 ? text.replace(/\r\n/g, " ").replace(/\n+/g, " ") : null;
    };

    const langEn = document.querySelector("span.lang-en");
    if (langEn) {
      const firstPart = langEn.querySelector("p, div, section");
      const candidate = clean(firstPart) || clean(langEn);
      if (candidate) return candidate;
    }

    const taskStatement = document.querySelector("#task-statement");
    if (taskStatement) {
      const section = taskStatement.querySelector("section");
      return clean(section) || clean(taskStatement);
    }

    const main = document.querySelector("main, #main, .main");
    return clean(main);
  });
}

export async function fetchProblems({ limit = 50 } = {}) {
  const contestCap = Math.min(limit, Math.ceil(limit / 6) + 2);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    const contestIds = await discoverContests(page, contestCap);
    const problems = [];

    outerLoop:
    for (const contestId of contestIds) {
      const { tags, difficulty } = deriveContestMeta(contestId);

      let taskStubs;
      try {
        taskStubs = await discoverTasks(page, contestId);
      } catch (err) {
        await politeDelay();
        continue;
      }

      if (taskStubs.length === 0) {
        await politeDelay();
        continue;
      }

      for (const stub of taskStubs) {
        if (problems.length >= limit) break outerLoop;

        let description = null;
        try {
          description = await extractTaskStatement(page, stub.url);
        } catch (err) {}

        problems.push({
          id:          stub.id,
          title:       stub.title,
          url:         stub.url,
          description,
          platform:    "AtCoder",
          difficulty,
          tags:        [...tags],
        });

        if (problems.length % 50 === 0 && problems.length > 0) {
          console.log(`[AtCoder] Fetched ${problems.length} problems...`);
        }

        await politeDelay();
      }
    }

    return problems;
  } finally {
    await browser.close();
  }
}