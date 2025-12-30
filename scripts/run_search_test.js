import fs from 'fs/promises';
import pkg from 'natural';
import preprocess from '../utils/preprocess.js';

const { TfIdf } = pkg;

async function test(query, limit = 2000) {
  const raw = await fs.readFile('./corpus/all_problems.json','utf8');
  const problems = JSON.parse(raw).slice(0, limit);

  const tfidf = new TfIdf();
  const docVectors = [];
  const docMagnitudes = [];

  problems.forEach((p, idx) => {
    const text = preprocess(`${p.title} ${p.title} ${p.description || ''}`);
    tfidf.addDocument(text, idx.toString());
  });

  problems.forEach((_, idx) => {
    const vector = {};
    let sumSq = 0;
    tfidf.listTerms(idx).forEach(({term, tfidf: w})=>{ vector[term]=w; sumSq+=w*w });
    docVectors[idx]=vector;
    docMagnitudes[idx]=Math.sqrt(sumSq)||1;
  });

  const q = preprocess(query);
  const tokens = q.split(' ').filter(Boolean);
  const termFreq = {};
  tokens.forEach(t=> termFreq[t]=(termFreq[t]||0)+1);
  const N = tokens.length||1;
  const queryVector = {};
  let sumSqQ = 0;
  Object.entries(termFreq).forEach(([term,count])=>{
    const tf = count / N;
    const idf = tfidf.idf(term) || 0;
    const w = tf * idf;
    queryVector[term]=w; sumSqQ+=w*w;
  });
  const qMag = Math.sqrt(sumSqQ)||1;

  const scores = problems.map((p, idx)=>{
    let dot = 0;
    for (const [t,wq] of Object.entries(queryVector)) {
      if (docVectors[idx][t]) dot += wq * docVectors[idx][t];
    }
    return { idx, score: dot/(qMag*docMagnitudes[idx]||1) };
  });

  const top = scores.sort((a,b)=>b.score-a.score).slice(0,10).filter(s=>s.score>0);
  console.log('Query:', query);
  console.log('Top results:');
  top.forEach((t,i)=>{
    const p = problems[t.idx];
    console.log(`${i+1}. (${t.score.toFixed(4)}) ${p.title} — ${p.url}`);
  });
}

const args = process.argv.slice(2);
const q = args[0] || 'binary search';
const lim = Number(args[1]) || 2000;
test(q, lim).catch(e=>{console.error(e); process.exit(1)});
