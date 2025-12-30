import fs from 'fs/promises';
import pkg from 'natural';
import preprocess from '../utils/preprocess.js';

const { TfIdf } = pkg;

async function run() {
  const raw = await fs.readFile('./corpus/all_problems.json','utf8');
  const problems = JSON.parse(raw).slice(0,100);
  const tfidf = new TfIdf();

  problems.forEach((p, idx) => {
    const text = preprocess(`${p.title} ${p.title} ${p.description || ''}`);
    tfidf.addDocument(text, idx.toString());
  });

  console.log('Added', problems.length, 'docs');
  const terms = tfidf.listTerms(0).slice(0,10).map(t=>t.term);
  console.log('Sample terms:', terms);
  console.log('IDF for "array":', tfidf.idf('array'));
}

run().catch(e=>{console.error('ERROR',e); process.exit(1)});
