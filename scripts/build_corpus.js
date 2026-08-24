/**
 * scripts/build_corpus.js
 * Builds the corpus by scraping problem platforms.
 */

import fs from "fs/promises";
import path from "path";
import { scrapers } from "./scrapers/index.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { limit: Infinity, descriptionLimit: 0 };

  for (let i = 0; i < args.length; i++) {
    const limitMatch = args[i].match(/^--limit=(\d+)$/);
    if (limitMatch) out.limit = parseInt(limitMatch[1], 10) || 0;
    
    const descMatch = args[i].match(/^--descriptions=(\d+)$/);
    if (descMatch) out.descriptionLimit = parseInt(descMatch[1], 10) || 0;

    if (args[i] === "--limit" && args[i + 1] && !args[i + 1].startsWith("--")) {
      out.limit = parseInt(args[i + 1], 10) || 0;
    }
    if (args[i] === "--descriptions" && args[i + 1] && !args[i + 1].startsWith("--")) {
      out.descriptionLimit = parseInt(args[i + 1], 10) || 0;
    }
  }

  return out;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function saveJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  const { limit, descriptionLimit } = parseArgs();
  console.log(`Starting... Target: ${isFinite(limit) ? limit : "ALL"}`);

  const allProblems = [];

  for (const [platformName, fetchProblems] of Object.entries(scrapers)) {
    let problems = [];
    try {
      problems = await fetchProblems({ limit, descriptionLimit });
    } catch (err) {
      console.error(`[${platformName}] Scraper failed: ${err.message}`);
    }

    const platformFile = path.resolve(`./backend/corpus/${platformName}.json`);
    await saveJson(platformFile, problems);
    
    allProblems.push(...problems);
  }

  const combinedPath = path.resolve("./backend/corpus/combined_corpus.json");
  await saveJson(combinedPath, allProblems);

  const legacyPath = path.resolve("./backend/corpus/all_problems.json");
  await saveJson(legacyPath, allProblems);

  console.log(`Done. Total problems: ${allProblems.length}`);
}

main().catch((err) => {
  console.error("build_corpus.js failed:", err);
  process.exit(1);
});