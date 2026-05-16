import express from 'express';
import cors from 'cors';
import authRoutes from './api/auth';
import pagesRoutes from './api/pages';
import hogRoutes from './api/hog';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/pages', pagesRoutes);
app.use('/api/hog', hogRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'vaultbrain-backend' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 VaultBrain backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
