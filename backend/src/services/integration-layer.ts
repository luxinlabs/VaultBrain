/**
 * Integration Layer: GBrain ↔ GStack ↔ The Hog
 * 
 * This layer orchestrates data flow between:
 * - GBrain: Persistent knowledge storage (SQLite)
 * - GStack: Agent orchestration (external service)
 * - The Hog: Live web intelligence (API)
 * - Token Optimizer: Reduces LLM token usage
 * 
 * Architecture:
 * ┌─────────────┐
 * │   GStack    │ ← Agent queries
 * │  (External) │
 * └──────┬──────┘
 *        │
 *        ↓
 * ┌─────────────────────────────┐
 * │   Integration Layer         │
 * │  - Query routing            │
 * │  - Context assembly         │
 * │  - Token optimization       │
 * │  - Response formatting      │
 * └──┬────────┬─────────┬───────┘
 *    │        │         │
 *    ↓        ↓         ↓
 * ┌──────┐ ┌──────┐ ┌────────┐
 * │GBrain│ │ Hog  │ │Optimize│
 * │(SQLite)│ │(API) │ │(Layer) │
 * └──────┘ └──────┘ └────────┘
 */

import { gbrainService } from './gbrain';
import { hogConnector } from './hog-connector';
import { tokenOptimizer, OptimizationMetrics } from './token-optimizer';
import { User } from '../types';

export interface QueryContext {
  pages: any[];
  signals: any[];
  timeline: any[];
  contributors: any[];
}

export interface IntegrationResponse {
  answer: string;
  context: QueryContext;
  optimization: OptimizationMetrics;
  sources: string[];
}

export class IntegrationLayer {
  /**
   * Main query handler - routes to appropriate services
   */
  async handleQuery(
    query: string,
    user: User,
    options: {
      includeHogSignals?: boolean;
      optimizationMode?: 'aggressive' | 'balanced' | 'conservative';
      maxPages?: number;
    } = {}
  ): Promise<IntegrationResponse> {
    const optimizationMode = options.optimizationMode || 'balanced';
    const maxPages = options.maxPages || 5;

    // Step 1: Search GBrain for relevant pages
    const pages = gbrainService.search(query, user, { limit: maxPages });
    
    // Step 2: Gather signals from The Hog (if requested)
    let signals: any[] = [];
    if (options.includeHogSignals && pages.length > 0) {
      // Get signals for the most relevant page
      const topPage = pages[0];
      signals = hogConnector.getSignals(topPage.slug, 10);
    }

    // Step 3: Get timeline and contributors for context
    const timeline = pages.length > 0 ? gbrainService.getTimeline(pages[0].slug, user) : [];
    const contributors = pages.length > 0 ? gbrainService.getContributors(pages[0].slug, user) : [];

    // Step 4: Optimize context for LLM
    const { context: optimizedContext, metrics } = tokenOptimizer.optimizeGBrainContext(
      pages,
      signals,
      query,
      optimizationMode
    );

    // Step 5: Build response (in production, this would call GStack)
    const answer = this.generateAnswer(query, optimizedContext, pages, signals);
    const sources = pages.map(p => p.slug);

    return {
      answer,
      context: { pages, signals, timeline, contributors },
      optimization: metrics,
      sources,
    };
  }

  /**
   * Enrich entity with The Hog data and store in GBrain
   */
  async enrichEntity(
    slug: string,
    entityName: string,
    entityType: 'company' | 'person',
    user: User
  ): Promise<{ signals: any[]; optimization: OptimizationMetrics }> {
    // Fetch from The Hog
    let hogData: any;
    if (entityType === 'company') {
      hogData = await hogConnector.scanWebsite(entityName);
    } else {
      hogData = await hogConnector.enrichPerson(entityName);
    }

    // Store signals in GBrain
    const signals = hogData.signals || [];
    for (const signal of signals) {
      gbrainService.addTimelineEntry(slug, {
        timestamp: signal.timestamp || new Date().toISOString(),
        event_type: signal.type,
        description: signal.content,
        source: `hog_${signal.source}`,
        source_url: signal.url,
        metadata: { engagement: signal.engagement },
      }, user);
    }

    // Optimize signal data for storage/retrieval
    const signalText = signals.map((s: any) => s.content).join('\n');
    const { metrics } = tokenOptimizer.optimize(signalText, { mode: 'balanced' });

    return { signals, optimization: metrics };
  }

  /**
   * Batch process multiple entities
   */
  async batchEnrich(
    entities: Array<{ slug: string; name: string; type: 'company' | 'person' }>,
    user: User
  ): Promise<{ processed: number; totalOptimization: OptimizationMetrics }> {
    let totalOriginal = 0;
    let totalOptimized = 0;
    let processed = 0;

    for (const entity of entities) {
      try {
        const result = await this.enrichEntity(entity.slug, entity.name, entity.type, user);
        totalOriginal += result.optimization.originalTokens;
        totalOptimized += result.optimization.optimizedTokens;
        processed++;
      } catch (error) {
        console.error(`Failed to enrich ${entity.slug}:`, error);
      }
    }

    return {
      processed,
      totalOptimization: {
        originalTokens: totalOriginal,
        optimizedTokens: totalOptimized,
        savings: totalOriginal - totalOptimized,
        savingsPercent: ((totalOriginal - totalOptimized) / totalOriginal) * 100,
        technique: 'batch',
      },
    };
  }

  /**
   * Generate answer from optimized context
   * In production, this would call GStack's LLM endpoint
   */
  private generateAnswer(query: string, context: string, pages: any[], signals: any[]): string {
    // Stub implementation - in production, call GStack
    const pageCount = pages.length;
    const signalCount = signals.length;
    
    return `Based on ${pageCount} page${pageCount === 1 ? '' : 's'} and ${signalCount} signal${signalCount === 1 ? '' : 's'} from GBrain and The Hog:\n\n${context.substring(0, 200)}...\n\n(In production, this would be a GStack-powered LLM response)`;
  }

  /**
   * Get optimization statistics
   */
  async getOptimizationStats(user: User): Promise<{
    totalPages: number;
    totalSignals: number;
    estimatedTokenSavings: OptimizationMetrics;
  }> {
    // Get all pages accessible to user
    const pages = gbrainService.search('', user, { limit: 100 });
    
    // Estimate token savings if all content was optimized
    const allContent = pages.map(p => p.content).join('\n\n');
    const { metrics } = tokenOptimizer.optimize(allContent, { mode: 'balanced' });

    return {
      totalPages: pages.length,
      totalSignals: 0, // Would query hog_signals table
      estimatedTokenSavings: metrics,
    };
  }
}

export const integrationLayer = new IntegrationLayer();
