/**
 * scripts/scrapers/index.js
 *
 * Scraper Registry
 *
 * Add a new platform by importing its adapter and adding an entry here.
 * The key MUST match the platform name used in the schema (platform field)
 * because build_corpus.js uses it as the per-platform output filename.
 *
 * Each adapter must export:
 *   fetchProblems({ limit: number }): Promise<Array<Problem>>
 *
 * Where Problem = {
 *   id: string,
 *   title: string,
 *   url: string,
 *   description: string | null,
 *   platform: string,
 *   difficulty: string | null,
 *   tags: string[]
 * }
 */

import { fetchProblems as fetchLeetCode } from "./leetcode.js";
import { fetchProblems as fetchCodeforces } from "./codeforces.js";
import { fetchProblems as fetchAtCoder } from "./atcoder.js";

/**
 * Registry of all active scraper adapters.
 * Key   = platform display name (also used as output filename stem).
 * Value = fetchProblems function conforming to the adapter interface.
 */
export const scrapers = {
  LeetCode:   fetchLeetCode,
  Codeforces: fetchCodeforces,
  AtCoder:    fetchAtCoder,
};
