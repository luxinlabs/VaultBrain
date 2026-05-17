import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { integrationLayer } from '../services/integration-layer';
import { tokenOptimizer } from '../services/token-optimizer';

const router = Router();

/**
 * Query with token optimization
 */
router.post('/query', authMiddleware, async (req, res) => {
  try {
    const { query, optimizationMode, includeHogSignals } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const result = await integrationLayer.handleQuery(query, req.user!, {
      optimizationMode: optimizationMode || 'balanced',
      includeHogSignals: includeHogSignals !== false,
    });

    res.json(result);
  } catch (error: any) {
    console.error('Query error:', error);
    res.status(500).json({ error: error.message || 'Query failed' });
  }
});

/**
 * Compare optimization modes
 */
router.post('/compare', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const { query } = req.body;
    const baseTokens = tokenOptimizer.estimateTokens(text);

    const noOptimization = {
      metrics: {
        originalTokens: baseTokens,
        optimizedTokens: baseTokens,
        savings: 0,
        savingsPercent: 0,
        technique: 'none',
      },
    };

    const conservative = tokenOptimizer.optimize(text, { mode: 'conservative', query });
    const balanced     = tokenOptimizer.optimize(text, { mode: 'balanced',     query });
    const aggressive   = tokenOptimizer.optimize(text, { mode: 'aggressive',   query });

    const trunc = (s: string) => s.length > 300 ? s.substring(0, 300) + '…' : s;

    const recommendation: 'aggressive' | 'balanced' | 'conservative' =
      aggressive.metrics.savingsPercent >= balanced.metrics.savingsPercent &&
      aggressive.metrics.savingsPercent >= conservative.metrics.savingsPercent
        ? 'aggressive'
        : balanced.metrics.savingsPercent >= conservative.metrics.savingsPercent
          ? 'balanced'
          : 'conservative';

    res.json({
      comparison: {
        none:         noOptimization.metrics,
        conservative: conservative.metrics,
        balanced:     balanced.metrics,
        aggressive:   aggressive.metrics,
      },
      examples: {
        original:     trunc(text),
        conservative: trunc(conservative.optimized),
        balanced:     trunc(balanced.optimized),
        aggressive:   trunc(aggressive.optimized),
      },
      recommendation,
    });
  } catch (error: any) {
    console.error('Comparison error:', error);
    res.status(500).json({ error: error.message || 'Comparison failed' });
  }
});

/**
 * Get optimization statistics for user's data
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await integrationLayer.getOptimizationStats(req.user!);
    res.json(stats);
  } catch (error: any) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message || 'Stats retrieval failed' });
  }
});

/**
 * Batch optimize multiple texts
 */
router.post('/batch', authMiddleware, async (req, res) => {
  try {
    const { texts, mode } = req.body;
    
    if (!texts || !Array.isArray(texts)) {
      return res.status(400).json({ error: 'texts array is required' });
    }

    const result = tokenOptimizer.optimizeBatch(texts, mode || 'balanced');
    
    res.json({
      optimizedTexts: result.optimized,
      metrics: result.totalMetrics,
      averageSavingsPerText: result.totalMetrics.savings / texts.length,
    });
  } catch (error: any) {
    console.error('Batch optimization error:', error);
    res.status(500).json({ error: error.message || 'Batch optimization failed' });
  }
});

export default router;
