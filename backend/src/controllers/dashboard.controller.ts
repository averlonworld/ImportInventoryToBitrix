import { Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { logger } from '../utils/logger';

export class DashboardController {
  async getStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;

      // Filter by the authenticated user's ID
      const jobWhere = userId ? { createdById: userId } : {};
      const recordWhere = userId ? { importJob: { createdById: userId } } : {};

      const bitrixWhere = userId ? { createdById: userId, isActive: true } : { isActive: true };

      const [totalImports, totalRecords, successfulRecords, failedRecords, skippedRecords, bitrixConfig, recentImports] =
        await Promise.all([
          prisma.importJob.count({ where: jobWhere }),
          prisma.importRecord.count({ where: recordWhere }),
          prisma.importRecord.count({ where: { ...recordWhere, status: 'SUCCESS' } }),
          prisma.importRecord.count({ where: { ...recordWhere, status: { in: ['FAILED', 'PARTIAL_FAILURE'] } } }),
          prisma.importRecord.count({ where: { ...recordWhere, status: 'SKIPPED' } }),
          prisma.bitrixConfiguration.findFirst({ where: bitrixWhere, orderBy: { updatedAt: 'desc' } }),
          prisma.importJob.findMany({
            where: jobWhere,
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { createdBy: { select: { email: true } } },
          }),
        ]);

      const isConfigured = !!bitrixConfig && !!bitrixConfig.webhookUrlEncrypted;

      res.json({
        success: true,
        data: {
          totalImports,
          totalRecords,
          successfulRecords,
          failedRecords,
          skippedRecords,
          bitrixConnection: {
            status: isConfigured ? (bitrixConfig.connectionStatus || 'UNKNOWN') : 'UNKNOWN',
            configured: isConfigured,
            lastTestedAt: isConfigured ? (bitrixConfig.lastTestedAt || null) : null,
          },
          recentImports,
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'Dashboard stats failed');
      next(error);
    }
  }
}

export const dashboardController = new DashboardController();
