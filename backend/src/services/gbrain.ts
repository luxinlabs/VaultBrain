import { query, queryOne } from '../db/client';
import { User } from '../types';
import { permissionsService } from './permissions';

export class GBrainService {
  getPage(slug: string, user: User): any | null {
    permissionsService.checkReadPermission(slug, user);
    return queryOne('SELECT * FROM pages WHERE slug = ?', slug);
  }

  deletePage(slug: string, user: User): void {
    permissionsService.checkWritePermission(slug, user);
    query('DELETE FROM entity_links WHERE from_slug=? OR to_slug=?', slug, slug);
    query('DELETE FROM hog_signals WHERE entity_slug=?', slug);
    query('DELETE FROM timeline_entries WHERE page_slug=?', slug);
    query('DELETE FROM page_contributions WHERE page_slug=?', slug);
    query('DELETE FROM analyst_assignments WHERE page_slug=?', slug);
    query('DELETE FROM pages WHERE slug=?', slug);
  }

  putPage(slug: string, content: string, user: User): any {
    const existing = queryOne('SELECT * FROM pages WHERE slug = ?', slug);
    if (existing) {
      permissionsService.checkWritePermission(slug, user);
      query('UPDATE pages SET content=?, updated_by=?, updated_at=datetime(\'now\') WHERE slug=?', content, user.id, slug);
      this.trackContribution(slug, user.id, 'updated', content, 'manual');
    } else {
      const m = this.extractMetadata(content);
      query('INSERT INTO pages (slug,type,title,content,tags,created_by,updated_by) VALUES (?,?,?,?,?,?,?)',
        slug, m.type||'note', m.title||slug, content, JSON.stringify(m.tags||[]), user.id, user.id);
      this.trackContribution(slug, user.id, 'created', content, 'manual');
    }
    return queryOne('SELECT * FROM pages WHERE slug = ?', slug);
  }

  search(q: string, user: User, opts: { filters?: { tags?: string[]; type?: string }; limit?: number } = {}): any[] {
    const limit = opts.limit || 10;
    let sql = 'SELECT * FROM pages WHERE content LIKE ?';
    const params: any[] = [`%${q}%`];
    if (opts.filters?.type) { sql += ' AND type=?'; params.push(opts.filters.type); }
    sql += ' ORDER BY updated_at DESC LIMIT ?'; params.push(limit);
    return query(sql, ...params).filter((p: any) => {
      try { permissionsService.checkReadPermission(p.slug, user); return true; } catch { return false; }
    });
  }

  getTimeline(slug: string, user: User): any[] {
    permissionsService.checkReadPermission(slug, user);
    return query('SELECT * FROM timeline_entries WHERE page_slug=? ORDER BY timestamp DESC', slug);
  }

  addTimelineEntry(slug: string, entry: any, user: User): any {
    permissionsService.checkWritePermission(slug, user);
    query('INSERT INTO timeline_entries (page_slug,timestamp,event_type,description,source,source_url,metadata,added_by) VALUES (?,?,?,?,?,?,?,?)',
      slug, entry.timestamp, entry.event_type, entry.description, entry.source, entry.source_url||null, JSON.stringify(entry.metadata||{}), user.id);
    return queryOne('SELECT * FROM timeline_entries WHERE id=last_insert_rowid()');
  }

  listPages(user: User, limit = 250): any[] {
    if (user.role === 'partner') {
      return query('SELECT * FROM pages ORDER BY updated_at DESC LIMIT ?', limit);
    }

    return query(
      `SELECT p.* FROM pages p
       JOIN analyst_assignments a ON a.page_slug = p.slug
       WHERE a.analyst_id = ?
       ORDER BY p.updated_at DESC
       LIMIT ?`,
      user.id,
      limit,
    );
  }

  getGraph(user: User): { nodes: any[]; links: any[] } {
    const nodes = this.listPages(user);
    const allowed = new Set(nodes.map((p: any) => p.slug));
    const rawLinks = query('SELECT * FROM entity_links ORDER BY created_at DESC LIMIT 500');
    const links = rawLinks.filter((link: any) => allowed.has(link.from_slug) && allowed.has(link.to_slug));
    return { nodes, links };
  }

  getContributors(slug: string, user: User): any[] {
    permissionsService.checkReadPermission(slug, user);
    return query('SELECT u.id,u.name,u.email,u.role,pc.contribution_type,pc.timestamp,pc.source FROM page_contributions pc JOIN dealflow_users u ON pc.user_id=u.id WHERE pc.page_slug=? ORDER BY pc.timestamp DESC', slug);
  }

  private trackContribution(slug: string, userId: string, type: string, content: string, source: string): void {
    query('INSERT INTO page_contributions (page_slug,user_id,contribution_type,content_snapshot,content_hash,source) VALUES (?,?,?,?,?,?)',
      slug, userId, type, content.substring(0,500), '', source);
  }

  private extractMetadata(content: string): { type?: string; title?: string; tags?: string[] } {
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return {};
    const m: any = {};
    for (const l of fm[1].split('\n')) {
      const tm = l.match(/^type:\s*(.+)$/); if (tm) m.type = tm[1].trim();
      const ttm = l.match(/^title:\s*(.+)$/); if (ttm) m.title = ttm[1].trim();
      const tgm = l.match(/^tags:\s*\[(.+)\]$/); if (tgm) m.tags = tgm[1].split(',').map((t: string) => t.trim());
    }
    return m;
  }
}

export const gbrainService = new GBrainService();
