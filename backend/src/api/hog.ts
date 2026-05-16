import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { hogConnector } from '../services/hog-connector';

const router = Router();
router.use(authMiddleware);

router.post('/scan', async (req, res) => {
  const { website } = req.body ?? {};
  if (!website || typeof website !== 'string') {
    return res.status(400).json({ error: 'website is required' });
  }

  try {
    const result = await hogConnector.scanWebsite(website);
    res.json(result);
  } catch (e: any) {
    res.status(502).json({ error: e.message || 'Failed to scan website with The Hog' });
  }
});

export default router;
