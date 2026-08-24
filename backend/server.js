import express from "express";
import fs from "fs/promises";
import pkg from "natural";
import cors from "cors";

import preprocess from "./utils/preprocess.js";

const { TfIdf } = pkg;

const app = express();
const PORT = process.env.PORT || 5000;

console.log('server.js starting, PID', process.pid, 'PORT', PORT);

// Configure CORS for production deployment
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5000"
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin or file:// origin
    if (!origin || origin === "null") return callback(null, true);
    
    // allow any localhost/127.0.0.1 port and any vercel app
    if (
      origin.startsWith("http://localhost:") || 
      origin.startsWith("http://127.0.0.1:") || 
      origin.endsWith(".vercel.app")
    ) {
      return callback(null, true);
    }
    
    callback(new Error("Not allowed by CORS"));
  }
}));

app.use(express.json());
// When backend is split from frontend, it typically doesn't serve the frontend statically anymore.
// We can leave express.static(".") here but in production the frontend lives on Vercel.
app.use(express.static("."));

// Simple request logger for debugging
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

// Helpful GET handler so navigating to /search doesn't return a bare 404
app.get('/search', (req, res) => {
  res.status(405).json({
    error: "Use POST /search with JSON body: { query: 'your terms', platform: 'all' | 'LeetCode' | 'Codeforces' | 'AtCoder' }",
  });
});

let problems = [];
let tfidf = new TfIdf();

// store each document's tf-idf vector and its magnitude
let docVectors = [];
let docMagnitudes = [];

// Pre-built platform → [indices] map for O(1) candidate pre-filtering.
// Keys are normalised to lowercase for case-insensitive matching at query time.
let platformIndex = new Map();

let indexReady = false;

async function loadProblemsAndBuildIndex() {
  console.log('Reading corpus file...');
  // Read from combined_corpus.json — the canonical output of build_corpus.js.
  // Falls back to all_problems.json for backward compatibility.
  let data;
  try {
    data = await fs.readFile("./corpus/combined_corpus.json", "utf-8");
    console.log('Loaded corpus: combined_corpus.json');
  } catch {
    data = await fs.readFile("./corpus/all_problems.json", "utf-8");
    console.log('Loaded corpus: all_problems.json (fallback)');
  }
  problems = JSON.parse(data);
  console.log('Loaded problems:', problems.length);

  tfidf = new TfIdf();

  console.log('Adding documents to TfIdf...');
  // Add documents: title boosted by duplicating, plus description and tags
  for (let idx = 0; idx < problems.length; idx++) {
    const problem = problems[idx];
    const tagText = (problem.tags || []).join(" ");
    const text = preprocess(
      `${problem.title} ${problem.title} ${problem.description || ""} ${tagText} ${tagText}`
    );
    tfidf.addDocument(text, idx.toString());
    
    if ((idx + 1) % 2000 === 0) {
      console.log('  added', idx + 1, 'docs');
      await new Promise(r => setImmediate(r)); // yield event loop
    }
  }

  // Build document vectors and magnitudes for cosine similarity
  console.log('Building document vectors...');
  docVectors = [];
  docMagnitudes = [];
  platformIndex = new Map();

  for (let idx = 0; idx < problems.length; idx++) {
    const problem = problems[idx];
    const vector = {};
    let sumSquares = 0;

    tfidf.listTerms(idx).forEach(({ term, tfidf: weight }) => {
      vector[term] = weight;
      sumSquares += weight * weight;
    });

    docVectors[idx] = vector;
    docMagnitudes[idx] = Math.sqrt(sumSquares);
    
    if ((idx + 1) % 2000 === 0) {
      console.log('  processed vectors for', idx + 1);
      await new Promise(r => setImmediate(r)); // yield event loop
    }

    // Index by platform (normalised lowercase key) for fast pre-filtering.
    const platformKey = (problem.platform || 'unknown').toLowerCase();
    if (!platformIndex.has(platformKey)) platformIndex.set(platformKey, []);
    platformIndex.get(platformKey).push(idx);
  }

  const platformSummary = [...platformIndex.entries()]
    .map(([k, v]) => `${k}(${v.length})`)
    .join(', ');
  console.log('Platform index built:', platformSummary);
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

  // Platform filter
  // Accept 'all' (or omitted) for the full corpus, or a specific platform name.
  // Comparison is case-insensitive 
  const rawPlatform = req.body.platform;
  const platformFilter =
    !rawPlatform || rawPlatform.toLowerCase() === "all"
      ? null
      : rawPlatform.toLowerCase();

  // Pre-filter candidate index set — O(1) Map lookup.
  // If a specific platform was requested but is unknown, return an empty result
  // immediately without touching any vectors.
  let candidateIndices;
  if (platformFilter === null) {
    // All platforms — operate over the full index range.
    candidateIndices = null; // null signals "use all problems" below
  } else {
    candidateIndices = platformIndex.get(platformFilter);
    if (!candidateIndices || candidateIndices.length === 0) {
      return res.json({ results: [] });
    }
  }

  // Build query TF×IDF vector (unchanged)
  const query  = preprocess(rawQuery);
  const tokens = query.split(" ").filter(Boolean);

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
    const w   = tf * idf;
    queryVector[term] = w;
    sumSqQ += w * w;
  });
  const queryMag = Math.sqrt(sumSqQ) || 1;

  // Cosine similarity — only over the pre-filtered candidate set ]
  // When candidateIndices is null we iterate all documents (platform === 'all').
  const indicesToScore = candidateIndices ?? problems.map((_, i) => i);

  const scores = indicesToScore.map((idx) => {
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

  // Return top 10 non-zero matches with full schema 
  const top = scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ idx, score }) => {
      const p = problems[idx];
      return {
        id: p.id ?? null,
        title: p.title,
        url: p.url,
        platform: p.platform ?? null,
        difficulty: p.difficulty ?? null,
        tags: p.tags ?? [],
        score,                           // normalised cosine similarity [0, 1]
      };
    });

  res.json({ results: top });
});
// Health check endpoint for Render
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/", (req, res) => {
  res.status(200).send("CodeQuery Backend API is running.");
});

// Start server immediately so static assets and status are available
const server = app.listen(PORT, '0.0.0.0', () => {
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
