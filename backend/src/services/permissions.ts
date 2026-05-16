import { query, queryOne } from '../db/client';
import { User } from '../types';

export class PermissionsService {
  async canRead(pageSlug: string, user: User): Promise<boolean> {
    if (user.role === 'partner') return true;
    const r = queryOne('SELECT 1 FROM analyst_assignments WHERE analyst_id = ? AND page_slug = ?', user.id, pageSlug);
    return !!r;
  }

  async canWrite(pageSlug: string, user: User): Promise<boolean> {
    if (user.role === 'partner') return true;
    const r = queryOne('SELECT 1 FROM analyst_assignments WHERE analyst_id = ? AND page_slug = ?', user.id, pageSlug);
    return !!r;
  }

  async checkReadPermission(pageSlug: string, user: User): Promise<void> {
    if (!(await this.canRead(pageSlug, user))) {
      throw new Error(`Permission denied: ${user.email} cannot read ${pageSlug}`);
    }
  }

  async checkWritePermission(pageSlug: string, user: User): Promise<void> {
    if (!(await this.canWrite(pageSlug, user))) {
      throw new Error(`Permission denied: ${user.email} cannot write ${pageSlug}`);
    }
  }

  async assignAnalyst(pageSlug: string, analystId: string, assignedBy: User): Promise<void> {
    if (assignedBy.role !== 'partner') throw new Error('Only partners can assign analysts');
    query('INSERT OR IGNORE INTO analyst_assignments (analyst_id, page_slug, assigned_by) VALUES (?, ?, ?)', analystId, pageSlug, assignedBy.id);
  }

  async getAssignedPages(userId: string): Promise<string[]> {
    return query('SELECT page_slug FROM analyst_assignments WHERE analyst_id = ?', userId).map((r: any) => r.page_slug);
  }
}

export const permissionsService = new PermissionsService();
