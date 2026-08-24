/**
 * scripts/scrapers/leetcode.js
 * Scrapes LeetCode problem stubs and optionally fetches descriptions.
 */

import puppeteer from "puppeteer";

const BASE_URL = "https://leetcode.com";
const PROBLEM_LIST_URL = `${BASE_URL}/problemset/`;

async function collectAllStubs(page, limit) {
  await page.goto(PROBLEM_LIST_URL, { waitUntil: "domcontentloaded" });

  const stubs = [];
  let skip = 0;
  const chunkSize = 100;

  while (stubs.length < limit) {
    const data = await page.evaluate(async (chunkSize, skip) => {
      const query = `
        query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
          problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
            questions: data {
              title
              titleSlug
              difficulty
              topicTags { name }
            }
          }
        }
      `;
      const res = await fetch("https://leetcode.com/graphql/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          variables: { categorySlug: "", limit: chunkSize, skip, filters: {} }
        })
      });
      return await res.json();
    }, chunkSize, skip);

    const questions = data?.data?.problemsetQuestionList?.questions || [];
    if (questions.length === 0) break;

    for (const q of questions) {
      stubs.push({
        title: q.title,
        url: `${BASE_URL}/problems/${q.titleSlug}`,
        difficulty: q.difficulty,
        tags: q.topicTags.map(t => t.name)
      });
    }

    skip += questions.length;
    
    if (stubs.length % 500 === 0) {
      console.log(`[LeetCode] Fetched ${stubs.length} stubs...`);
    }

    if (questions.length < chunkSize) break;
    await new Promise(r => setTimeout(r, 200));
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

      stubs[i].description = description;
    } catch (err) {}

    if ((i + 1) % 50 === 0) {
      console.log(`[LeetCode] Descriptions: ${i + 1}/${toEnrich.length}`);
    }

    await new Promise(r => setTimeout(r, 600));
  }

  return stubs;
}

export async function fetchProblems({ limit = Infinity, descriptionLimit = 0 } = {}) {
  const effectiveLimit = isFinite(limit) ? limit : 9999;
  
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

    const problems = stubs.map((s, i) => ({
      id:          s.url.replace(/\/$/, "").split("/").pop() ?? String(i),
      title:       s.title,
      url:         s.url,
      description: s.description ?? null,
      platform:    "LeetCode",
      difficulty:  s.difficulty,
      tags:        s.tags,
    }));

    return problems;
  } finally {
    await browser.close();
  }
}