import axios, { AxiosInstance, AxiosError } from 'axios';
import { prisma } from '../../config/database';
import { decrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { debugLog } from '../../services/debug/debugLog.service';
import { bitrixConfig } from '../../config/bitrix';
import { AppError } from '../../middleware/error.middleware';
import { BitrixApiResponse, BitrixBatchResponse } from '../../types';

const retryableThrottleCodes = [
  'QUERY_LIMIT_EXCEEDED',
  'ERROR_OPERATION_LIMIT',
  'OPERATION_LIMIT',
  'REQUEST_LIMIT_EXCEEDED',
  'REST_HEAVY_SYSTEM_RESPONSE',
];

export class BitrixClient {
  private instance: AxiosInstance;

  constructor(webhookUrl: string) {
    this.instance = axios.create({
      baseURL: webhookUrl,
      timeout: bitrixConfig.defaultTimeout,
    });
  }

  static async fromDbConfiguration(userId?: string): Promise<BitrixClient> {
    const config = await prisma.bitrixConfiguration.findFirst({
      where: userId ? { createdById: userId, isActive: true } : { isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!config) {
      throw new AppError('Bitrix configuration not found. Please configure the Bitrix connection in settings.', 400);
    }

    let webhookUrl: string;
    try {
      webhookUrl = decrypt(config.webhookUrlEncrypted);
    } catch (error) {
      logger.error({ err: error }, 'Failed to decrypt Bitrix webhook');
      throw new AppError('Failed to decrypt Bitrix webhook configuration', 500);
    }

    return new BitrixClient(webhookUrl);
  }

  private async request<T = any>(
    method: 'get' | 'post',
    endpoint: string,
    params?: any,
    retries: number = bitrixConfig.maxRetries
  ): Promise<T> {
    let attempt = 0;
    while (attempt <= retries) {
      try {
        const axiosStartedAt = Date.now();
        const response = await this.instance.request({
          method,
          url: endpoint,
          data: params,
          params: method === 'get' ? params : undefined,
        });
        const axiosDuration = Date.now() - axiosStartedAt;

        debugLog.debug('BITRIX', `Bitrix call ${endpoint} -> HTTP ${response.status} in ${axiosDuration}ms`);

        // Bitrix frequently returns throttling errors (QUERY_LIMIT_EXCEEDED,
        // ERROR_OPERATION_LIMIT) as HTTP 200 with an `error` field in the body
        const data: any = response.data;
        if (data && typeof data === 'object' && typeof data.error === 'string' && data.error) {
          attempt++;
          const errCode = data.error;
          if (retryableThrottleCodes.includes(errCode)) {
            if (attempt > retries) {
              logger.error({ endpoint, errCode }, 'Bitrix throttle limit exceeded after retries');
              debugLog.error('BITRIX', `Bitrix throttle (${errCode}) exceeded ${retries} retries on ${endpoint}`);
              throw new AppError('Bitrix rate limit exceeded: ' + (data.error_description || errCode), 429);
            }
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
            logger.info({ endpoint, errCode }, `Bitrix request retry ${attempt}/${retries} in ${delay}ms`);
            debugLog.warn('BITRIX', `Bitrix throttle (${errCode}) on ${endpoint}, retrying ${attempt}/${retries} in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          const message = data.error_description || errCode;
          debugLog.error('BITRIX', `Bitrix error on ${endpoint}: ${message}`, { error: errCode });
          if (message.includes('Method not found')) {
            throw new AppError('Bitrix API method not found: ' + endpoint, 400);
          }
          throw new AppError(message, 400);
        }

        return data as T;
      } catch (error) {
        attempt++;
        const axiosError = error as AxiosError;

        if (axiosError.response?.status === 429 || axiosError.response?.status === 503 || axiosError.code === 'ECONNABORTED' || axiosError.code === 'ECONNREFUSED') {
          if (attempt > retries) {
            throw this.normalizeError(error);
          }
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          logger.info({ endpoint }, `Bitrix request retry ${attempt}/${retries} in ${delay}ms`);
          const retryReason = axiosError.response?.status || axiosError.code || 'unknown';
          debugLog.warn('BITRIX', `Bitrix request failed (${retryReason}) on ${endpoint}, retrying ${attempt}/${retries}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        debugLog.error('BITRIX', `Bitrix request failed on ${endpoint}: ${(error as Error).message}`);
        throw this.normalizeError(error);
      }
    }
    throw new AppError('Unexpected Bitrix request failure', 500);
  }

  async call(method: string, params: any = {}): Promise<any> {
    const result = await this.request<BitrixApiResponse>('post', method, params);
    return result.result;
  }

  async callMethod(method: string, params: any = {}): Promise<any> {
    const result = await this.request<BitrixApiResponse>('post', method, params);
    return result.result;
  }

  async batch(calls: Array<{ method: string; params?: any }>): Promise<any[]> {
    const BATCH_SIZE = 50;
    const results: any[] = [];

    for (let i = 0; i < calls.length; i += BATCH_SIZE) {
      const batch = calls.slice(i, i + BATCH_SIZE);
      
      // Build cmd for batch request
      const cmd: Record<string, string> = {};
      batch.forEach((call, idx) => {
        const paramsStr = Object.entries(call.params || {})
          .map(([k, v]) => JSON.stringify(v))
          .join(',');
        cmd[`call_${idx}`] = call.method + `${paramsStr ? '?' + paramsStr : ''}`;
      });

      try {
        const response = await this.request<BitrixBatchResponse>('post', 'batch', { cmd });
        results.push(...(response.result || []));
      } catch (error) {
        logger.error({ err: error }, 'Batch request failed');
        // Return nulls for failed batch to allow per-item handling
        batch.forEach(() => results.push(null));
      }
    }

    return results;
  }

  async testConnection(portalUrl: string): Promise<boolean> {
    try {
      const result = await this.callMethod('scope', {});
      // Check that scope response looks valid
      if (!result || typeof result !== 'object') {
        return false;
      }
      return true;
    } catch (error) {
      throw error;
    }
  }

  private normalizeError(error: any): AppError {
    const axiosError = error as AxiosError<any>;

    if (axiosError.response) {
      const data = axiosError.response.data;
      const bitrixError = data?.error_description || data?.error;
      const status = axiosError.response.status;

      if (status === 401 || status === 403) {
        return new AppError('Bitrix authentication failed. Check webhook configuration.', 400);
      }
      if (status === 404) {
        return new AppError('Bitrix API method not found: ' + (error.config?.url || ''), 400);
      }
      if (status === 429) {
        return new AppError('Bitrix rate limit exceeded', 429);
      }

      return new AppError(bitrixError || `Bitrix API error (${status})`, 400);
    }

    if (axiosError.code === 'ECONNABORTED') {
      return new AppError('Bitrix request timed out', 504);
    }
    if (axiosError.code === 'ECONNREFUSED') {
      return new AppError('Unable to connect to Bitrix', 502);
    }

    return new AppError('Bitrix request failed: ' + axiosError.message, 500);
  }
}
