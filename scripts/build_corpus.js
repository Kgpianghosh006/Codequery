import fs from "fs/promises";
import puppeteer from "puppeteer";

const PROBLEMS_PATH = "./problems/problems_combined.json";
const OUT_PATH = "./corpus/all_problems.json";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { limit: 0, headless: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit" && args[i + 1]) {
      out.limit = parseInt(args[i + 1], 10) || 0;
      i++;
    } else if (a === "--no-headless") {
      out.headless = false;
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadProblems() {
  const raw = await fs.readFile(PROBLEMS_PATH, "utf8");
  return JSON.parse(raw);
}

async function loadExistingCorpus() {
  try {
    const raw = await fs.readFile(OUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function saveCorpus(corpus) {
  await fs.mkdir("./corpus", { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(corpus, null, 2));
}

async function extractDescription(page, p) {
  const url = p.url;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Try several selectors depending on platform
    if (p.source === "codeforces" || url.includes("codeforces.com")) {
      // Codeforces: problem-statement structure
      const desc = await page.evaluate(() => {
        const node = document.querySelector('.problem-statement');
        if (!node) return null;
        const parts = node.querySelectorAll('div');
        // most pages: title is first, statement is second/third
        for (const d of parts) {
          const text = d.innerText && d.innerText.trim();
          if (text && /input|output|note/i.test(text) === false && text.length > 20) {
            return text.replace(/\r\n/g, ' ').replace(/\n+/g, ' ').trim();
          }
        }
        return node.innerText.trim();
      });
      return desc;
    }

    if (p.source === "leetcode" || url.includes("leetcode.com")) {
      // LeetCode: try multiple selectors
      const desc = await page.evaluate(() => {
        const trySel = (s) => {
          const el = document.querySelector(s);
          if (!el) return null;
          const text = el.innerText || el.textContent || '';
          if (text.trim().length < 20) return null;
          return text.replace(/\r\n/g, ' ').replace(/\n+/g, ' ').trim();
        };

        return (
          trySel('div[data-track-load="description_content"]') ||
          trySel('.question-content') ||
          trySel('.content__u3I1') ||
          trySel('#description') ||
          null
        );
      });
      return desc;
    }

    // Generic fallback: return main article/text nodes
    const generic = await page.evaluate(() => {
      const body = document.querySelector('body');
      if (!body) return null;
      return body.innerText.slice(0, 2000).replace(/\r\n/g, ' ').replace(/\n+/g, ' ').trim();
    });
    return generic;
  } catch (err) {
    console.warn('Failed to fetch', url, err.message || err);
    return null;
  }
}

async function main() {
  const { limit, headless } = parseArgs();
  console.log('build_corpus.js starting — headless=', headless, 'limit=', limit || 'ALL');

  const problems = await loadProblems();
  let corpus = (await loadExistingCorpus()) || problems.map((p) => ({ ...p, description: p.description || null }));

  // map url -> index for quick lookup
  const urlToIdx = new Map();
  corpus.forEach((p, i) => urlToIdx.set(p.url, i));

  const browser = await puppeteer.launch({ headless, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

  const total = corpus.length;
  const toProcess = [];
  for (let i = 0; i < total; i++) {
    if (limit && toProcess.length >= limit) break;
    if (!corpus[i].description || corpus[i].description === null) toProcess.push(i);
  }

  console.log('Total problems:', total, 'to fetch descriptions for:', toProcess.length);

  let processed = 0;
  for (const idx of toProcess) {
    const p = corpus[idx];
    const desc = await extractDescription(page, p);
    if (desc) corpus[idx].description = desc;

    processed++;
    if (processed % 10 === 0) {
      console.log(`Processed ${processed}/${toProcess.length} (idx ${idx})`);
    }

    if (processed % 100 === 0) {
      console.log('Saving interim corpus...');
      await saveCorpus(corpus);
    }

    // polite delay
    await sleep(500);
  }

  await saveCorpus(corpus);
  await browser.close();
  console.log('Done — corpus saved to', OUT_PATH);
}

main().catch((err) => {
  console.error('build_corpus failed:', err);
  process.exit(1);
});
