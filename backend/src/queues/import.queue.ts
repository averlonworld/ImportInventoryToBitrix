import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';

export type ImportType = 'PRODUCTS' | 'INVOICES' | 'STOCK_RECEIPTS';

export interface ImportJobData {
  importJobId: string;
  type?: ImportType;
  mapping: any;
  importMode: 'CREATE_ONLY' | 'CREATE_UPDATE' | 'UPDATE_ONLY';
}

export const importQueue = new Queue<ImportJobData>('import-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1, // Single execution; item-level retries are handled by Tier 2 engine to prevent duplicate job restarts
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export function createImportWorker(processor: (job: Job<ImportJobData>) => Promise<void>): Worker {
  const worker = new Worker<ImportJobData>('import-queue', processor, {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 1800000, // 30 minutes lock duration for bulk jobs (e.g. 2000 - 4000+ items)
    maxStalledCount: 2,
  });

  worker.on('completed', (job) => {
    logger.info(`Import job ${job.data.importJobId} processed`);
  });

  worker.on('failed', (job, err) => {
    logger.error({ err }, `Import job ${job?.data.importJobId} failed`);
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Import worker error');
  });

  return worker;
}

export { importQueue as default };
