import api from './api';
import type { ApiResponse } from '../types';

export async function getCatalogs(): Promise<ApiResponse<any[]>> {
  const res = await api.get('/bitrix/catalogs');
  return res.data;
}

export async function getProductFields(): Promise<ApiResponse<any[]>> {
  const res = await api.get('/bitrix/products/fields');
  return res.data;
}

export async function getInventoryFields(): Promise<ApiResponse<any[]>> {
  const res = await api.get('/bitrix/inventory/fields');
  return res.data;
}

export async function getInvoiceFields(): Promise<ApiResponse<{ fields: any[]; statuses: any[] }>> {
  const res = await api.get('/bitrix/invoice-fields');
  return res.data;
}

export async function getStores(): Promise<ApiResponse<any[]>> {
  const res = await api.get('/bitrix/stores');
  return res.data;
}

export async function getStockReceiptFields(): Promise<ApiResponse<{
  stockReceiptFields: any[];
  catalogFields: any[];
  stores: any[];
  currency: string;
}>> {
  const res = await api.get('/bitrix/stock-receipt-fields');
  return res.data;
}

export async function getQuotationProducts(search?: string, limit?: number): Promise<ApiResponse<any[]>> {
  const params: any = {};
  if (search) params.search = search;
  if (limit) params.limit = limit;
  const res = await api.get('/bitrix/quote-pricing/products', { params });
  return res.data;
}

export async function applyQuotationPricing(data: {
  entityId: number | string;
  entityType?: 'quote' | 'deal';
  customerType?: 'DEALER' | 'END_USER';
}): Promise<ApiResponse<any>> {
  const res = await api.post('/bitrix/quote-pricing/apply', data);
  return res.data;
}

export async function getQuotationConfig(): Promise<ApiResponse<any>> {
  const res = await api.get('/bitrix/quote-pricing/config');
  return res.data;
}