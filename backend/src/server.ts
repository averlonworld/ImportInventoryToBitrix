import app from './app';
import bcrypt from 'bcrypt';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase, prisma } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { startImportWorker, stopImportWorker } from './services/import/import.worker';
import { DailyImportScheduler } from './services/schedule/dailyImport.scheduler';
import { ensureUploadDir } from './utils/file.utils';
import { logger } from './utils/logger';

async function ensureAdminUser(): Promise<void> {
  const email = env.ADMIN_EMAIL.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    logger.info({ email }, 'Admin user already exists');
    return;
  }

  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });
  logger.info({ email }, 'Created admin user');
}

async function bootstrap(): Promise<void> {
  try {
    // Ensure upload directory exists
    await ensureUploadDir();

    // Connect to database
    await connectDatabase();

    // Ensure admin user exists (idempotent seed)
    await ensureAdminUser();

    // Connect to Redis
    await connectRedis();

    // Start the import worker for background processing
    startImportWorker();

    // Start the automated daily import scheduler
    DailyImportScheduler.startScheduler();

    // Start the server
    const server = app.listen(env.PORT, '0.0.0.0', () => {
      logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully`);

      DailyImportScheduler.stopScheduler();
      await stopImportWorker();

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      await disconnectDatabase();
      await disconnectRedis();

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

bootstrap();
