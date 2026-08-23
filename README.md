# DSA Search Engine

A full-stack, NLP-powered search engine for discovering Data Structures and Algorithms (DSA) problems across popular competitive programming platforms like LeetCode and Codeforces. 

## ✨ Features
- **Automated Scraping:** Uses Puppeteer to seamlessly aggregate problem sets and their descriptions from various coding platforms.
- **Smart NLP Search:** Implements a custom in-memory search engine utilizing Term Frequency-Inverse Document Frequency (TF-IDF) and Cosine Similarity for highly relevant search retrieval (via the `natural` library).
- **Zero-Downtime Indexing:** Background index generation allows the REST API to start up instantly, handling traffic and providing status updates while processing large problem corpus files in the background.
- **Clean Frontend UI:** Contains a sleek vanilla HTML/CSS/JS frontend to query and visualize the search results seamlessly.

## 🛠️ Tech Stack
- **Backend:** Node.js, Express
- **Search Engine:** `natural` (NLP, TF-IDF vectorization)
- **Web Scraping:** Puppeteer
- **Frontend:** HTML5, CSS3, Vanilla JavaScript

## 📋 Prerequisites
- **Node.js** (v16+ recommended)
- **npm** (Node Package Manager)

## 🚀 Getting Started

### 1. Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 2. Scraping and Building the Corpus
Fetch the latest problems and their full descriptions to build the local search corpus:

```bash
# Scrape basic problem data (URLs, titles)
npm run scrape:api

# Fetch full problem descriptions to build the search corpus
npm run build:corpus
```
*(Note: To limit the number of problems processed during testing, you can run the corpus builder directly with a limit flag: `node scripts/build_corpus.js --limit 50`)*

### 3. Running the Server
Start the Express server:
```bash
npm start
```
The server will start on port `5000` (or `process.env.PORT`) and begin building the search index in the background.

### 4. Using the Search UI
Open your browser and navigate to `http://localhost:5000/` to interact with the search engine frontend.

## 📡 API Reference

### `POST /search`
Searches the corpus for relevant DSA problems based on your natural language query.

**Request Body (JSON):**
```json
{
  "query": "binary search tree traversal"
}
```

**Response:**
- `200 OK`: Returns the top 10 matching results.
  ```json
  {
    "results": [
      {
        "title": "Validate Binary Search Tree",
        "url": "https://leetcode.com/...",
        "description": "Given the root of a binary tree...",
        "platform": "LeetCode"
      }
    ]
  }
  ```
- `503 Service Unavailable`: Returned if the search index is still compiling in the background.
- `400 Bad Request`: Returned if the query payload is invalid or missing.
