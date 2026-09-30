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

export interface User {
  id: string;
  email: string;
  role: string;
  license?: LicenseInfo;
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

export interface BitrixSettings {
  portalUrl: string;
  webhookConfigured: boolean;
  connectionStatus: 'UNKNOWN' | 'CONNECTED' | 'FAILED';
  lastTestedAt: string | null;
  isActive: boolean;
}

export interface ImportJob {
  id: string;
  fileName: string;
  importMode: string;
  type?: string;
  status: string;
  totalRows: number;
  processedRows: number;
  successfulRows: number;
  failedRows: number;
  skippedRows: number;
  createdProductsCount?: number;
  updatedProductsCount?: number;
  duplicateRows?: number;
  mappingJson?: any;
  bitrixDocumentId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  createdBy?: { email: string };
  createdById?: string;
  statusCounts?: Record<string, number>;
  _count?: { records: number };
}

export interface ImportRecord {
  id: string;
  importJobId: string;
  rowNumber: number;
  sku?: string;
  productName?: string;
  partNumber?: string;
  description?: string;
  status: string;
  actionTaken?: string;
  bitrixProductId?: string;
  bitrixDocumentId?: string;
  warehouseId?: number;
  quantityArrived?: number;
  purchasePrice?: number;
  salesPrice?: number;
  cost?: number;
  dealerPrice?: number;
  endUserPrice?: number;
  qtyOnOrder?: number;
  qtyInStock?: number;
  errorMessage?: string;
  bitrixError?: string;
  errorType?: string;
  retryCount?: number;
  rawData?: any;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRecordsSummary {
  totalRecords: number;
  processing: number;
  successful: number;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
  retrying: number;
  pending: number;
  totalRetries: number;
}

export interface ImportRecordsResponse {
  job: {
    id: string;
    fileName: string;
    status: string;
    type?: string;
    totalRows: number;
    processedRows: number;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    createdBy: string;
    bitrixDocumentId?: string;
    duration: number;
  };
  summary: ImportRecordsSummary;
  records: ImportRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface StockReceiptField {
  id: string;
  name: string;
  type: string;
  isRequired: boolean;
  isCore?: boolean;
}

export interface BitrixStore {
  id: number;
  title: string;
  address?: string;
  active?: string;
}

export interface StockReceiptDiscovery {
  stockReceiptFields: StockReceiptField[];
  catalogFields: StockReceiptField[];
  stores: BitrixStore[];
  currency: string;
}

export interface ImportPreview {
  fileName: string;
  fileSize: number;
  worksheetName: string;
  headers: string[];
  rows: Record<string, any>[];
  totalRows: number;
  columnCount: number;
}

export interface DashboardStats {
  totalImports: number;
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;
  skippedRecords: number;
  bitrixConnection: {
    status: string;
    configured: boolean;
    lastTestedAt: string | null;
  };
  recentImports: ImportJob[];
}

export interface DebugLog {
  id: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  source: string;
  message: string;
  details?: Record<string, any> | null;
  createdAt: string;
}

export interface DebugLogStats {
  total: number;
  levelCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  errorsLast24h: number;
}

export interface QuotationProductItem {
  id: number;
  productCode: string;
  partNumber: string;
  description: string;
  dealerPrice: number;
  endUserPrice: number;
  cost?: number;
  qtyInStock?: number;
  qtyOnOrder?: number;
  currency: string;
}

export interface QuotePricingAdjustment {
  productId: number;
  productName: string;
  productCode: string;
  partNumber: string;
  description: string;
  originalPrice: number;
  appliedPrice: number;
  priceTypeUsed: 'DEALER_PRICE' | 'END_USER_PRICE';
  quantity: number;
  total: number;
}

export interface QuotePricingResult {
  success: boolean;
  entityId: number;
  entityType: 'quote' | 'deal';
  customerType: 'DEALER' | 'END_USER';
  customerName?: string;
  adjustments: QuotePricingAdjustment[];
  totalAmount: number;
  message?: string;
}

export interface DailyScheduleConfig {
  enabled: boolean;
  timeOfDay: string;
  feedFolderPath: string;
  autoArchive: boolean;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastFileName?: string | null;
  lastJobId?: string | null;
  feedFileCount: number;
  pendingFiles: string[];
}

