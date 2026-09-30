import { Request } from 'express';

export interface LicenseInfo {
  licenseKey: string;
  status: string;
  planName: string;
  productName: string;
  productId?: string;
  startDate?: string;
  endDate?: string;
  daysRemaining?: number;
  isExpired: boolean;
  expiryMessage?: string;
  features?: Record<string, any>;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  license?: LicenseInfo;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BitrixConfig {
  portalUrl: string;
  webhookUrl: string;
}

export interface ExcelRow {
  [key: string]: any;
}

export interface ColumnMappingConfig {
  [excelColumn: string]: string; // maps to Bitrix field
}

export interface ImportProgress {
  jobId: string;
  totalRows: number;
  processedRows: number;
  successfulRows: number;
  failedRows: number;
  skippedRows: number;
  currentSku?: string;
  status: string;
}

export interface BitrixProduct {
  id?: number;
  name: string;
  code?: string;
  price?: number;
  quantity?: number;
  sku?: string;
  barcode?: string;
  xmlId?: string;
  [key: string]: any;
}

export interface BitrixApiResponse<T = any> {
  result: T;
  time: {
    start: string;
    finish: string;
    duration: number;
    processing: number;
  };
}

export interface BitrixBatchResponse<T = any> {
  result: T[];
  time: {
    start: string;
    finish: string;
    duration: number;
    processing: number;
  };
}