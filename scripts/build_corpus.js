/**
 * scripts/build_corpus.js
 *
 * Corpus Builder
 *
 * Drives all registered scraper adapters, saves per-platform JSON files,
 * and produces a combined corpus consumed by the TF-IDF search server.
 *
 * Usage:
 *   node scripts/build_corpus.js              # scrape all platforms, default limit
 *   node scripts/build_corpus.js --limit=50   # cap at 50 problems per platform
 *   node scripts/build_corpus.js --limit=5 --no-headless
 *
 * Output files:
 *   backend/corpus/<PlatformName>.json    — per-platform raw data
 *   backend/corpus/combined_corpus.json   — all platforms merged (canonical path)
 *   backend/corpus/all_problems.json      — legacy path read by server.js (TF-IDF)
 *
 * Paths are resolved relative to the project root (where this script is run from),
 * so always run as: node scripts/build_corpus.js from the project root.
 */

import fs from "fs/promises";
import path from "path";
import { scrapers } from "./scrapers/index.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { limit: 100 };

  for (const arg of args) {
    // Accept both --limit=50 and --limit 50 styles.
    const eqMatch = arg.match(/^--limit=(\d+)$/);
    if (eqMatch) {
      out.limit = parseInt(eqMatch[1], 10) || 0;
    }
    const spaceIdx = args.indexOf("--limit");
    if (spaceIdx !== -1 && args[spaceIdx + 1] && !args[spaceIdx + 1].startsWith("--")) {
      out.limit = parseInt(args[spaceIdx + 1], 10) || 0;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function saveJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { limit } = parseArgs();

  console.log("=".repeat(60));
  console.log("build_corpus.js starting");
  console.log(  Platforms : );
  console.log(  Limit     :  problems per platform);
  console.log("=".repeat(60));

  const allProblems = [];

  for (const [platformName, fetchProblems] of Object.entries(scrapers)) {
    console.log(\n▶ Running scraper: );

    let problems = [];
    try {
      problems = await fetchProblems({ limit: limit || Infinity });
    } catch (err) {
      // A whole-adapter failure is logged but we continue with other platforms.
      console.error(`[${platformName}] ❌ Scraper failed entirely: `);
      console.error(err.stack);
    }

    console.log(`[${platformName}] Scraped ${problems.length} problem(s).`);

    // Save per-platform file into backend/corpus/ (co-located with the server).
    const platformFile = path.resolve(`./backend/corpus/${platformName}.json`);
    await saveJson(platformFile, problems);
    console.log(`[${platformName}] Saved → ${platformFile}`);

    allProblems.push(...problems);
  }

  // Save combined corpus — new canonical path.
  const combinedPath = path.resolve("./backend/corpus/combined_corpus.json");
  await saveJson(combinedPath, allProblems);
  console.log(`\n✅ Combined corpus → ${combinedPath}  (${allProblems.length} problems total)`);

  // Also write legacy path so server.js (TF-IDF server) continues to work
  // without any modification.
  const legacyPath = path.resolve("./backend/corpus/all_problems.json");
  await saveJson(legacyPath, allProblems);
  console.log(`✅ Legacy corpus  → ${legacyPath}`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("build_corpus.js failed:", err);
  process.exit(1);
});
