// backend/src/server.ts
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { pool } from './db/postgres';
import authRoutes from './routes/auth';
import emailRoutes from './routes/emails';
import aiRoutes from './routes/ai';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import { SchedulerService } from './services/schedulerService';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl)
    if (!origin) return callback(null, true);
    
    const allowedPatterns = [
      /localhost:\d+$/,
      /\.vercel\.app$/,
      /\.render\.com$/
    ];
    
    const isAllowed = allowedPatterns.some(regex => regex.test(origin));
    
    // Also allow exact match of process.env.FRONTEND_URL
    const exactFrontend = process.env.FRONTEND_URL;
    if (isAllowed || (exactFrontend && origin === exactFrontend) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check routes (no auth required)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/db-health', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', database: 'connected', time: result.rows[0] });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: (error as Error).message,
    });
  }
});

// Public routes
app.use('/auth', authRoutes);

// Protected routes (require JWT)
app.use('/api/emails', authMiddleware, emailRoutes);
app.use('/api/ai', authMiddleware, aiRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// Global error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}`);
  console.log(`📧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`🤖 Gemini API: ${process.env.GEMINI_API_KEY ? 'configured' : '⚠️ NOT SET'}`);
  console.log(`🔑 Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? 'configured' : '⚠️ NOT SET'}`);
  console.log(`🗄️  Database: ${process.env.DATABASE_URL ? 'configured' : '⚠️ NOT SET'}\n`);
  
  // Start background email scheduler poller
  SchedulerService.startPoller();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  SchedulerService.stopPoller();
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT received, shutting down...');
  SchedulerService.stopPoller();
  await pool.end();
  process.exit(0);
});
