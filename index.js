import express from "express";
import fs from "fs/promises";
import pkg from "natural";

import preprocess from "./utils/preprocess.js";

const { TfIdf } = pkg;

const app = express();
const PORT = process.env.PORT || 5000;

console.log('index.js starting, PID', process.pid, 'PORT', PORT);

app.use(express.json());
app.use(express.static("."));

// Simple request logger for debugging
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

// Helpful GET handler so navigating to /search doesn't return a bare 404
app.get('/search', (req, res) => {
  res.status(405).json({ error: "Use POST /search with JSON body: { query: 'your terms' }" });
});

let problems = [];
let tfidf = new TfIdf();

// store each document’s tf-idf vector and its magnitude
let docVectors = [];
let docMagnitudes = [];
let indexReady = false;

async function loadProblemsAndBuildIndex() {
  console.log('Reading corpus file...');
  const data = await fs.readFile("./corpus/all_problems.json", "utf-8");
  problems = JSON.parse(data);
  console.log('Loaded problems:', problems.length);

  tfidf = new TfIdf();

  console.log('Adding documents to TfIdf...');
  // Add documents: title boosted by duplicating, plus description
  problems.forEach((problem, idx) => {
    const text = preprocess(
      `${problem.title} ${problem.title} ${problem.description || ""}`
    );
    tfidf.addDocument(text, idx.toString());
    if ((idx + 1) % 2000 === 0) console.log('  added', idx + 1, 'docs');
  });

  // Build document vectors and magnitudes for cosine similarity
  console.log('Building document vectors...');
  docVectors = [];
  docMagnitudes = [];
  problems.forEach((_, idx) => {
    const vector = {};
    let sumSquares = 0;

    tfidf.listTerms(idx).forEach(({ term, tfidf: weight }) => {
      vector[term] = weight;
      sumSquares += weight * weight;
    });

    docVectors[idx] = vector;
    docMagnitudes[idx] = Math.sqrt(sumSquares);
    if ((idx + 1) % 2000 === 0) console.log('  processed vectors for', idx + 1);
  });
  console.log('Index build complete');
}
// Search endpoint: returns 503 while index building
app.post("/search", async (req, res) => {
  if (!indexReady) {
    return res.status(503).json({ error: 'Index building in progress. Try again shortly.' });
  }
  const rawQuery = req.body.query;

  if (!rawQuery || typeof rawQuery !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'query'" });
  }

  // Preprocess query and tokenize
  const query = preprocess(rawQuery);
  const tokens = query.split(" ").filter(Boolean);

  // Build the query TF×IDF vector
  const termFreq = {};
  tokens.forEach((t) => {
    termFreq[t] = (termFreq[t] || 0) + 1;
  });

  const queryVector = {};
  let sumSqQ = 0;
  const N = tokens.length;
  Object.entries(termFreq).forEach(([term, count]) => {
    const tf = count / N;
    const idf = tfidf.idf(term);
    const w = tf * idf;
    queryVector[term] = w;
    sumSqQ += w * w;
  });
  const queryMag = Math.sqrt(sumSqQ) || 1;

  // Compute cosine similarity against each document
  const scores = problems.map((_, idx) => {
    const docVec = docVectors[idx];
    const docMag = docMagnitudes[idx] || 1;
    let dot = 0;

    for (const [term, wq] of Object.entries(queryVector)) {
      if (docVec[term]) {
        dot += wq * docVec[term];
      }
    }

    const cosine = dot / (queryMag * docMag);
    return { idx, score: cosine };
  });

  // Take top 10 non-zero scores
  const top = scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ idx }) => {
      const p = problems[idx];
      const platform = p.url.includes("leetcode.com")
        ? "LeetCode"
        : "Codeforces";
      return { ...p, platform };
    });

  res.json({ results: top });
});
// Start server immediately so static assets and status are available
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.on('error', (err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});

// Build index in background and mark readiness when done
loadProblemsAndBuildIndex()
  .then(() => {
    indexReady = true;
    console.log('Index is ready — search endpoint available');
  })
  .catch((err) => {
    console.error('Index build failed:', err);
  });

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});