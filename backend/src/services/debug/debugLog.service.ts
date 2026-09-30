import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

export type DebugLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type DebugSource = 'SYSTEM' | 'API' | 'AUTH' | 'SETTINGS' | 'BITRIX' | 'IMPORT' | 'WORKER' | 'LICENTIC';

export interface DebugLogDetails {
  [key: string]: any;
}

export class DebugLogService {
  async write(level: DebugLogLevel, source: DebugSource, message: string, details?: DebugLogDetails): Promise<void> {
    try {
      await prisma.debugLog.create({
        data: {
          level,
          source,
          message: String(message).slice(0, 500),
          ...(details !== undefined ? { details: details as any } : {}),
        },
      });
    } catch (error) {
      // Never let debug logging break the application
      logger.warn({ err: error }, 'Failed to write debug log to database');
    }
  }

  debug(source: DebugSource, message: string, details?: DebugLogDetails): void {
    void this.write('DEBUG', source, message, details);
  }

  info(source: DebugSource, message: string, details?: DebugLogDetails): void {
    void this.write('INFO', source, message, details);
  }

  warn(source: DebugSource, message: string, details?: DebugLogDetails): void {
    void this.write('WARN', source, message, details);
  }

  error(source: DebugSource, message: string, details?: DebugLogDetails): void {
    void this.write('ERROR', source, message, details);
  }
}

export const debugLog = new DebugLogService();