import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
];

for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}
dotenv.config();

function getRequiredEnv(key: string, allowEmpty = false): string {
  const value = process.env[key];
  if (value === undefined || (!allowEmpty && value.trim() === '')) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  NODE_ENV: getRequiredEnv('NODE_ENV'),
  PORT: parseInt(getRequiredEnv('PORT'), 10),
  DATABASE_URL: getRequiredEnv('DATABASE_URL'),
  REDIS_URL: getRequiredEnv('REDIS_URL'),
  JWT_SECRET: getRequiredEnv('JWT_SECRET'),
  ADMIN_EMAIL: getRequiredEnv('ADMIN_EMAIL'),
  ADMIN_PASSWORD: getRequiredEnv('ADMIN_PASSWORD'),
  BITRIX_ENCRYPTION_KEY: getRequiredEnv('BITRIX_ENCRYPTION_KEY'),
  MAX_FILE_SIZE_MB: parseInt(getRequiredEnv('MAX_FILE_SIZE_MB'), 10),
  BITRIX_CONCURRENCY: parseInt(getRequiredEnv('BITRIX_CONCURRENCY'), 10),
  BITRIX_MAX_RETRIES: parseInt(getRequiredEnv('BITRIX_MAX_RETRIES'), 10),
  BITRIX_REQUEST_TIMEOUT: parseInt(getRequiredEnv('BITRIX_REQUEST_TIMEOUT'), 10),
  BATCH_SIZE: parseInt(getRequiredEnv('BATCH_SIZE'), 10),
  COOKIE_DOMAIN: getRequiredEnv('COOKIE_DOMAIN', true),
  COOKIE_SECURE: getRequiredEnv('COOKIE_SECURE') === 'true',
  UPLOAD_DIR: path.resolve(getRequiredEnv('UPLOAD_DIR')),
  LICENTIC_API_BASE: getRequiredEnv('LICENTIC_API_BASE'),
  LICENTIC_PRODUCT_ID: getRequiredEnv('LICENTIC_PRODUCT_ID'),
};