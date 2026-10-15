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

export function serializeBitrixParams(params: any, prefix = ''): string {
  if (!params || typeof params !== 'object') return '';
  const pairs: string[] = [];
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(val)) {
      val.forEach((item, idx) => {
        if (typeof item === 'object' && item !== null) {
          pairs.push(serializeBitrixParams(item, `${fullKey}[${idx}]`));
        } else {
          pairs.push(`${encodeURIComponent(`${fullKey}[${idx}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof val === 'object') {
      pairs.push(serializeBitrixParams(val, fullKey));
    } else {
      pairs.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(val))}`);
    }
  }
  return pairs.filter(Boolean).join('&');
}

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
      const batchChunk = calls.slice(i, i + BATCH_SIZE);
      const cmd: Record<string, string> = {};
      batchChunk.forEach((call, idx) => {
        const qs = serializeBitrixParams(call.params || {});
        cmd[`call_${idx}`] = `${call.method}${qs ? '?' + qs : ''}`;
      });

      try {
        const response = await this.request<BitrixBatchResponse>('post', 'batch', { halt: 0, cmd });
        const resData = response.result?.result || {};
        const errData = response.result?.result_error || {};

        batchChunk.forEach((_, idx) => {
          const key = `call_${idx}`;
          if (errData[key]) {
            const errObj = errData[key];
            const errMsg = errObj?.error_description || errObj?.error || (typeof errObj === 'string' ? errObj : 'Batch command error');
            results.push({ success: false, error: errMsg });
          } else {
            results.push({ success: true, result: resData[key] });
          }
        });
      } catch (error: any) {
        logger.error({ err: error }, 'Batch request failed');
        batchChunk.forEach(() => results.push({ success: false, error: error?.message || 'Batch HTTP failed' }));
      }

      // Auto-retry failed calls in this chunk (up to 2 attempts)
      const chunkStartIndex = results.length - batchChunk.length;
      let failedIndices = batchChunk.map((_, idx) => idx).filter(idx => !results[chunkStartIndex + idx].success);
      let batchRetryCount = 0;

      while (failedIndices.length > 0 && batchRetryCount < 2) {
        batchRetryCount++;
        await new Promise(resolve => setTimeout(resolve, 1000 * batchRetryCount));

        const retryCmd: Record<string, string> = {};
        failedIndices.forEach(idx => {
          const call = batchChunk[idx];
          const qs = serializeBitrixParams(call.params || {});
          retryCmd[`call_${idx}`] = `${call.method}${qs ? '?' + qs : ''}`;
        });

        try {
          const retryResp = await this.request<BitrixBatchResponse>('post', 'batch', { halt: 0, cmd: retryCmd });
          const retryResData = retryResp.result?.result || {};
          const retryErrData = retryResp.result?.result_error || {};

          failedIndices.forEach(idx => {
            const key = `call_${idx}`;
            const targetIndex = chunkStartIndex + idx;
            if (!retryErrData[key] && retryResData[key] !== undefined) {
              results[targetIndex] = { success: true, result: retryResData[key] };
            } else if (retryErrData[key]) {
              const errObj = retryErrData[key];
              const errMsg = errObj?.error_description || errObj?.error || 'Batch command error';
              results[targetIndex] = { success: false, error: errMsg };
            }
          });
        } catch {
          // Keep existing failure if retry request failed
        }
        failedIndices = batchChunk.map((_, idx) => idx).filter(idx => !results[chunkStartIndex + idx].success);
      }
    }

    return results;
  }

  async batchNamed(commands: Record<string, { method: string; params?: any }>): Promise<{ result: Record<string, any>; errors: Record<string, any> }> {
    const keys = Object.keys(commands);
    const BATCH_SIZE = 50;
    const combinedResult: Record<string, any> = {};
    const combinedErrors: Record<string, any> = {};

    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batchKeys = keys.slice(i, i + BATCH_SIZE);
      const cmd: Record<string, string> = {};
      batchKeys.forEach(k => {
        const call = commands[k];
        const qs = serializeBitrixParams(call.params || {});
        cmd[k] = `${call.method}${qs ? '?' + qs : ''}`;
      });

      try {
        const response = await this.request<BitrixBatchResponse>('post', 'batch', { halt: 0, cmd });
        const resData = response.result?.result || {};
        const errData = response.result?.result_error || {};

        batchKeys.forEach(k => {
          if (errData[k]) {
            combinedErrors[k] = errData[k];
          } else {
            combinedResult[k] = resData[k];
          }
        });
      } catch (error: any) {
        logger.error({ err: error }, 'BatchNamed request failed');
        batchKeys.forEach(k => {
          combinedErrors[k] = { error: 'BATCH_FAILED', error_description: error?.message || 'Batch execution failed' };
        });
      }

      // Auto-retry failed commands within this chunk (up to 2 attempts)
      let failedKeys = batchKeys.filter(k => combinedErrors[k]);
      let retryCount = 0;

      while (failedKeys.length > 0 && retryCount < 2) {
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));

        const retryCmd: Record<string, string> = {};
        failedKeys.forEach(k => {
          const call = commands[k];
          const qs = serializeBitrixParams(call.params || {});
          retryCmd[k] = `${call.method}${qs ? '?' + qs : ''}`;
        });

        try {
          const retryResponse = await this.request<BitrixBatchResponse>('post', 'batch', { halt: 0, cmd: retryCmd });
          const retryResData = retryResponse.result?.result || {};
          const retryErrData = retryResponse.result?.result_error || {};

          failedKeys.forEach(k => {
            if (!retryErrData[k] && retryResData[k] !== undefined) {
              combinedResult[k] = retryResData[k];
              delete combinedErrors[k];
            } else if (retryErrData[k]) {
              combinedErrors[k] = retryErrData[k];
            }
          });
        } catch {
          // Keep existing failure if retry request failed
        }
        failedKeys = batchKeys.filter(k => combinedErrors[k]);
      }
    }

    return { result: combinedResult, errors: combinedErrors };
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
