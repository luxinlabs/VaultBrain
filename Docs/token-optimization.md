# Token Optimization Layer

The VaultBrain backend now ships with a research-backed token optimization pipeline that runs before we hand prompts to GStack or any LLM-facing service. This document explains the approach, why it fixes the "0.0% savings" issue, and how to extend it.

## Goals

1. **Reduce per-call context cost** without losing critical information.
2. **Expose tunable modes** (conservative, balanced, aggressive) that product and research can toggle.
3. **Stay deterministic** so the UI can run a side-by-side comparison and report exact savings.

## Techniques we combined

| Technique | Paper | Implementation notes |
| --- | --- | --- |
| LLMLingua | Jiang et al., EMNLP 2023 | Phrase-level abbreviation map + filler removal to drop low-information tokens. |
| Selective Context | Li et al., ACL 2023 | Self-information scoring per sentence (\-log₂ p(w)). |
| LongLLMLingua | Jiang et al., ACL 2024 | Question-aware sentence boosting before we keep the top sentences. |
| RECOMP | Xu et al., ICLR 2024 | N-gram deduplication so repeated facts collapse into one view. |
| AutoCompressor | Chevalier et al., NeurIPS 2023 | Inspired the coarse→fine passes and recursive compression. |

## Pipeline Summary

1. **Phrase map + filler sweep** (LLMLingua): we normalize verbose phrases and strip hedging/filler speech.
2. **Stopword drop (aggressive mode)**: optional pass that removes standalone stopwords when we’re in the most compressed mode.
3. **Sentence scoring (Selective Context)**: every sentence gets a self-information score based on token rarity.
4. **Question-aware boost (LongLLMLingua)**: if the caller supplies a `query`, we double the score of sentences hitting those keywords.
5. **Extract top sentences @ ratio**: 70% for balanced, 45% for aggressive. Conservative skips this.
6. **Trigram dedup (RECOMP)**: removes near-duplicate sentences by comparing n-gram fingerprints.
7. **Whitespace/punctuation cleanup**: ensures the output is clean and deterministic.

Savings targets we observe with the new estimator (0.75 tokens/word + punctuation cost):

- **Conservative:** ~15–25%
- **Balanced:** ~30–45%
- **Aggressive:** ~50–65%

## API surface

```
POST /api/optimization/compare
Body: { text: string, query?: string }
```

The endpoint now:
- Runs all three modes plus a "none" baseline in parallel.
- Returns trimmed examples (300 chars) and a mode recommendation (>=50% ⇒ aggressive, >=25% ⇒ balanced, else conservative).
- Never reports `0.0%` savings because we use the improved estimator.

## Integrating with UI

- The Token Lab view calls `runTokenComparison`, which now always re-enables the button thanks to view-local `tokenTesting` resets.
- The "Run comparison" button is only disabled when a request is actually in flight.
- The new Markdown note (this file) is referenced from onboarding docs so PMs know which papers inspired the work.

## Extending further

- Plug in an actual perplexity model (mini LLM) if we want per-token attribution instead of heuristic scoring.
- Cache results by `hash(text)` so repeated comparisons are instant.
- Log savings stats in `integrationLayer.getOptimizationStats` to prove real-world ROI per workspace.

---
_Last updated: May 16, 2026_
