import { Router } from 'express';
import { hogConnector } from '../services/hog-connector';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/scan', authMiddleware, async (req, res) => {
  try {
    const { website } = req.body;
    if (!website) {
      return res.status(400).json({ error: 'website is required' });
    }
    const result = await hogConnector.scanWebsite(website);
    res.json(result);
  } catch (error: any) {
    console.error('Hog scan error:', error);
    res.status(502).json({ error: error.message || 'The Hog scan failed' });
  }
});

router.post('/enrich-person', authMiddleware, async (req, res) => {
  try {
    const { linkedin_url } = req.body;
    if (!linkedin_url) {
      return res.status(400).json({ error: 'linkedin_url is required' });
    }
    const result = await hogConnector.enrichPerson(linkedin_url);
    res.json(result);
  } catch (error: any) {
    console.error('Person enrichment error:', error);
    res.status(502).json({ error: error.message || 'Person enrichment failed' });
  }
});

router.post('/enrich-company', authMiddleware, async (req, res) => {
  try {
    const { website } = req.body;
    if (!website) {
      return res.status(400).json({ error: 'website is required' });
    }
    const result = await hogConnector.scanWebsite(website);
    res.json(result);
  } catch (error: any) {
    console.error('Company enrichment error:', error);
    res.status(502).json({ error: error.message || 'Company enrichment failed' });
  }
});

export default router;
