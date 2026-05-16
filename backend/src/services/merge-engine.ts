import { query } from '../db/client';
import { User, Page } from '../types';
import crypto from 'crypto';

export class MergeEngine {
  /**
   * Merge two versions of a page when multiple users edit the same entity
   */
  async mergePage(
    slug: string,
    existingContent: string,
    incomingContent: string,
    existingUser: User,
    incomingUser: User
  ): Promise<{ content: string; strategy: string; resolution: string }> {
    // Parse pages into sections
    const existing = this.parsePage(existingContent);
    const incoming = this.parsePage(incomingContent);

    // Strategy 1: Partner always wins
    if (incomingUser.role === 'partner' && existingUser.role === 'analyst') {
      return {
        content: incomingContent,
        strategy: 'partner_wins',
        resolution: 'Partner update overwrote analyst version'
      };
    }

    // Strategy 2: Timeline merge (append-only)
    if (existing.timeline && incoming.timeline) {
      const mergedTimeline = this.mergeTimelines(existing.timeline, incoming.timeline);
      const mergedContent = this.reconstructPage({
        ...incoming,
        timeline: mergedTimeline
      });

      return {
        content: mergedContent,
        strategy: 'timeline_append',
        resolution: 'Timelines merged, incoming compiled truth used'
      };
    }

    // Strategy 3: Latest wins (default)
    return {
      content: incomingContent,
      strategy: 'latest',
      resolution: `Latest update by ${incomingUser.name} accepted`
    };
  }

  /**
   * Parse markdown page into sections
   */
  private parsePage(content: string): {
    frontmatter?: string;
    compiledTruth?: string;
    timeline?: Array<{ timestamp: string; description: string }>;
  } {
    const sections = content.split('---\n');
    
    if (sections.length < 3) {
      return { compiledTruth: content };
    }

    const frontmatter = sections[1];
    const body = sections.slice(2).join('---\n');
    const parts = body.split(/\n## Timeline\n|\n---\n/);

    const compiledTruth = parts[0]?.trim();
    const timelineText = parts[1]?.trim();

    let timeline: Array<{ timestamp: string; description: string }> = [];
    if (timelineText) {
      timeline = timelineText
        .split('\n')
        .filter(line => line.startsWith('- '))
        .map(line => {
          const match = line.match(/^- (\d{4}-\d{2}-\d{2}): (.+)$/);
          return match ? { timestamp: match[1], description: match[2] } : null;
        })
        .filter(Boolean) as Array<{ timestamp: string; description: string }>;
    }

    return { frontmatter, compiledTruth, timeline };
  }

  /**
   * Merge timelines (deduplicate and sort)
   */
  private mergeTimelines(
    existing: Array<{ timestamp: string; description: string }>,
    incoming: Array<{ timestamp: string; description: string }>
  ): Array<{ timestamp: string; description: string }> {
    const combined = [...existing, ...incoming];
    
    // Deduplicate by timestamp + description
    const unique = Array.from(
      new Map(
        combined.map(entry => [
          `${entry.timestamp}-${entry.description}`,
          entry
        ])
      ).values()
    );

    // Sort by timestamp descending
    return unique.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /**
   * Reconstruct page from sections
   */
  private reconstructPage(sections: {
    frontmatter?: string;
    compiledTruth?: string;
    timeline?: Array<{ timestamp: string; description: string }>;
  }): string {
    let content = '';

    if (sections.frontmatter) {
      content += `---\n${sections.frontmatter}\n---\n\n`;
    }

    if (sections.compiledTruth) {
      content += sections.compiledTruth + '\n\n';
    }

    if (sections.timeline && sections.timeline.length > 0) {
      content += '---\n';
      sections.timeline.forEach(entry => {
        content += `- ${entry.timestamp}: ${entry.description}\n`;
      });
    }

    return content.trim();
  }

  /**
   * Record merge in database
   */
  async recordMerge(
    slug: string,
    mergedFrom: string[],
    strategy: string,
    content: string,
    resolution: string
  ): Promise<void> {
    await query(
      `INSERT INTO entity_merges (entity_slug, merged_from, merge_strategy, merged_content, conflict_resolution)
       VALUES ($1, $2, $3, $4, $5)`,
      [slug, mergedFrom, strategy, { content }, resolution]
    );
  }

  /**
   * Calculate content hash for deduplication
   */
  hash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

export const mergeEngine = new MergeEngine();
