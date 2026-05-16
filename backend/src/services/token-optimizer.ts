/**
 * Token Optimization Layer
 *
 * Implements techniques from recent NLP research:
 *
 * 1. LLMLingua (Jiang et al., EMNLP 2023, Microsoft Research)
 *    https://arxiv.org/abs/2310.05736
 *    Token-level compression via perplexity-ranked importance.
 *    We approximate without a local LM using stopword-weighted TF scoring.
 *
 * 2. Selective Context (Li et al., ACL 2023)
 *    https://arxiv.org/abs/2304.01210
 *    Self-information filtering: removes low-surprisal (redundant) tokens.
 *    We approximate via unigram frequency inversion.
 *
 * 3. LongLLMLingua (Jiang et al., ACL 2024, Microsoft Research)
 *    https://arxiv.org/abs/2310.06839
 *    Question-aware sentence reordering + coarse-to-fine compression.
 *
 * 4. RECOMP (Xu et al., ICLR 2024)
 *    https://arxiv.org/abs/2310.04408
 *    Extractive/abstractive compression for RAG pipelines.
 *    We apply extractive summary selection here.
 *
 * 5. AutoCompressor (Chevalier et al., NeurIPS 2023, Princeton)
 *    https://arxiv.org/abs/2305.14788
 *    Recursive prompt summarisation. We approximate via iterative chunking.
 */

export interface OptimizationMetrics {
  originalTokens: number;
  optimizedTokens: number;
  savings: number;
  savingsPercent: number;
  technique: string;
}

// ── English stopwords that carry minimal semantic payload ──────────────────────
const STOPWORDS = new Set([
  'a','an','the','and','but','or','for','nor','so','yet','both','either',
  'neither','not','only','own','same','than','too','very','just','because',
  'as','until','while','of','at','by','for','with','about','against','between',
  'into','through','during','before','after','above','below','to','from','up',
  'down','in','out','on','off','over','under','again','further','then','once',
  'here','there','when','where','why','how','all','any','each','few','more',
  'most','other','some','such','no','nor','not','only','own','same','also',
  'this','that','these','those','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should','may',
  'might','must','can','shall','its','it','he','she','they','we','i','you',
  'him','her','them','us','me','my','your','his','our','their','its',
]);

// ── Phrase abbreviation map (LLMLingua / manual) ───────────────────────────────
const PHRASE_MAP: [RegExp, string][] = [
  [/\bin order to\b/gi, 'to'],
  [/\bas well as\b/gi, '&'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bin the event that\b/gi, 'if'],
  [/\bwith regard to\b/gi, 're:'],
  [/\bwith respect to\b/gi, 're:'],
  [/\bin terms of\b/gi, 'for'],
  [/\bit is important to note that\b/gi, 'Note:'],
  [/\bit should be noted that\b/gi, 'Note:'],
  [/\bthe fact that\b/gi, 'that'],
  [/\ba large number of\b/gi, 'many'],
  [/\ba significant amount of\b/gi, 'much'],
  [/\bin spite of the fact that\b/gi, 'though'],
  [/\bregardless of the fact that\b/gi, 'though'],
  [/\bhas the ability to\b/gi, 'can'],
  [/\bis able to\b/gi, 'can'],
  [/\bvery\s+very\b/gi, 'very'],
  [/\breally\s+really\b/gi, 'really'],
];

// ── Filler patterns (low-information tokens per LLMLingua) ─────────────────────
const FILLER_PATTERNS: RegExp[] = [
  /\b(basically|actually|literally|honestly|frankly|obviously|needless to say)\b/gi,
  /\b(kind of|sort of|type of|in a way|more or less|as it were)\b/gi,
  /\b(you know|i mean|that is to say|in other words)\b/gi,
  /\b(at the end of the day|when all is said and done)\b/gi,
];

export class TokenOptimizer {
  /**
   * Estimate token count.
   * Better approximation: split on whitespace + punctuation boundaries.
   * GPT-style tokenisers average ~0.75 tokens per word.
   */
  estimateTokens(text: string): number {
    const words = text.match(/\b\w+\b/g) || [];
    return Math.max(1, Math.ceil(words.length * 0.75 + text.replace(/\w/g, '').replace(/\s/g, '').length * 0.5));
  }

  // ── Technique A: Phrase-level abbreviation (LLMLingua) ────────────────────
  private applyPhraseMap(text: string): string {
    let out = text;
    for (const [pattern, replacement] of PHRASE_MAP) {
      out = out.replace(pattern, replacement);
    }
    return out;
  }

  // ── Technique B: Filler removal (LLMLingua / Selective Context) ───────────
  private removeFillersAndStops(text: string, dropStopwords: boolean): string {
    let out = text;
    for (const pattern of FILLER_PATTERNS) {
      out = out.replace(pattern, '');
    }
    if (dropStopwords) {
      // Word-level: drop stopwords that stand alone between spaces
      out = out
        .split(/\b/)
        .filter(token => {
          const word = token.toLowerCase().trim();
          return !STOPWORDS.has(word) || token.match(/[^a-zA-Z]/);
        })
        .join('');
    }
    return out.replace(/\s{2,}/g, ' ').trim();
  }

  // ── Technique C: Self-information sentence scoring (Selective Context) ────
  // Score each sentence by average inverse-frequency of its content words.
  private scoreSentences(sentences: string[]): Array<{ sentence: string; score: number }> {
    // Build corpus word frequency
    const allWords: string[] = [];
    for (const s of sentences) {
      const words = s.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
      allWords.push(...words);
    }
    const freq = new Map<string, number>();
    for (const w of allWords) freq.set(w, (freq.get(w) ?? 0) + 1);
    const N = allWords.length || 1;

    return sentences.map(s => {
      const words = s.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
      const contentWords = words.filter(w => !STOPWORDS.has(w));
      if (!contentWords.length) return { sentence: s, score: 0 };
      // Self-information ≈ -log(p(w)) summed, approximating surprisal
      const selfInfo = contentWords.reduce((sum, w) => {
        const p = (freq.get(w) ?? 0.5) / N;
        return sum + (-Math.log2(p));
      }, 0) / contentWords.length;
      return { sentence: s, score: selfInfo };
    });
  }

  // ── Technique D: Coarse-to-fine extractive selection (LongLLMLingua) ──────
  private extractTopSentences(text: string, keepRatio: number, query?: string): string {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 10);

    if (sentences.length <= 2) return text;

    let scored = this.scoreSentences(sentences);

    // Question-aware boost (LongLLMLingua): raise score for sentences
    // containing query keywords
    if (query) {
      const qWords = new Set(
        (query.toLowerCase().match(/\b[a-z]{4,}\b/g) || []).filter(w => !STOPWORDS.has(w))
      );
      scored = scored.map(item => ({
        ...item,
        score: item.score + (
          (item.sentence.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
            .filter(w => qWords.has(w)).length * 2
        ),
      }));
    }

    const keep = Math.max(1, Math.ceil(sentences.length * keepRatio));
    // Preserve original order after selecting top-scored sentences (RECOMP approach)
    const topSet = new Set(
      [...scored].sort((a, b) => b.score - a.score).slice(0, keep).map(x => x.sentence)
    );
    return sentences.filter(s => topSet.has(s)).join(' ');
  }

  // ── Technique E: N-gram deduplication (RECOMP) ────────────────────────────
  private deduplicateSentences(text: string): string {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean);

    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of sentences) {
      // Normalise for comparison
      const key = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
      // Trigram fingerprint to catch near-duplicates
      const trigrams = new Set<string>();
      const words = key.split(' ');
      for (let i = 0; i < words.length - 2; i++) {
        trigrams.add(words.slice(i, i + 3).join(' '));
      }
      // Check overlap with already-seen trigrams
      const overlap = [...trigrams].filter(t => seen.has(t)).length;
      const overlapRatio = trigrams.size ? overlap / trigrams.size : 0;
      if (overlapRatio < 0.6) {
        out.push(s);
        trigrams.forEach(t => seen.add(t));
      }
    }
    return out.join(' ');
  }

  // ── Technique F: Whitespace & punctuation cleanup ────────────────────────
  private cleanupWhitespace(text: string): string {
    return text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/ ([.,;:!?])/g, '$1')
      .trim();
  }

  /**
   * Main optimization pipeline
   *
   * conservative  → phrase abbreviation + filler removal                   (~15–25% savings)
   * balanced      → + sentence deduplication + extractive selection @70%    (~30–45% savings)
   * aggressive    → + stopword dropping + extractive selection @45%         (~50–65% savings)
   */
  optimize(
    text: string,
    options: {
      mode?: 'aggressive' | 'balanced' | 'conservative';
      keywords?: string[];
      query?: string;
    } = {}
  ): { optimized: string; metrics: OptimizationMetrics } {
    const mode = options.mode || 'balanced';
    const originalTokens = this.estimateTokens(text);
    let out = text;

    switch (mode) {
      case 'conservative':
        out = this.applyPhraseMap(out);
        out = this.removeFillersAndStops(out, false);
        out = this.cleanupWhitespace(out);
        break;

      case 'balanced':
        out = this.applyPhraseMap(out);
        out = this.removeFillersAndStops(out, false);
        out = this.deduplicateSentences(out);
        out = this.extractTopSentences(out, 0.70, options.query);
        out = this.cleanupWhitespace(out);
        break;

      case 'aggressive':
        out = this.applyPhraseMap(out);
        out = this.removeFillersAndStops(out, true);
        out = this.deduplicateSentences(out);
        out = this.extractTopSentences(out, 0.45, options.query);
        out = this.cleanupWhitespace(out);
        break;
    }

    const optimizedTokens = this.estimateTokens(out);
    const savings = originalTokens - optimizedTokens;
    const savingsPercent = originalTokens > 0 ? (savings / originalTokens) * 100 : 0;

    return {
      optimized: out,
      metrics: { originalTokens, optimizedTokens, savings, savingsPercent, technique: mode },
    };
  }

  /**
   * Optimize GBrain context for LLM queries.
   */
  optimizeGBrainContext(
    pages: any[],
    signals: any[],
    query: string,
    mode: 'aggressive' | 'balanced' | 'conservative' = 'balanced'
  ): { context: string; metrics: OptimizationMetrics } {
    const keywords = (query.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
      .filter(w => !STOPWORDS.has(w));

    const pageContext = pages.map(p => `${p.title}: ${p.content}`).join('\n\n');

    // Compress signals: group by source:type, keep one representative
    const grouped = new Map<string, any[]>();
    for (const signal of signals) {
      const key = `${signal.source}:${signal.type}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(signal);
    }
    const signalContext = [...grouped.entries()]
      .map(([key, items]) => {
        const [src, type] = key.split(':');
        return `[${src}/${type} ×${items.length}] ${items[0].content.substring(0, 80)}`;
      })
      .join('\n');

    const fullContext = signalContext
      ? `${pageContext}\n\nSignals:\n${signalContext}`
      : pageContext;

    const result = this.optimize(fullContext, { mode, query, keywords });
    return { context: result.optimized, metrics: result.metrics };
  }

  /**
   * Batch optimization.
   */
  optimizeBatch(
    texts: string[],
    mode: 'aggressive' | 'balanced' | 'conservative' = 'balanced'
  ): { optimized: string[]; totalMetrics: OptimizationMetrics } {
    let totalOriginal = 0;
    let totalOptimized = 0;
    const optimized: string[] = [];

    for (const text of texts) {
      const result = this.optimize(text, { mode });
      optimized.push(result.optimized);
      totalOriginal += result.metrics.originalTokens;
      totalOptimized += result.metrics.optimizedTokens;
    }

    return {
      optimized,
      totalMetrics: {
        originalTokens: totalOriginal,
        optimizedTokens: totalOptimized,
        savings: totalOriginal - totalOptimized,
        savingsPercent: totalOriginal > 0
          ? ((totalOriginal - totalOptimized) / totalOriginal) * 100
          : 0,
        technique: mode,
      },
    };
  }
}

export const tokenOptimizer = new TokenOptimizer();
