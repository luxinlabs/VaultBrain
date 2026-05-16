-- DealFlow AI Database Schema
-- Extends GBrain with multi-user, permissions, and provenance tracking

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- User management
CREATE TABLE IF NOT EXISTS dealflow_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('partner', 'analyst')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- GBrain pages (core table from gbrain, extended)
CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES dealflow_users(id),
  updated_by UUID REFERENCES dealflow_users(id)
);

-- Source tracking (who wrote what)
CREATE TABLE IF NOT EXISTS page_contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  user_id UUID REFERENCES dealflow_users(id),
  contribution_type TEXT NOT NULL CHECK (contribution_type IN ('created', 'updated', 'enriched', 'merged')),
  content_snapshot TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN ('manual', 'hog_auto', 'meeting_notes', 'system')),
  metadata JSONB DEFAULT '{}'
);

-- Access control
CREATE TABLE IF NOT EXISTS page_permissions (
  page_slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('partner', 'analyst')),
  can_read BOOLEAN DEFAULT true,
  can_write BOOLEAN DEFAULT false,
  PRIMARY KEY (page_slug, role)
);

-- Entity merge tracking
CREATE TABLE IF NOT EXISTS entity_merges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  merged_from UUID[] NOT NULL, -- Array of contributor user_ids
  merge_strategy TEXT NOT NULL CHECK (merge_strategy IN ('latest', 'consensus', 'partner_wins', 'timeline_append')),
  merged_at TIMESTAMPTZ DEFAULT NOW(),
  merged_content JSONB NOT NULL,
  conflict_resolution TEXT
);

-- Timeline entries (structured timeline data)
CREATE TABLE IF NOT EXISTS timeline_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  metadata JSONB DEFAULT '{}',
  added_by UUID REFERENCES dealflow_users(id),
  added_at TIMESTAMPTZ DEFAULT NOW()
);

-- The Hog signals cache
CREATE TABLE IF NOT EXISTS hog_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('mention', 'hiring', 'funding', 'product', 'press')),
  source TEXT NOT NULL,
  content TEXT NOT NULL,
  url TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  engagement JSONB DEFAULT '{}',
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  relevance_score FLOAT
);

-- Entity relationships (knowledge graph)
CREATE TABLE IF NOT EXISTS entity_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  to_slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('works_at', 'founded', 'invested_in', 'advises', 'attended', 'knows')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES dealflow_users(id),
  metadata JSONB DEFAULT '{}',
  UNIQUE(from_slug, to_slug, link_type)
);

-- Analyst assignments (which analysts can see which deals)
CREATE TABLE IF NOT EXISTS analyst_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analyst_id UUID NOT NULL REFERENCES dealflow_users(id),
  page_slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES dealflow_users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(analyst_id, page_slug)
);

-- Dream cycle runs (track enrichment jobs)
CREATE TABLE IF NOT EXISTS dream_cycle_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phase TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  pages_processed INT DEFAULT 0,
  signals_added INT DEFAULT 0,
  errors JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pages_tags ON pages USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(type);
CREATE INDEX IF NOT EXISTS idx_pages_created_by ON pages(created_by);
CREATE INDEX IF NOT EXISTS idx_pages_embedding ON pages USING ivfflat(embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_contributions_page ON page_contributions(page_slug);
CREATE INDEX IF NOT EXISTS idx_contributions_user ON page_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_contributions_timestamp ON page_contributions(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_timeline_page ON timeline_entries(page_slug);
CREATE INDEX IF NOT EXISTS idx_timeline_timestamp ON timeline_entries(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_hog_signals_entity ON hog_signals(entity_slug);
CREATE INDEX IF NOT EXISTS idx_hog_signals_timestamp ON hog_signals(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hog_signals_type ON hog_signals(signal_type);

CREATE INDEX IF NOT EXISTS idx_links_from ON entity_links(from_slug);
CREATE INDEX IF NOT EXISTS idx_links_to ON entity_links(to_slug);
CREATE INDEX IF NOT EXISTS idx_links_type ON entity_links(link_type);

CREATE INDEX IF NOT EXISTS idx_assignments_analyst ON analyst_assignments(analyst_id);
CREATE INDEX IF NOT EXISTS idx_assignments_page ON analyst_assignments(page_slug);

-- Functions for permissions checking
CREATE OR REPLACE FUNCTION can_read_page(p_slug TEXT, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT;
  v_can_read BOOLEAN;
  v_is_assigned BOOLEAN;
BEGIN
  -- Get user role
  SELECT role INTO v_role FROM dealflow_users WHERE id = p_user_id;
  
  -- Partners can read everything
  IF v_role = 'partner' THEN
    RETURN TRUE;
  END IF;
  
  -- Check page permissions
  SELECT can_read INTO v_can_read 
  FROM page_permissions 
  WHERE page_slug = p_slug AND role = v_role;
  
  -- If explicitly allowed, return true
  IF v_can_read THEN
    RETURN TRUE;
  END IF;
  
  -- Check if analyst is assigned to this page
  SELECT EXISTS(
    SELECT 1 FROM analyst_assignments 
    WHERE analyst_id = p_user_id AND page_slug = p_slug
  ) INTO v_is_assigned;
  
  RETURN v_is_assigned;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION can_write_page(p_slug TEXT, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT;
  v_can_write BOOLEAN;
  v_is_assigned BOOLEAN;
BEGIN
  -- Get user role
  SELECT role INTO v_role FROM dealflow_users WHERE id = p_user_id;
  
  -- Partners can write everything
  IF v_role = 'partner' THEN
    RETURN TRUE;
  END IF;
  
  -- Check page permissions
  SELECT can_write INTO v_can_write 
  FROM page_permissions 
  WHERE page_slug = p_slug AND role = v_role;
  
  -- If explicitly allowed, return true
  IF v_can_write THEN
    RETURN TRUE;
  END IF;
  
  -- Check if analyst is assigned to this page
  SELECT EXISTS(
    SELECT 1 FROM analyst_assignments 
    WHERE analyst_id = p_user_id AND page_slug = p_slug
  ) INTO v_is_assigned;
  
  RETURN v_is_assigned;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_pages_updated_at
BEFORE UPDATE ON pages
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Default permissions (partners can do everything, analysts need assignment)
CREATE OR REPLACE FUNCTION set_default_permissions()
RETURNS TRIGGER AS $$
BEGIN
  -- Partners can read and write
  INSERT INTO page_permissions (page_slug, role, can_read, can_write)
  VALUES (NEW.slug, 'partner', TRUE, TRUE)
  ON CONFLICT (page_slug, role) DO NOTHING;
  
  -- Analysts can read public pages by default (write requires assignment)
  INSERT INTO page_permissions (page_slug, role, can_read, can_write)
  VALUES (NEW.slug, 'analyst', TRUE, FALSE)
  ON CONFLICT (page_slug, role) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_page_permissions
AFTER INSERT ON pages
FOR EACH ROW
EXECUTE FUNCTION set_default_permissions();
