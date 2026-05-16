export interface User {
  id: string;
  email: string;
  name: string;
  role: 'partner' | 'analyst';
  created_at: Date;
  last_login?: Date;
}

export interface Page {
  slug: string;
  type: string;
  title: string;
  content: string;
  tags: string[];
  embedding?: number[];
  created_at: Date;
  updated_at: Date;
  created_by?: string;
  updated_by?: string;
}

export interface PageContribution {
  id: string;
  page_slug: string;
  user_id: string;
  contribution_type: 'created' | 'updated' | 'enriched' | 'merged';
  content_snapshot: string;
  content_hash: string;
  timestamp: Date;
  source: 'manual' | 'hog_auto' | 'meeting_notes' | 'system';
  metadata: Record<string, any>;
}

export interface TimelineEntry {
  id: string;
  page_slug: string;
  timestamp: Date;
  event_type: string;
  description: string;
  source: string;
  source_url?: string;
  metadata: Record<string, any>;
  added_by?: string;
  added_at: Date;
}

export interface HogSignal {
  id: string;
  entity_slug: string;
  signal_type: 'mention' | 'hiring' | 'funding' | 'product' | 'press';
  source: string;
  content: string;
  url?: string;
  timestamp: Date;
  engagement: {
    likes?: number;
    comments?: number;
    shares?: number;
  };
  fetched_at: Date;
  relevance_score?: number;
}

export interface EntityLink {
  id: string;
  from_slug: string;
  to_slug: string;
  link_type: 'works_at' | 'founded' | 'invested_in' | 'advises' | 'attended' | 'knows';
  created_at: Date;
  created_by?: string;
  metadata: Record<string, any>;
}

export interface OperationContext {
  user: User;
  remote?: boolean;
}
