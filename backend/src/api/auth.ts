import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../db/client';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hackathon-secret-change-me';

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = queryOne('SELECT * FROM dealflow_users WHERE email = ?', email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    query('UPDATE dealflow_users SET last_login = datetime(\'now\') WHERE id = ?', user.id);
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    const d = jwt.verify(token, JWT_SECRET) as any;
    const user = queryOne('SELECT id,email,name,role,created_at,last_login FROM dealflow_users WHERE id=?', d.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
});

export default router;
