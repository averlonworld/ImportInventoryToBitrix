import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { apiLimiter } from './middleware/rateLimit.middleware';
import { errorHandler } from './middleware/error.middleware';
import authRoutes from './routes/auth.routes';
import dashboardRoutes from './routes/dashboard.routes';
import bitrixRoutes from './routes/bitrix.routes';
import importRoutes from './routes/import.routes';
import settingsRoutes from './routes/settings.routes';
import { env } from './config/env';
import { prisma } from './config/database';
import { redisConnection } from './config/redis';
import { ensureUploadDir } from './utils/file.utils';
import { debugLog } from './services/debug/debugLog.service';
import debugRoutes from './routes/debug.routes';

const app = express();

// Trust the single reverse proxy (nginx) so rate limiting can read the real client IP
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://frontend:3000',
  'http://localhost',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for simplicity in this app
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Debug logging middleware — records every API request into the DB (for the Debug Console)
app.use((req, res, next) => {
  const start = Date.now();
  const url = req.originalUrl || req.url;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const userId = (req as any).user?.id;

    if (url.startsWith('/api')) {
      const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'DEBUG';
      debugLog.write(level, 'API', `${req.method} ${url.split('?')[0]} -> ${res.statusCode}`, {
        status: res.statusCode,
        method: req.method,
        path: url.split('?')[0],
        duration,
        userId,
      });
    }
  });
  next();
});

// Rate limiting
app.use('/api', apiLimiter);

// Ensure upload directory exists
ensureUploadDir().catch(err => console.error('Failed to create upload dir:', err));


// Health check
app.get('/health', async (_req, res) => {
  const checks: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'connected';
  } catch {
    checks.database = 'disconnected';
  }

  try {
    await redisConnection.ping();
    checks.redis = 'connected';
  } catch {
    checks.redis = 'disconnected';
  }

  res.json({
    status: 'ok',
    ...checks,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/bitrix', bitrixRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/debug', debugRoutes);

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error Handler
app.use(errorHandler);

export default app;
