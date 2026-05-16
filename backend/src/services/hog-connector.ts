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

type InvestmentInsights = {
  marketSize: string;
  traction: string;
  teamQuality: string;
  productMarketFit: string;
  competitiveMoat: string;
  fundingStatus: string;
};

type HogSearchOptions = {
  limit?: number;
  includeSignals?: boolean;
  includeContacts?: boolean;
  filters?: Record<string, any>;
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
    // Decode URL-encoded characters (e.g., %20 -> space)
    const decoded = decodeURIComponent(trimmed);
    // Replace spaces with nothing (common user error: "garry tan" -> "garrytan")
    const withoutSpaces = decoded.replace(/\s+/g, '');
    const withProtocol = /^https?:\/\//i.test(withoutSpaces) ? withoutSpaces : `https://${withoutSpaces}`;

    try {
      const parsed = new URL(withProtocol);
      return { url: parsed.origin, domain: parsed.hostname };
    } catch (e) {
      throw new Error(`Invalid URL: "${raw}". Please enter a valid website URL.`);
    }
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

  async scanWebsite(website: string): Promise<
    HogScanResponse & {
      website: string;
      domain: string;
      description?: string;
      name?: string;
      sector?: string;
      investmentInsights?: InvestmentInsights;
    }
  > {
    const normalized = this.normalizeWebsite(website);
    const companyName = normalized.domain
      .replace(/^www\./, '')
      .split('.')[0]
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const queryString = `${companyName} company ${normalized.domain}`.trim();

    const [searchResult, scrapeResult] = await Promise.allSettled([
      this.searchCompanies(queryString, { includeSignals: true, limit: 1 }),
      this.scan(normalized.url, 'company'),
    ]);

    let signals: any[] = [];
    let description: string | undefined;
    let name: string | undefined;
    let sector: string | undefined;

    if (searchResult.status === 'fulfilled') {
      const results = coerceArray(searchResult.value);
      const match = results[0];
      if (match) {
        name = match.name || match.company_name || match.title;
        description = match.description || match.summary || match.about;
        sector = match.industry || match.sector || match.category;
        const rawSignals: any[] = coerceArray(match.signals);
        signals = rawSignals.map((s: any) => normalizeHogSignal(s, normalized.domain));
      }
    }

    if (scrapeResult.status === 'fulfilled') {
      const scrapeSignals: any[] = coerceArray(scrapeResult.value?.signals);
      const mapped = scrapeSignals.map((s: any) => normalizeHogSignal(s, normalized.domain));
      signals = dedupSignals([...signals, ...mapped]);
    }

    const investmentInsights = deriveInvestmentInsightsFromSignals(signals, sector);

    return {
      signals,
      description,
      name,
      sector,
      investmentInsights,
      website: normalized.url,
      domain: normalized.domain,
    };
  }

  private async postSearch(path: string, payload: Record<string, any>) {
    const { accessKey, secretKey } = this.ensureApiKeys();
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Access-Key': accessKey,
        'X-Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new HogApiError(response.status, text || response.statusText, path);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new HogApiError(response.status, `Invalid JSON: ${(error as Error).message}`, path);
    }
  }

  async searchCompanies(query: string, options: HogSearchOptions = {}) {
    if (!query?.trim()) {
      throw new Error('query is required');
    }
    return this.postSearch('/api/v1/companies/search', {
      query,
      limit: options.limit ?? 25,
      includeSignals: options.includeSignals ?? true,
      filters: options.filters,
    });
  }

  async searchPeople(query: string, options: HogSearchOptions = {}) {
    if (!query?.trim()) {
      throw new Error('query is required');
    }
    return this.postSearch('/api/v1/people/search', {
      query,
      limit: options.limit ?? 25,
      includeContacts: options.includeContacts ?? true,
      includeSignals: options.includeSignals ?? true,
    });
  }

  async enrichPerson(linkedinUrl: string): Promise<any> {
    const { accessKey, secretKey } = this.ensureApiKeys();
    
    for (const endpoint of this.endpoints) {
      const url = `${endpoint.baseUrl}/api/enrichments`;
      const payload = {
        identifier: { linkedin_url: linkedinUrl },
        fields: ['contact.email', 'contact.phone', 'person.name', 'person.bio', 'person.current_company', 'person.skills', 'signals']
      };

      console.log('🐗 Hog person enrichment:', { url, linkedinUrl, endpoint: endpoint.label });

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
          console.warn(`⚠️ Hog enrichment failed (${endpoint.label}): ${text}`);
          continue;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!/json/i.test(contentType)) {
          console.warn(`⚠️ Non-JSON response from ${endpoint.label}`);
          continue;
        }

        const data = JSON.parse(text);
        return {
          name: data.person?.name || null,
          bio: data.person?.bio || null,
          current_company: data.person?.current_company || null,
          skills: data.person?.skills || [],
          email: data.contact?.email || null,
          phone: data.contact?.phone || null,
          signals: data.signals || []
        };
      } catch (error) {
        console.warn(`⚠️ Hog enrichment error (${endpoint.label}):`, error);
        continue;
      }
    }

    throw new Error('All Hog enrichment endpoints failed');
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

function coerceArray(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.results)) return value.results;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.matches)) return value.matches;
  return [];
}

function normalizeHogSignal(s: any, domain: string): Record<string, any> {
  if (!s) return {};
  return {
    type: s.type || s.signal_type || s.category || 'mention',
    source: s.source || s.platform || domain,
    content: s.content || s.text || s.title || s.description || '',
    url: s.url || s.link || null,
    timestamp: s.timestamp || s.date || s.published_at || new Date().toISOString(),
    engagement: s.engagement || s.metrics || {},
  };
}

function dedupSignals(signals: any[]): any[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    const key = `${s.type}:${s.url || ''}:${(s.content || '').slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveInvestmentInsightsFromSignals(signals: any[], sector?: string): InvestmentInsights {
  const text = signals.map((s) => s.content || '').join(' ').toLowerCase();
  const marketMatch = text.match(/(billion|million|tam|market|industry)/);
  const tractionSignals = signals.filter((s) =>
    ['mentions', 'press', 'product', 'funding', 'hiring'].includes(s.type)
  );
  const hiringMention = text.match(/hiring|headcount|recruiting|open role/);
  const pmfMention = text.match(/launched|pilot|customers|deployment|rolled out/);
  const moatMention = text.match(/only|exclusive|proprietary|leading|patent/);
  const fundingMention = signals.find((s) => s.type === 'funding');

  return {
    marketSize: marketMatch ? 'Market dynamics referenced' : sector ? `Operating in ${sector}` : 'Market intel pending',
    traction: tractionSignals.length ? `${tractionSignals.length} signals (press, product, hiring)` : 'Awaiting traction signals',
    teamQuality: hiringMention ? 'Hiring momentum detected' : 'Team signals pending',
    productMarketFit: pmfMention ? 'Launch/pilot references detected' : 'Validating product fit',
    competitiveMoat: moatMention ? moatMention[0] : sector || 'Moat narrative TBD',
    fundingStatus: fundingMention ? fundingMention.content || 'Funding activity reported' : 'No funding signals yet',
  };
}
