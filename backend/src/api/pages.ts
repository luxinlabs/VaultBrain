import { Router } from 'express';
import { gbrainService } from '../services/gbrain';
import { hogConnector } from '../services/hog-connector';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

router.get('/:slug', (req, res) => {
  try {
    const page = gbrainService.getPage(req.params.slug, req.user);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    res.json({ page, timeline: gbrainService.getTimeline(req.params.slug, req.user), signals: hogConnector.getSignals(req.params.slug), contributors: gbrainService.getContributors(req.params.slug, req.user) });
  } catch (e: any) { res.status(e.message.includes('Permission') ? 403 : 500).json({ error: e.message }); }
});

router.put('/:slug', (req, res) => {
  try {
    if (!req.body.content) return res.status(400).json({ error: 'Content required' });
    res.json({ page: gbrainService.putPage(req.params.slug, req.body.content, req.user) });
  } catch (e: any) { res.status(e.message.includes('Permission') ? 403 : 500).json({ error: e.message }); }
});

router.post('/query', (req, res) => {
  try {
    if (!req.body.query) return res.status(400).json({ error: 'Query required' });
    res.json({ results: gbrainService.search(req.body.query, req.user, { filters: req.body.filters, limit: req.body.limit }) });
  } catch (e) { res.status(500).json({ error: 'Internal error' }); }
});

router.post('/:slug/timeline', (req, res) => {
  try {
    res.json({ entry: gbrainService.addTimelineEntry(req.params.slug, req.body, req.user) });
  } catch (e: any) { res.status(e.message.includes('Permission') ? 403 : 500).json({ error: e.message }); }
});

router.post('/:slug/enrich', async (req, res) => {
  try {
    const page = gbrainService.getPage(req.params.slug, req.user);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    await hogConnector.enrichPage(req.params.slug, page.title, page.type === 'company' ? 'company' : 'person');
    res.json({ message: 'Enriched' });
  } catch (e: any) { res.status(e.message.includes('Permission') ? 403 : 500).json({ error: e.message }); }
});

export default router;
