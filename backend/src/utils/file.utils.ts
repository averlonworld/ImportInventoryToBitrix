import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

export function getUploadDir(): string {
  return os.tmpdir();
}

export async function ensureUploadDir(): Promise<void> {
  const dir = getUploadDir();
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

export function getUniqueFilePath(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const uniqueName = `${uuidv4()}${ext}`;
  return path.join(getUploadDir(), uniqueName);
}

export function isAllowedFileType(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

export function getMaxFileSizeBytes(): number {
  return env.MAX_FILE_SIZE_MB * 1024 * 1024;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist, ignore
  }
}