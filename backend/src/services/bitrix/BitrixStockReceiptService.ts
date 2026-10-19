import { BitrixClient } from './BitrixClient';
import { logger } from '../../utils/logger';
import { debugLog } from '../debug/debugLog.service';
import { BitrixCatalogService } from './BitrixCatalogService';

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

export const STOCK_RECEIPT_CORE_FIELDS: StockReceiptField[] = [
  { id: 'PRODUCT_NAME', name: 'Product Name', type: 'string', isRequired: true, isCore: true },
  { id: 'SKU', name: 'SKU / Product Code', type: 'string', isRequired: false, isCore: true },
  { id: 'BARCODE', name: 'Barcode', type: 'string', isRequired: false, isCore: true },
  { id: 'PURCHASE_PRICE', name: 'Purchase Price (Cost)', type: 'double', isRequired: false, isCore: true },
  { id: 'SALES_PRICE', name: 'Sales Price (Selling Price)', type: 'double', isRequired: false, isCore: true },
  { id: 'QUANTITY_ARRIVED', name: 'Quantity Arrived', type: 'double', isRequired: true, isCore: true },
  { id: 'WAREHOUSE', name: 'Warehouse / Destination Store', type: 'string', isRequired: false, isCore: true },
  { id: 'QUANTITY_DESTINATION', name: 'Quantity at Destination', type: 'double', isRequired: false, isCore: true },
  { id: 'TOTAL', name: 'Total', type: 'double', isRequired: false, isCore: true },
];

export class BitrixStockReceiptService {
  private client: BitrixClient;

  constructor(client: BitrixClient) {
    this.client = client;
  }

  async getStores(): Promise<BitrixStore[]> {
    try {
      const result = await this.client.callMethod('catalog.store.list', {});
      const stores = (result && (result.stores || result.result || result)) || [];
      return (Array.isArray(stores) ? stores : []).map((s: any) => ({
        id: Number(s.id),
        title: s.title || `Warehouse #${s.id}`,
        address: s.address || '',
        active: s.active || 'Y',
      }));
    } catch (error) {
      logger.warn({ err: error }, 'Failed to fetch Bitrix stores');
      return [];
    }
  }

  async getDiscoveryFields(): Promise<{
    stockReceiptFields: StockReceiptField[];
    catalogFields: StockReceiptField[];
    stores: BitrixStore[];
    currency: string;
  }> {
    const catalogService = new BitrixCatalogService(this.client);
    let currency = 'INR';
    let stores: BitrixStore[] = [];
    let catalogFields: StockReceiptField[] = [];

    try {
      const ctx = await catalogService.getCatalogContext();
      currency = ctx.currency;
    } catch {
      // Use fallback
    }

    try {
      stores = await this.getStores();
    } catch {
      // Use empty
    }

    try {
      const pFields = await catalogService.getProductFields();
      catalogFields = pFields.map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        isRequired: f.isRequired,
        isCore: false,
      }));
    } catch {
      // Fallback
    }

    return {
      stockReceiptFields: STOCK_RECEIPT_CORE_FIELDS,
      catalogFields,
      stores,
      currency,
    };
  }

  async createStockReceiptDocument(
    title: string,
    commentary?: string,
    currency?: string,
    responsibleId?: number,
    docType: 'S' | 'D' = 'S'
  ): Promise<{ id: number; title: string; docType: 'S' | 'D' }> {
    try {
      debugLog.info('BITRIX', `Creating Bitrix inventory document (${docType}): ${title}`);

      // Resolve responsible user ID from current session if not provided
      let resolvedResponsibleId = responsibleId;
      if (!resolvedResponsibleId) {
        try {
          const user = await this.client.callMethod('user.current', {});
          if (user && (user.ID || user.id)) {
            resolvedResponsibleId = Number(user.ID || user.id);
          }
        } catch {
          resolvedResponsibleId = 1;
        }
      }
      if (!resolvedResponsibleId) resolvedResponsibleId = 1;

      // Resolve portal base currency if not provided
      let resolvedCurrency = currency;
      if (!resolvedCurrency) {
        try {
          const currenciesRes = await this.client.callMethod('crm.currency.list', {});
          const currencies = Array.isArray(currenciesRes) ? currenciesRes : (currenciesRes && currenciesRes.result) || [];
          const baseCurrency = currencies.find((c: any) => c.BASE === 'Y') || currencies[0];
          if (baseCurrency && baseCurrency.CURRENCY) {
            resolvedCurrency = baseCurrency.CURRENCY;
          }
        } catch {
          resolvedCurrency = 'INR';
        }
      }
      if (!resolvedCurrency) resolvedCurrency = 'INR';

      const now = new Date();
      const docNum = `DOC-${docType}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Date.now().toString().slice(-4)}`;

      const fields: any = {
        docType, // 'S' = Stock Receipt / Adjustment, 'D' = Stock Deduction / Write-off
        title: title.slice(0, 255),
        currency: resolvedCurrency,
        responsibleId: resolvedResponsibleId,
        dateDocument: now.toISOString(),
        docNumber: docNum,
        commentary: commentary || 'Created by Bitrix24 Inventory Middleware',
      };

      const result = await this.client.callMethod('catalog.document.add', { fields });

      const doc = result && (result.document || result.result || result);
      const id = typeof doc === 'number' ? doc : doc?.id || doc?.ID;

      if (!id) {
        throw new Error('Bitrix did not return a document ID for inventory document');
      }

      debugLog.info('BITRIX', `Bitrix inventory document (${docType}) created with ID: ${id}`);
      return { id: Number(id), title, docType };
    } catch (error: any) {
      logger.error({ err: error }, `Failed to create Bitrix inventory document (${docType})`);
      debugLog.error('BITRIX', `Failed to create inventory document (${docType}): ${error.message}`);
      throw error;
    }
  }

  async getCurrentStoreStock(productId: number, storeId?: number): Promise<number> {
    try {
      const targetStoreId = (storeId !== undefined && storeId !== null && Number(storeId) > 0) ? Number(storeId) : 1;
      const listRes = await this.client.callMethod('catalog.storeproduct.list', {
        filter: { productId: Number(productId), storeId: Number(targetStoreId) },
      });
      const items = (listRes && (listRes.storeProducts || listRes.result || listRes)) || [];
      const sp = Array.isArray(items) ? items[0] : null;
      if (sp && sp.amount !== undefined && sp.amount !== null && !isNaN(Number(sp.amount))) {
        return Number(sp.amount);
      }

      // Fallback: if store product record is not yet initialized, check product catalog quantity
      try {
        const pRes = await this.client.callMethod('catalog.product.get', { id: Number(productId) });
        const pQty = pRes && pRes.product && pRes.product.quantity;
        if (pQty !== undefined && pQty !== null && !isNaN(Number(pQty))) {
          return Number(pQty);
        }
      } catch {
        // Non-blocking fallback
      }

      return 0;
    } catch (err: any) {
      logger.warn({ err: err?.message, productId, storeId }, 'Failed to fetch current store stock; defaulting to 0');
      return 0;
    }
  }

  async batchGetStoreStock(productIds: number[], storeId?: number): Promise<Map<number, number>> {
    const stockMap = new Map<number, number>();
    const cleanIds = Array.from(new Set(productIds.filter(id => id && Number(id) > 0).map(id => Number(id))));
    if (cleanIds.length === 0) return stockMap;

    const targetStoreId = (storeId !== undefined && storeId !== null && Number(storeId) > 0) ? Number(storeId) : 1;
    const CHUNK_SIZE = 50;

    for (let i = 0; i < cleanIds.length; i += CHUNK_SIZE) {
      const chunk = cleanIds.slice(i, i + CHUNK_SIZE);
      try {
        const listRes = await this.client.callMethod('catalog.storeproduct.list', {
          filter: { '=productId': chunk, storeId: targetStoreId },
          select: ['id', 'productId', 'amount'],
        });
        const items = (listRes && (listRes.storeProducts || listRes.result?.storeProducts || listRes.result || listRes)) || [];
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item.productId && item.amount !== undefined && item.amount !== null && !isNaN(Number(item.amount))) {
              stockMap.set(Number(item.productId), Number(item.amount));
            }
          }
        }
      } catch (err: any) {
        logger.warn({ err: err?.message, storeId: targetStoreId }, 'Failed to batch fetch store stock');
      }
    }

    return stockMap;
  }

  async preloadWarehouseStock(storeId: number = 1): Promise<Map<string, number>> {
    const stockMap = new Map<string, number>();
    try {
      let start = 0;
      while (true) {
        const res = await (this.client as any).request('post', 'catalog.storeproduct.list', {
          filter: { storeId: Number(storeId) },
          select: ['id', 'productId', 'amount'],
          start,
        });
        const items = res?.result?.storeProducts || [];
        for (const item of items) {
          if (item.productId && item.amount !== undefined && item.amount !== null) {
            stockMap.set(`${item.productId}_${storeId}`, Number(item.amount));
          }
        }
        if (!res?.next || items.length === 0) {
          break;
        }
        start = res.next;
      }
      debugLog.info('BITRIX', `Preloaded ${stockMap.size} store product records for store ${storeId}`);
    } catch (err: any) {
      logger.warn({ err: err?.message, storeId }, 'Failed to preload warehouse stock; will use on-demand lookups');
    }
    return stockMap;
  }

  async batchAddDocumentElements(
    elements: Array<{
      docId: number;
      productId: number;
      amount: number;
      purchasingPrice?: number;
      storeTo?: number;
      storeFrom?: number;
    }>
  ): Promise<{ added: number; failed: number; results?: Array<{ success: boolean; result?: any; error?: string }> }> {
    const valid = elements.filter(el => Number(el.amount) > 0);
    if (valid.length === 0) return { added: 0, failed: 0, results: [] };

    const calls = valid.map(el => {
      const fields: any = {
        docId: Number(el.docId),
        ownerId: Number(el.docId),
        elementId: Number(el.productId),
        productId: Number(el.productId),
        amount: Number(el.amount),
      };
      if (el.purchasingPrice !== undefined && el.purchasingPrice !== null && !isNaN(Number(el.purchasingPrice))) {
        fields.purchasingPrice = Number(el.purchasingPrice);
      }
      if (el.storeFrom && Number(el.storeFrom) > 0) {
        fields.storeFrom = Number(el.storeFrom);
      }
      if (el.storeTo && Number(el.storeTo) > 0) {
        fields.storeTo = Number(el.storeTo);
      } else if (!el.storeFrom) {
        fields.storeTo = 1;
      }
      return {
        method: 'catalog.document.element.add',
        params: { fields },
      };
    });

    const batchResults = await this.client.batch(calls);
    let added = 0;
    let failed = 0;
    batchResults.forEach(r => {
      if (r && r.success) added++;
      else failed++;
    });

    debugLog.info('BITRIX', `Batch added ${added} elements to inventory documents (${failed} failed)`);
    return { added, failed, results: batchResults };
  }

  async deleteDocument(docId: number): Promise<boolean> {
    try {
      await this.client.callMethod('catalog.document.delete', { id: Number(docId) });
      return true;
    } catch (err: any) {
      logger.warn({ err: err?.message, docId }, 'Failed to delete draft inventory document');
      return false;
    }
  }

  async addDocumentElement(
    docId: number,
    productId: number,
    amount: number,
    purchasingPrice?: number,
    storeTo?: number,
    storeFrom?: number
  ): Promise<boolean> {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      logger.debug({ docId, productId, amount }, 'Skipping document element with non-positive amount');
      return false;
    }
    try {
      const fields: any = {
        docId: Number(docId),
        ownerId: Number(docId),
        elementId: Number(productId),
        productId: Number(productId),
        amount: numAmount,
      };

      if (purchasingPrice !== undefined && purchasingPrice !== null && !isNaN(Number(purchasingPrice))) {
        fields.purchasingPrice = Number(purchasingPrice);
      }

      if (storeFrom !== undefined && storeFrom !== null && Number(storeFrom) > 0) {
        fields.storeFrom = Number(storeFrom);
      } else {
        let targetStore = (storeTo !== undefined && storeTo !== null && Number(storeTo) > 0) ? Number(storeTo) : 0;
        if (targetStore <= 0) {
          try {
            const stores = await this.getStores();
            const main = stores.find(s => s.title.toLowerCase().includes('main') || s.id === 62) || stores[0];
            targetStore = main ? main.id : 1;
          } catch {
            targetStore = 1;
          }
        }
        fields.storeTo = targetStore;
      }

      await this.client.callMethod('catalog.document.element.add', { fields });
      return true;
    } catch (error: any) {
      logger.error({ err: error, docId, productId }, 'Failed to add element to inventory document');
      debugLog.warn('BITRIX', `Failed to add product ${productId} to inventory document ${docId}: ${error.message}`);
      throw error;
    }
  }

  async conductDocument(docId: number): Promise<{ success: boolean; error?: string }> {
    try {
      debugLog.info('BITRIX', `Conducting inventory stock receipt document ID: ${docId}`);
      await this.client.callMethod('catalog.document.conduct', { id: Number(docId) });
      debugLog.info('BITRIX', `Stock receipt document ID ${docId} successfully conducted`);
      return { success: true };
    } catch (error: any) {
      const msg = error.message || 'Unknown error while conducting document';
      // Self-heal: if Bitrix reports line items with incorrect product quantity (e.g. 0 or empty)
      if (msg.includes('incorrect product quantity ID #')) {
        try {
          const badIds = [...msg.matchAll(/#(\d+)/g)].map(m => Number(m[1]));
          logger.warn({ docId, badIds }, 'Detected invalid zero-quantity elements during conduct; cleaning them up');
          for (const pid of badIds) {
            const listRes = await this.client.callMethod('catalog.document.element.list', {
              filter: { docId: Number(docId), elementId: pid },
            });
            for (const elem of (listRes?.documentElements || [])) {
              await this.client.callMethod('catalog.document.element.delete', { id: Number(elem.id) });
            }
          }
          // Retry conducting after cleaning up bad elements
          await this.client.callMethod('catalog.document.conduct', { id: Number(docId) });
          debugLog.info('BITRIX', `Stock receipt document ID ${docId} conducted successfully after cleaning bad elements`);
          return { success: true };
        } catch (retryErr: any) {
          logger.warn({ err: retryErr, docId }, 'Cleanup and reconduct failed');
        }
      }

      logger.warn({ err: error, docId }, 'Failed to conduct stock receipt document');
      debugLog.warn('BITRIX', `Failed to conduct document ${docId}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  async syncDirectStoreStock(productId: number, storeId: number, amount: number): Promise<boolean> {
    try {
      let targetStoreId = (storeId !== undefined && storeId !== null && Number(storeId) > 0) ? Number(storeId) : 1;
      const listRes = await this.client.callMethod('catalog.storeproduct.list', {
        filter: { productId: Number(productId), storeId: Number(targetStoreId) },
      });
      const items = (listRes && (listRes.storeProducts || listRes.result || listRes)) || [];
      const existing = Array.isArray(items) ? items[0] : null;

      if (existing && (existing.id || existing.ID)) {
        const id = existing.id || existing.ID;
        await this.client.callMethod('catalog.storeproduct.update', {
          id: Number(id),
          fields: { amount: Number(amount) },
        });
      }
      return true;
    } catch (err: any) {
      // In Bitrix24 with inventory control enabled, stock balances are officially updated
      // via catalog.document.conduct, direct storeproduct updates may be restricted.
      logger.debug({ err, productId, storeId }, 'Direct store stock update skipped or unsupported');
      return false;
    }
  }
}
