import { Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { encrypt, decrypt } from '../utils/encryption';
import { BitrixClient } from '../services/bitrix/BitrixClient';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { debugLog } from '../services/debug/debugLog.service';

interface BitrixSettingsInput {
  portalUrl?: string;
  webhookUrl?: string;
  isActive?: boolean;
}

export class SettingsController {
  async getBitrixSettings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      const config = userId
        ? await prisma.bitrixConfiguration.findFirst({
            where: { createdById: userId, isActive: true },
            orderBy: { updatedAt: 'desc' },
          })
        : null;

      res.json({
        success: true,
        data: {
          portalUrl: config?.portalUrl || '',
          webhookConfigured: !!config?.webhookUrlEncrypted,
          connectionStatus: config?.connectionStatus || 'UNKNOWN',
          lastTestedAt: config?.lastTestedAt || null,
          isActive: config?.isActive ?? false,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async saveBitrixSettings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      const { portalUrl, webhookUrl, isActive } = req.body as BitrixSettingsInput;

      if (!portalUrl) {
        throw new AppError('Portal URL is required', 400);
      }

      if (portalUrl && !isValidUrl(portalUrl)) {
        throw new AppError('Invalid portal URL format', 400);
      }

      if (webhookUrl && (!isValidUrl(webhookUrl) || !webhookUrl.includes('/rest/'))) {
        throw new AppError('Invalid webhook URL. Expected a Bitrix24 REST webhook URL like https://company.bitrix24.com/rest/USER_ID/TOKEN/', 400);
      }

      const webhookEncrypted = webhookUrl ? encrypt(webhookUrl.trim()) : undefined;

      const existing = userId
        ? await prisma.bitrixConfiguration.findFirst({
            where: { createdById: userId, isActive: true },
          })
        : null;

      let config;
      if (existing) {
        config = await prisma.bitrixConfiguration.update({
          where: { id: existing.id },
          data: {
            portalUrl: portalUrl.trim(),
            ...(webhookEncrypted ? { webhookUrlEncrypted: webhookEncrypted } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
          },
        });
      } else {
        if (!webhookEncrypted) {
          throw new AppError('Webhook URL is required when creating Bitrix configuration', 400);
        }
        config = await prisma.bitrixConfiguration.create({
          data: {
            portalUrl: portalUrl.trim(),
            webhookUrlEncrypted: webhookEncrypted,
            isActive: isActive ?? true,
            connectionStatus: 'UNKNOWN',
            createdById: userId,
          },
        });
      }

      logger.info(`Bitrix configuration saved for user ${userId || 'unknown'}`);
      debugLog.info('SETTINGS', `Bitrix configuration ${existing ? 'updated' : 'saved'} for ${config.portalUrl}`);

      res.json({
        success: true,
        data: {
          portalUrl: config.portalUrl,
          webhookConfigured: !!config.webhookUrlEncrypted,
          connectionStatus: config.connectionStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateBitrixSettings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      const { portalUrl, webhookUrl, isActive } = req.body as BitrixSettingsInput;

      const config = userId
        ? await prisma.bitrixConfiguration.findFirst({
            where: { createdById: userId, isActive: true },
            orderBy: { updatedAt: 'desc' },
          })
        : null;

      if (!config) {
        throw new AppError('No Bitrix configuration exists to update', 404);
      }

      if (portalUrl && !isValidUrl(portalUrl)) {
        throw new AppError('Invalid portal URL format', 400);
      }

      if (webhookUrl && (!isValidUrl(webhookUrl) || !webhookUrl.includes('/rest/'))) {
        throw new AppError('Invalid webhook URL. Expected a Bitrix24 REST webhook URL', 400);
      }

      const webhookEncrypted = webhookUrl ? encrypt(webhookUrl.trim()) : config.webhookUrlEncrypted;

      const updated = await prisma.bitrixConfiguration.update({
        where: { id: config.id },
        data: {
          ...(portalUrl ? { portalUrl: portalUrl.trim() } : {}),
          webhookUrlEncrypted: webhookEncrypted,
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });

      res.json({
        success: true,
        data: {
          portalUrl: updated.portalUrl,
          webhookConfigured: true,
          connectionStatus: updated.connectionStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteBitrixSettings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      const config = userId
        ? await prisma.bitrixConfiguration.findFirst({
            where: { createdById: userId, isActive: true },
          })
        : null;

      if (config) {
        await prisma.bitrixConfiguration.update({
          where: { id: config.id },
          data: { isActive: false },
        });
      }

      debugLog.info('SETTINGS', `Bitrix configuration deleted/deactivated for user ${userId || 'unknown'}`);

      res.json({ success: true, message: 'Bitrix configuration deleted' });
    } catch (error) {
      next(error);
    }
  }

  async testBitrixConnection(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const userId = req.user?.id;
    try {
      const config = userId
        ? await prisma.bitrixConfiguration.findFirst({
            where: { createdById: userId, isActive: true },
            orderBy: { updatedAt: 'desc' },
          })
        : null;

      if (!config || !config.webhookUrlEncrypted) {
        throw new AppError('Bitrix webhook not configured. Please save your webhook first.', 400);
      }

      let webhookUrl: string;
      try {
        webhookUrl = decrypt(config.webhookUrlEncrypted);
      } catch (e) {
        throw new AppError('Failed to decrypt stored Bitrix webhook', 500);
      }

      // Test connection by calling a safe Bitrix endpoint
      const client = new BitrixClient(webhookUrl);
      const isConnected = await client.testConnection(config.portalUrl);

      await prisma.bitrixConfiguration.update({
        where: { id: config.id },
        data: {
          connectionStatus: isConnected ? 'CONNECTED' : 'FAILED',
          lastTestedAt: new Date(),
        },
      });

      if (isConnected) {
        debugLog.info('SETTINGS', 'Bitrix24 test connection succeeded', { portalUrl: config.portalUrl });
        res.json({
          success: true,
          message: 'Bitrix24 connection successful',
          data: {
            connectionStatus: 'CONNECTED',
            lastTestedAt: new Date(),
          },
        });
      } else {
        debugLog.error('SETTINGS', 'Bitrix24 test connection failed', { portalUrl: config.portalUrl });
        res.status(400).json({
          success: false,
          message: 'Unable to connect to Bitrix24',
          data: {
            connectionStatus: 'FAILED',
            lastTestedAt: new Date(),
          },
        });
      }
    } catch (error) {
      // Update connection status on failure
      try {
        if (userId) {
          const config = await prisma.bitrixConfiguration.findFirst({ where: { createdById: userId, isActive: true } });
          if (config) {
            await prisma.bitrixConfiguration.update({
              where: { id: config.id },
              data: { connectionStatus: 'FAILED', lastTestedAt: new Date() },
            });
          }
        }
      } catch { /* ignore */ }

      debugLog.error('SETTINGS', 'Bitrix24 test connection failed with error', { message: (error as Error).message });

      next(error);
    }
  }

}

export const settingsController = new SettingsController();

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
