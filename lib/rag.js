// Lightweight local RAG: BM25 keyword retrieval over the full corpus (no API),
// then ONE AI call to synthesize an answer with citations. Keeps API usage minimal.

function tokenize(text) {
  const t = String(text || '').toLowerCase();
  const toks = [];
  for (const w of t.match(/[a-z0-9]{2,}/g) || []) toks.push(w);
  const cn = t.replace(/[^一-龥]/g, '');
  for (let i = 0; i < cn.length - 1; i++) toks.push(cn.slice(i, i + 2)); // CN bigrams
  return toks;
}

export class Corpus {
  constructor() {
    this.docs = [];          // {id, text, meta}
    this.tf = [];            // Map term->count per doc
    this.len = [];           // doc length
    this.df = new Map();     // term -> doc count
    this.totalLen = 0;       // running sum, so docs added after finalize() still score
    this.k1 = 1.5; this.b = 0.75;
  }

  add(doc) {
    const toks = tokenize(doc.text);
    const tf = new Map();
    for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
    const idx = this.docs.length;
    this.docs.push(doc); this.tf.push(tf); this.len.push(toks.length); this.totalLen += toks.length;
    for (const term of tf.keys()) this.df.set(term, (this.df.get(term) || 0) + 1);
    return idx;
  }

  finalize() {}   // kept for callers; the average length is maintained on add()

  get avg() { return this.totalLen / Math.max(1, this.docs.length) || 1; }

  search(query, k = 8) {
    if (!this.docs.length) return [];
    const q = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const scores = new Array(N).fill(0);
    for (const term of q) {
      const df = this.df.get(term); if (!df) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (let i = 0; i < N; i++) {
        const f = this.tf[i].get(term); if (!f) continue;
        const denom = f + this.k1 * (1 - this.b + this.b * this.len[i] / this.avg);
        scores[i] += idf * (f * (this.k1 + 1)) / denom;
      }
    }
    return scores
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => ({ score: +x.s.toFixed(3), ...this.docs[x.i] }));
  }

  get size() { return this.docs.length; }
}
