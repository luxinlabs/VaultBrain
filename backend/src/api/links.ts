import { Router } from 'express';
import { query } from '../db/client';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

router.post('/', async (req, res) => {
  try {
    const { from_slug, to_slug, link_type } = req.body;
    
    if (!from_slug || !to_slug || !link_type) {
      return res.status(400).json({ error: 'from_slug, to_slug, and link_type are required' });
    }

    query(
      `INSERT OR IGNORE INTO entity_links (from_slug, to_slug, link_type, created_by)
       VALUES (?, ?, ?, ?)`,
      from_slug,
      to_slug,
      link_type,
      req.user!.id,
    );

    res.json({ message: 'Link created' });
  } catch (error: any) {
    console.error('Link creation error:', error);
    res.status(500).json({ error: error.message || 'Failed to create link' });
  }
});

export default router;
