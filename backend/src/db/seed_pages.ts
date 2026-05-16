import { getDb } from './client';

const db = getDb() as any;

type PageSeed = {
  slug: string;
  type: 'company' | 'founder';
  title: string;
  content: string;
  tags: string[];
};

type TimelineSeed = {
  pageSlug: string;
  entries: {
    timestamp: string;
    event_type: string;
    description: string;
    source: string;
    source_url?: string;
    metadata?: Record<string, any>;
  }[];
};

type SignalSeed = {
  entity_slug: string;
  signal_type: 'mention' | 'hiring' | 'funding' | 'product' | 'press';
  source: string;
  content: string;
  url?: string;
  timestamp: string;
  engagement?: Record<string, any>;
};

const defaultUserId = 'user-1';

const pages: PageSeed[] = [
  {
    slug: 'company:dailystory-arxiv',
    type: 'company',
    title: 'DailyStory Arxiv Database',
    tags: ['ai', 'research', 'knowledge'],
    content:
      'DailyStory builds a real-time Arxiv intelligence layer that summarizes every paper for consumer founders. Highlights include automatic storyboards, signal extraction for investors, and a managed feed for deal teams.',
  },
  {
    slug: 'founder:maya-lin',
    type: 'founder',
    title: 'Maya Lin',
    tags: ['founder', 'nlp'],
    content:
      'Maya is the CEO and co-founder of DailyStory. She previously led applied research at Anthropic and shipped the first Claude summarization agent for publisher workflows. She focuses on aligning research tooling with consumer UX.',
  },
  {
    slug: 'company:obsidian-biosensors',
    type: 'company',
    title: 'Obsidian BioSensors',
    tags: ['biotech', 'hardware', 'climate'],
    content:
      'Obsidian manufactures solid-state biosensors for wildfire detection. The team deploys mesh networks across utilities and streams data into a predictive model tuned on NASA fire datasets.',
  },
  {
    slug: 'founder:rafael-costa',
    type: 'founder',
    title: 'Rafael Costa',
    tags: ['hardware', 'founder'],
    content:
      'Rafael previously built sensing rigs at Planet Labs before founding Obsidian. He oversees the hybrid ML + hardware stack that powers the company’s early-warning system.',
  },
  {
    slug: 'company:helix-vault',
    type: 'company',
    title: 'Helix Vault',
    tags: ['security', 'ai', 'infrastructure'],
    content:
      'Helix Vault offers a secure memory store for agentic workflows, combining policy-aware encryption with SOC2-ready logging. Their first customers are AI teams at fintech startups migrating from ad-hoc prompt stores.',
  },
];

const timeline: TimelineSeed[] = [
  {
    pageSlug: 'company:dailystory-arxiv',
    entries: [
      {
        timestamp: '2026-05-10T15:00:00Z',
        event_type: 'funding',
        description: 'Closed $4.2M seed round led by Wave Capital.',
        source: 'hog_news',
        source_url: 'https://news.example.com/dailystory-seed',
      },
      {
        timestamp: '2026-05-12T09:30:00Z',
        event_type: 'product',
        description: 'Launched live “Arxiv Daily Digest” for consumer investors.',
        source: 'hog_twitter',
      },
    ],
  },
  {
    pageSlug: 'company:obsidian-biosensors',
    entries: [
      {
        timestamp: '2026-05-08T18:45:00Z',
        event_type: 'mentions',
        description: 'Highlighted in DOE wildfire prevention pilot report.',
        source: 'hog_press',
      },
    ],
  },
];

const signals: SignalSeed[] = [
  {
    entity_slug: 'company:dailystory-arxiv',
    signal_type: 'hiring',
    source: 'linkedin',
    content: 'DailyStory is hiring an Applied Scientist to compress Arxiv papers into consumer stories.',
    timestamp: '2026-05-14T12:00:00Z',
    url: 'https://linkedin.com/jobs/dailystory-applied-scientist',
  },
  {
    entity_slug: 'company:obsidian-biosensors',
    signal_type: 'product',
    source: 'twitter',
    content: 'Obsidian shipped a wildfire telemetry mesh kit for utilities—deployable in <48h.',
    timestamp: '2026-05-11T17:15:00Z',
  },
  {
    entity_slug: 'company:helix-vault',
    signal_type: 'press',
    source: 'news',
    content: 'Helix Vault named to the Top 10 AI security startups to watch.',
    timestamp: '2026-05-09T08:00:00Z',
  },
];

const links = [
  { from: 'founder:maya-lin', to: 'company:dailystory-arxiv', type: 'founded' },
  { from: 'founder:rafael-costa', to: 'company:obsidian-biosensors', type: 'founded' },
  { from: 'company:helix-vault', to: 'company:dailystory-arxiv', type: 'invested_in' },
];

function insertPages() {
  for (const page of pages) {
    db.run(
      `INSERT OR REPLACE INTO pages (slug, type, title, content, tags, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      page.slug,
      page.type,
      page.title,
      page.content.trim(),
      JSON.stringify(page.tags),
      defaultUserId,
      defaultUserId,
    );

    db.run(
      `INSERT INTO page_contributions (page_slug, user_id, contribution_type, content_snapshot, content_hash, source)
       VALUES (?, ?, 'created', ?, ?, 'system')`,
      page.slug,
      defaultUserId,
      page.content.slice(0, 400),
      `${page.slug}-v1`,
    );
  }
}

function insertTimeline() {
  for (const block of timeline) {
    for (const entry of block.entries) {
      db.run(
        `INSERT INTO timeline_entries (page_slug, timestamp, event_type, description, source, source_url, metadata, added_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        block.pageSlug,
        entry.timestamp,
        entry.event_type,
        entry.description,
        entry.source,
        entry.source_url || null,
        JSON.stringify(entry.metadata || {}),
        defaultUserId,
      );
    }
  }
}

function insertSignals() {
  for (const signal of signals) {
    db.run(
      `INSERT INTO hog_signals (entity_slug, signal_type, source, content, url, timestamp, engagement)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      signal.entity_slug,
      signal.signal_type,
      signal.source,
      signal.content,
      signal.url || null,
      signal.timestamp,
      JSON.stringify(signal.engagement || {}),
    );
  }
}

function insertLinks() {
  for (const link of links) {
    db.run(
      `INSERT OR IGNORE INTO entity_links (from_slug, to_slug, link_type, created_by)
       VALUES (?, ?, ?, ?)`,
      link.from,
      link.to,
      link.type,
      defaultUserId,
    );
  }
}

function main() {
  console.log('🌱 Seeding graph entities...');
  db.run('BEGIN');
  try {
    insertPages();
    insertTimeline();
    insertSignals();
    insertLinks();
    db.run('COMMIT');
    console.log(`✅ Inserted ${pages.length} pages, ${signals.length} signals, and ${links.length} links.`);
  } catch (error) {
    db.run('ROLLBACK');
    console.error('✗ Seed failed:', error);
    process.exit(1);
  }
}

main();
