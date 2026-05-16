import { query } from '../db/client';

type HogScanResponse = {
  signals: any[];
  summary?: Record<string, any>;
  [key: string]: any;
};

class HogApiError extends Error {
  status: number;
  endpointLabel: string;

  constructor(status: number, message: string, endpointLabel: string) {
    super(`The Hog API error (${status}) [${endpointLabel}]: ${message}`);
    this.status = status;
    this.endpointLabel = endpointLabel;
  }
}

type HogEndpoint = {
  baseUrl: string;
  scanPath: string;
  label: string;
};

export class HogConnector {
  private accessKey: string | null;
  private secretKey: string | null;
  private baseUrl: string;
  private endpoints: HogEndpoint[];

  constructor() {
    this.accessKey = process.env.HOG_ACCESS_KEY || null;
    this.secretKey = process.env.HOG_SECRET_KEY || null;
    this.baseUrl = (process.env.HOG_API_BASE_URL || 'https://developer.thehog.ai').replace(/\/$/, '');
    this.endpoints = this.buildEndpointMatrix();
  }

  private ensureApiKeys(): { accessKey: string; secretKey: string } {
    if (!this.accessKey || !this.secretKey) {
      throw new Error('HOG_ACCESS_KEY and HOG_SECRET_KEY must both be configured');
    }
    return { accessKey: this.accessKey, secretKey: this.secretKey };
  }

  private normalizeWebsite(raw: string): { url: string; domain: string } {
    const trimmed = raw.trim();
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    return { url: parsed.origin, domain: parsed.hostname };
  }

  async scan(entity: string, entityType: string, extraBody: Record<string, any> = {}): Promise<HogScanResponse> {
    const { accessKey, secretKey } = this.ensureApiKeys();
    let lastError: Error | null = null;

    for (const endpoint of this.endpoints) {
      const url = `${endpoint.baseUrl}${endpoint.scanPath}`;
      const payload = {
        url: entity,
        renderJs: false,
        ...extraBody
      };

      console.log('🐗 Hog scan request:', { url, entity, entityType, endpoint: endpoint.label });

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'X-Access-Key': accessKey,
            'X-Secret-Key': secretKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const text = await response.text();
        if (!response.ok) {
          const message = text;
          throw new HogApiError(response.status, message || response.statusText, endpoint.label);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!/json/i.test(contentType)) {
          throw new HogApiError(
            response.status,
            `Unexpected content-type ${contentType} with body: ${text.slice(0, 160)}`,
            endpoint.label
          );
        }

        try {
          return JSON.parse(text) as HogScanResponse;
        } catch (parseError) {
          throw new HogApiError(response.status, `Invalid JSON: ${(parseError as Error).message}`, endpoint.label);
        }
      } catch (error) {
        lastError = error as Error;
        if (error instanceof HogApiError && this.shouldRetry(error)) {
          console.warn(`⚠️ Hog endpoint failed (${error.endpointLabel}). Trying next option...`);
          continue;
        }
        break;
      }
    }

    throw lastError || new Error('Unknown The Hog API failure');
  }

  private buildEndpointMatrix(): HogEndpoint[] {
    const envOverride = {
      baseUrl: this.baseUrl,
      scanPath: '/api/v1/platform/scrapers/web/scrape',
      label: 'env',
    } satisfies HogEndpoint;

    if (process.env.HOG_API_BASE_URL) {
      return [envOverride];
    }

    return [
      { baseUrl: 'https://developer.thehog.ai', scanPath: '/api/v1/platform/scrapers/web/scrape', label: 'developer-scrape' },
      { baseUrl: 'https://core-api.test.thehog.ai', scanPath: '/api/v1/platform/scrapers/web/scrape', label: 'core-api-scrape' }
    ];
  }

  private shouldRetry(error: HogApiError): boolean {
    return [200, 404, 502, 503].includes(error.status);
  }

  async scanWebsite(website: string): Promise<HogScanResponse & { website: string; domain: string }> {
    const normalized = this.normalizeWebsite(website);
    const data = await this.scan(normalized.url, 'company');
    return { ...data, website: normalized.url, domain: normalized.domain };
  }

  async enrichPage(slug: string, name: string, type: string): Promise<void> {
    const r = await this.scan(name, type);
    for (const s of r.signals) {
      query('INSERT OR IGNORE INTO hog_signals (entity_slug,signal_type,source,content,url,timestamp,engagement) VALUES (?,?,?,?,?,?,?)', slug, s.type, s.source, s.content, s.url, s.timestamp, JSON.stringify(s.engagement));
      query('INSERT INTO timeline_entries (page_slug,timestamp,event_type,description,source,source_url,metadata) VALUES (?,?,?,?,?,?,?)', slug, s.timestamp, s.type, s.content, `hog_${s.source}`, s.url, JSON.stringify({engagement:s.engagement}));
    }
  }

  getSignals(slug: string, limit=10): any[] {
    return query('SELECT * FROM hog_signals WHERE entity_slug=? ORDER BY timestamp DESC LIMIT ?', slug, limit)
      .map((r:any) => ({...r, engagement: typeof r.engagement==='string' ? JSON.parse(r.engagement) : r.engagement}));
  }

  async dreamCycleEnrichment(): Promise<{processed:number;signals:number}> {
    query('INSERT INTO dream_cycle_runs (phase,status) VALUES (?,?)', 'hog_enrichment','running');
    const pages = query('SELECT slug,title,type FROM pages WHERE type IN (?,?)', 'person','company');
    let added=0;
    for (const p of pages) {
      try {
        const before = query('SELECT COUNT(*) as c FROM hog_signals WHERE entity_slug=?', p.slug)[0].c;
        await this.enrichPage(p.slug, p.title, p.type);
        added += query('SELECT COUNT(*) as c FROM hog_signals WHERE entity_slug=?', p.slug)[0].c - before;
      } catch(e) {}
    }
    query('UPDATE dream_cycle_runs SET status=?,completed_at=datetime(\'now\'),pages_processed=?,signals_added=? WHERE id=(SELECT MAX(id) FROM dream_cycle_runs)', 'completed', pages.length, added);
    return {processed:pages.length, signals:added};
  }
}

export const hogConnector = new HogConnector();
