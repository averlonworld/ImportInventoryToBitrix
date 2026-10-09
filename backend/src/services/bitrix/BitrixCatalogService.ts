import { BitrixClient } from './BitrixClient';
import { logger } from '../../utils/logger';

export interface BitrixCatalog {
  id: number;
  name: string;
  iblockTypeId: string;
  productIblockId: number | null;
}

export interface BitrixField {
  id: string;
  name: string;
  type: string;
  isRequired: boolean;
}

export interface CatalogContext {
  catalogId: number;
  catalogName: string;
  basePriceTypeId: number;
  dealerPriceTypeId?: number;
  endUserPriceTypeId?: number;
  currency: string;
  barcodePropertyId?: number;
  partNumberPropertyId?: number;
  qtyOnOrderPropertyId?: number;
  partNumberPropertyIds: number[];
  itemCodePropertyIds: number[];
  stockQtyPropertyIds: number[];
  costPropertyIds: number[];
  qtyOnOrderPropertyIds: number[];
  dealerPricePropertyIds: number[];
  endUserPricePropertyIds: number[];
}

export interface InventoryProductInput {
  code: string;           // CODE (Unique product identifier)
  partNumber: string;     // PART NUMBER (Product Title / Name)
  description: string;    // DESCRIPTION (Product Description - Mandatory)
  cost?: number;          // COST (Purchasing price)
  dealerPrice?: number;   // DEALER PRICE (Dealer price type)
  endUserPrice?: number;  // END USER PRICE (End user price type / Base)
  qtyOnOrder?: number;    // QTY ON ORDER (Quantity on order property)
  qtyInStock?: number;    // QTY IN STOCK (Stock quantity property & inventory)
  barcode?: string;
}

// Map<webhookBaseUrl, Promise<context>> — resolve catalog/price-type/currency once per portal
const contextCache = new Map<string, Promise<CatalogContext>>();

export class BitrixCatalogService {
  private client: BitrixClient;

  constructor(client: BitrixClient) {
    this.client = client;
  }

  async getCatalogs(): Promise<BitrixCatalog[]> {
    try {
      const result = await this.client.callMethod('catalog.catalog.list', {});
      const catalogs = (result && result.catalogs) || [];
      return catalogs.map((c: any) => ({
        id: c.id,
        name: c.name,
        iblockTypeId: c.iblockTypeId,
        productIblockId: c.productIblockId != null ? c.productIblockId : null,
      }));
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch Bitrix catalogs');
      throw error;
    }
  }

  async getDefaultCatalogId(): Promise<number> {
    const ctx = await this.getCatalogContext();
    return ctx.catalogId;
  }

  async getCatalogContext(): Promise<CatalogContext> {
    return resolveCatalogContext(this.client);
  }

  async getProductFields(): Promise<BitrixField[]> {
    try {
      const result = await this.client.callMethod('catalog.product.getFields', {});
      const src = (result && (result.product || result)) || {};
      const entries = Object.entries(src);
      if (entries.length > 0) {
        return entries.map(([id, f]: [string, any]) => ({
          id,
          name: f.name || id,
          type: f.type || 'string',
          isRequired: !!f.isRequired,
        }));
      }
    } catch (error) {
      logger.warn({ err: error }, 'catalog.product.getFields unavailable, using default field schema');
    }
    return this.defaultProductFields();
  }

  private defaultProductFields(): BitrixField[] {
    return [
      { id: 'id', name: 'ID', type: 'integer', isRequired: false },
      { id: 'iblockId', name: 'Catalog (IBLOCK_ID)', type: 'integer', isRequired: true },
      { id: 'name', name: 'Name', type: 'string', isRequired: true },
      { id: 'code', name: 'SKU / Code', type: 'string', isRequired: false },
      { id: 'xmlId', name: 'External ID (XML_ID)', type: 'string', isRequired: false },
      { id: 'active', name: 'Active', type: 'string', isRequired: false },
      { id: 'quantity', name: 'Stock quantity', type: 'double', isRequired: false },
      { id: 'price', name: 'Base price', type: 'double', isRequired: false },
      { id: 'barcode', name: 'Barcode (GTIN)', type: 'string', isRequired: false },
    ];
  }

  async getInventoryFields(): Promise<BitrixField[]> {
    try {
      const result = await this.client.callMethod('catalog.storeproduct.getFields', {});
      const src = (result && (result.storeProduct || result)) || {};
      return Object.entries(src).map(([id, f]: [string, any]) => ({
        id,
        name: f.name || id,
        type: f.type || 'string',
        isRequired: !!f.isRequired,
      }));
    } catch (error) {
      logger.warn({ err: error }, 'Failed to fetch inventory fields');
      return [];
    }
  }

  async getStores(): Promise<any[]> {
    try {
      const result = await this.client.callMethod('catalog.store.list', {});
      const stores = (result && result.stores) || [];
      return stores.map((s: any) => ({
        id: s.id,
        title: s.title,
        active: s.active,
        code: s.code,
      }));
    } catch (error) {
      logger.warn({ err: error }, 'Failed to fetch Bitrix stores');
      return [];
    }
  }
}

async function resolveCatalogContext(client: BitrixClient): Promise<CatalogContext> {
  const key = ((client as any).instance?.defaults?.baseURL) || 'default';

  if (contextCache.has(key)) {
    return contextCache.get(key)!;
  }

  const loader = (async () => {
    try {
      const catalogsRes = await client.callMethod('catalog.catalog.list', {});
      const catalogs = (catalogsRes && catalogsRes.catalogs) || [];
      const mainCatalog =
        catalogs.find((c: any) => c.productIblockId == null) || catalogs[0];

      if (!mainCatalog) {
        throw new Error('No commercial catalog found in this Bitrix24 portal');
      }

      const priceTypesRes = await client.callMethod('catalog.priceType.list', {});
      const priceTypes = (priceTypesRes && priceTypesRes.priceTypes) || [];
      const baseType = priceTypes.find((t: any) => t.base === 'Y') || priceTypes[0];

      if (!baseType) {
        throw new Error('No price type found in this Bitrix24 portal');
      }

      let currency = 'INR';
      try {
        const currenciesRes = await client.callMethod('crm.currency.list', {});
        const currencies = Array.isArray(currenciesRes) ? currenciesRes : (currenciesRes && currenciesRes.result) || [];
        const baseCurrency = currencies.find((c: any) => c.BASE === 'Y') || currencies[0];
        if (baseCurrency && baseCurrency.CURRENCY) {
          currency = baseCurrency.CURRENCY;
        }
      } catch {
        logger.warn('crm.currency.list unavailable, defaulting currency to INR');
      }

      // Discover or ensure price types for Dealer Price and End User Price
      let dealerPriceTypeId: number | undefined;
      let endUserPriceTypeId: number | undefined;
      try {
        const dealerType = priceTypes.find((t: any) =>
          (t.xmlId && t.xmlId.toUpperCase() === 'DEALER_PRICE') ||
          (t.name && t.name.toLowerCase().includes('dealer'))
        );
        if (dealerType) {
          dealerPriceTypeId = Number(dealerType.id);
        } else {
          try {
            const addDealer = await client.callMethod('catalog.priceType.add', {
              fields: { name: 'Dealer Price', xmlId: 'DEALER_PRICE' }
            });
            dealerPriceTypeId = Number(addDealer?.priceType?.id || addDealer?.id);
          } catch (err) {
            logger.warn({ err }, 'Failed to create Dealer Price price type');
          }
        }

        const endUserType = priceTypes.find((t: any) =>
          (t.xmlId && t.xmlId.toUpperCase() === 'END_USER_PRICE') ||
          (t.name && (t.name.toLowerCase().includes('end user') || t.name.toLowerCase().includes('retail')))
        );
        if (endUserType) {
          endUserPriceTypeId = Number(endUserType.id);
        } else {
          try {
            const addEndUser = await client.callMethod('catalog.priceType.add', {
              fields: { name: 'End User Price', xmlId: 'END_USER_PRICE' }
            });
            endUserPriceTypeId = Number(addEndUser?.priceType?.id || addEndUser?.id);
          } catch (err) {
            logger.warn({ err }, 'Failed to create End User Price price type');
          }
        }
      } catch (ptErr) {
        logger.warn({ err: ptErr }, 'Failed to resolve price types');
      }

      // Discover or ensure barcode, Part Number, and Qty on Order properties on catalog iblock
      let barcodePropertyId: number | undefined;
      let partNumberPropertyId: number | undefined;
      let qtyOnOrderPropertyId: number | undefined;
      const partNumberPropertyIds: number[] = [];
      const itemCodePropertyIds: number[] = [];
      const stockQtyPropertyIds: number[] = [];
      const costPropertyIds: number[] = [];
      const qtyOnOrderPropertyIds: number[] = [];
      const dealerPricePropertyIds: number[] = [];
      const endUserPricePropertyIds: number[] = [];

      try {
        const props = await client.callMethod('crm.product.property.list', {});
        const propList = Array.isArray(props) ? props : (props && props.result) || [];

        // Scan all properties on catalog to map existing portal fields
        propList.forEach((p: any) => {
          const sameIblock = !p.IBLOCK_ID || String(p.IBLOCK_ID) === String(mainCatalog.id);
          if (!sameIblock) return;
          const codeUpper = (p.CODE || '').toUpperCase();
          const nameLower = (p.NAME || '').toLowerCase().trim();
          const id = Number(p.ID);

          // Part number properties (e.g. 2622, 1020 "Part Number123456789")
          if (codeUpper.includes('PART_NUMBER') || nameLower.includes('part number') || nameLower.includes('part_number') || nameLower.includes('partno')) {
            if (!partNumberPropertyIds.includes(id)) partNumberPropertyIds.push(id);
          }

          // Item code properties (e.g. 960 "item code ")
          if (codeUpper.includes('ITEM_CODE') || nameLower.includes('item code') || nameLower.includes('item_code') || nameLower.includes('itemcode')) {
            if (!itemCodePropertyIds.includes(id)) itemCodePropertyIds.push(id);
          }

          // Stock quantity properties (e.g. 115 "Stock Quantity", "Available stock")
          if (nameLower.includes('stock quantity') || nameLower.includes('available stock') || codeUpper.includes('STOCK_QUANTITY') || codeUpper.includes('AVAILABLE_STOCK')) {
            if (!stockQtyPropertyIds.includes(id)) stockQtyPropertyIds.push(id);
          }

          // Cost properties (e.g. 111 "Cost", "Cost Per Item")
          if (nameLower.includes('cost per item') || codeUpper.includes('COST_PER_ITEM') || nameLower === 'cost' || codeUpper === 'COST_PROP') {
            if (!costPropertyIds.includes(id)) costPropertyIds.push(id);
          }

          // Dealer price properties (e.g. 2626 "Dealer Price")
          if (nameLower.includes('dealer price') || codeUpper.includes('DEALER_PRICE')) {
            if (!dealerPricePropertyIds.includes(id)) dealerPricePropertyIds.push(id);
          }

          // End user price properties (e.g. 109 "End User Price")
          if (nameLower.includes('end user price') || codeUpper.includes('END_USER_PRICE')) {
            if (!endUserPricePropertyIds.includes(id)) endUserPricePropertyIds.push(id);
          }

          // Qty on order properties (e.g. 2624)
          if (codeUpper.includes('QTY_ON_ORDER') || nameLower.includes('qty on order') || nameLower.includes('quantity on order') || nameLower.includes('on order')) {
            if (!qtyOnOrderPropertyIds.includes(id)) qtyOnOrderPropertyIds.push(id);
          }
        });

        // 1. Barcode property
        const foundBarcode = propList.find((p: any) => {
          const sameIblock = !p.IBLOCK_ID || String(p.IBLOCK_ID) === String(mainCatalog.id);
          const codeUpper = (p.CODE || '').toUpperCase();
          const nameLower = (p.NAME || '').toLowerCase();
          const isBarcodeCode = codeUpper === 'BARCODE' || codeUpper === 'BAR_CODE' || codeUpper === 'UF_BARCODE';
          const isBarcodeName = nameLower === 'barcode' || nameLower === 'bar code' || nameLower.includes('barcode') || nameLower.includes('штрихкод');
          return sameIblock && (isBarcodeCode || isBarcodeName);
        });

        if (foundBarcode) {
          barcodePropertyId = Number(foundBarcode.ID);
          logger.info({ barcodePropertyId, name: foundBarcode.NAME, code: foundBarcode.CODE }, 'Discovered existing Bitrix barcode property');
        } else {
          try {
            const addRes = await client.callMethod('crm.product.property.add', {
              fields: {
                NAME: 'Barcode',
                CODE: 'BARCODE',
                ACTIVE: 'Y',
                SORT: 100,
                PROPERTY_TYPE: 'S',
                IBLOCK_ID: mainCatalog.id,
              },
            });
            const newId = typeof addRes === 'number' ? addRes : addRes?.id || addRes?.ID || addRes?.result;
            if (newId) {
              barcodePropertyId = Number(newId);
              logger.info({ barcodePropertyId }, 'Created new Bitrix barcode property');
            }
          } catch (createErr: any) {
            const byCode = propList.find((p: any) => (p.CODE || '').toUpperCase() === 'BARCODE');
            if (byCode) {
              barcodePropertyId = Number(byCode.ID);
              logger.info({ barcodePropertyId }, 'Resolved Bitrix barcode property by code fallback');
            }
          }
        }

        // 2. Primary Part Number property
        if (partNumberPropertyIds.length > 0) {
          partNumberPropertyId = partNumberPropertyIds[0];
        } else {
          try {
            const addProp = await client.callMethod('crm.product.property.add', {
              fields: {
                NAME: 'Part Number',
                CODE: 'PART_NUMBER',
                ACTIVE: 'Y',
                SORT: 100,
                PROPERTY_TYPE: 'S',
                IBLOCK_ID: mainCatalog.id,
              },
            });
            const newId = typeof addProp === 'number' ? addProp : addProp?.id || addProp?.ID || addProp?.result;
            if (newId) {
              partNumberPropertyId = Number(newId);
              partNumberPropertyIds.push(partNumberPropertyId);
            }
          } catch {
            // fallback
          }
        }

        // 3. Primary Qty on Order property
        if (qtyOnOrderPropertyIds.length > 0) {
          qtyOnOrderPropertyId = qtyOnOrderPropertyIds[0];
        } else {
          try {
            const addProp = await client.callMethod('crm.product.property.add', {
              fields: {
                NAME: 'Qty on Order',
                CODE: 'QTY_ON_ORDER',
                ACTIVE: 'Y',
                SORT: 110,
                PROPERTY_TYPE: 'N',
                IBLOCK_ID: mainCatalog.id,
              },
            });
            const newId = typeof addProp === 'number' ? addProp : addProp?.id || addProp?.ID || addProp?.result;
            if (newId) {
              qtyOnOrderPropertyId = Number(newId);
              qtyOnOrderPropertyIds.push(qtyOnOrderPropertyId);
            }
          } catch {
            // fallback
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to resolve/create catalog properties');
      }

      return {
        catalogId: mainCatalog.id,
        catalogName: mainCatalog.name,
        basePriceTypeId: baseType.id,
        dealerPriceTypeId,
        endUserPriceTypeId,
        currency,
        barcodePropertyId,
        partNumberPropertyId,
        qtyOnOrderPropertyId,
        partNumberPropertyIds,
        itemCodePropertyIds,
        stockQtyPropertyIds,
        costPropertyIds,
        qtyOnOrderPropertyIds,
        dealerPricePropertyIds,
        endUserPricePropertyIds,
      };
    } catch (error) {
      contextCache.delete(key);
      throw error;
    }
  })();

  contextCache.set(key, loader);
  return loader;
}

export class BitrixProductService {
  private client: BitrixClient;
  private context: CatalogContext;

  constructor(client: BitrixClient, context: CatalogContext) {
    this.client = client;
    this.context = context;
  }

  async findProductBySku(sku: string): Promise<any | null> {
    try {
      const barcodeProp = this.context.barcodePropertyId ? `property${this.context.barcodePropertyId}` : undefined;
      const select = ['id', 'iblockId', 'name', 'code', 'quantity'];
      if (barcodeProp) select.push(barcodeProp);

      const result = await this.client.callMethod('catalog.product.list', {
        select,
        filter: { iblockId: this.context.catalogId, code: sku },
      });
      const products = (result && result.products) || [];
      if (!products[0]) return null;
      const p = products[0];
      let barcode = p.barcode;
      if (!barcode && barcodeProp && p[barcodeProp]) {
        barcode = typeof p[barcodeProp] === 'object' ? p[barcodeProp].value : p[barcodeProp];
      }
      if (!barcode && this.context.barcodePropertyId) {
        const rawProp = p[`property${this.context.barcodePropertyId}`] || p[`PROPERTY_${this.context.barcodePropertyId}`];
        if (rawProp) {
          barcode = typeof rawProp === 'object' ? rawProp.value : rawProp;
        }
      }
      return { ...p, barcode };
    } catch (error) {
      logger.warn({ err: error }, `Failed to search product by SKU ${sku}`);
      return null;
    }
  }

  async findProductByName(name: string): Promise<any | null> {
    try {
      const barcodeProp = this.context.barcodePropertyId ? `property${this.context.barcodePropertyId}` : undefined;
      const select = ['id', 'iblockId', 'name', 'code', 'quantity'];
      if (barcodeProp) select.push(barcodeProp);

      const result = await this.client.callMethod('catalog.product.list', {
        select,
        filter: { iblockId: this.context.catalogId, name: name },
      });
      const products = (result && result.products) || [];
      if (!products[0]) return null;
      const p = products[0];
      let barcode = p.barcode;
      if (!barcode && barcodeProp && p[barcodeProp]) {
        barcode = typeof p[barcodeProp] === 'object' ? p[barcodeProp].value : p[barcodeProp];
      }
      if (!barcode && this.context.barcodePropertyId) {
        const rawProp = p[`property${this.context.barcodePropertyId}`] || p[`PROPERTY_${this.context.barcodePropertyId}`];
        if (rawProp) {
          barcode = typeof rawProp === 'object' ? rawProp.value : rawProp;
        }
      }
      return { ...p, barcode };
    } catch (error) {
      return null;
    }
  }

  async findProductByBarcode(barcode: string): Promise<any | null> {
    try {
      const normalized = String(barcode || '').trim();
      if (!normalized) return null;

      const barcodeProp = this.context.barcodePropertyId ? `property${this.context.barcodePropertyId}` : undefined;
      const select = ['id', 'iblockId', 'name', 'code', 'quantity'];
      if (barcodeProp) select.push(barcodeProp);

      if (barcodeProp) {
        try {
          const result = await this.client.callMethod('catalog.product.list', {
            select,
            filter: { iblockId: this.context.catalogId, [barcodeProp]: normalized },
          });
          const products = (result && result.products) || [];
          if (products[0]) {
            const p = products[0];
            return { ...p, barcode: normalized };
          }
        } catch {
          // fall through to crm search
        }
      }

      if (this.context.barcodePropertyId) {
        try {
          const crmRes = await this.client.callMethod('crm.product.list', {
            filter: { [`PROPERTY_${this.context.barcodePropertyId}`]: normalized },
            select: ['ID', 'NAME', 'CODE', 'PRICE'],
          });
          const crmList = Array.isArray(crmRes) ? crmRes : (crmRes && crmRes.result) || [];
          if (crmList[0]) {
            const p = crmList[0];
            return {
              id: Number(p.ID),
              name: p.NAME,
              code: p.CODE,
              barcode: normalized,
            };
          }
        } catch {
          // non-blocking
        }
      }

      return null;
    } catch (error) {
      logger.warn({ err: error }, `Failed to search product by barcode ${barcode}`);
      return null;
    }
  }

  async createProduct(name: string, code: string, barcode?: string): Promise<number> {
    const fields: any = {
      iblockId: this.context.catalogId,
      name,
      code,
      active: 'Y',
      barcodeMulti: 'N',
    };
    if (barcode && this.context.barcodePropertyId) {
      fields[`property${this.context.barcodePropertyId}`] = { value: barcode };
    }

    const result = await this.client.callMethod('catalog.product.add', { fields });
    const element = result && (result.element || result.product);
    if (!element || !element.id) {
      throw new Error('Bitrix did not return a product ID after creation');
    }

    if (barcode && this.context.barcodePropertyId) {
      try {
        await this.client.callMethod('crm.product.update', {
          id: element.id,
          fields: {
            [`PROPERTY_${this.context.barcodePropertyId}`]: { value: barcode },
          },
        });
      } catch (err: any) {
        logger.warn({ err: err?.message, id: element.id }, 'crm.product.update for barcode failed');
      }
    }

    return element.id;
  }

  async updateProduct(id: number, fields: any): Promise<boolean> {
    try {
      const payload: any = { ...fields };
      const barcode = payload.barcode;
      delete payload.barcode;

      if (barcode && this.context.barcodePropertyId) {
        payload[`property${this.context.barcodePropertyId}`] = { value: barcode };
      }

      let catalogUpdated = true;
      if (Object.keys(payload).length > 0) {
        const result = await this.client.callMethod('catalog.product.update', { id, fields: payload });
        catalogUpdated = !!(result && (result.element || result.product));
      }

      if (barcode && this.context.barcodePropertyId) {
        try {
          await this.client.callMethod('crm.product.update', {
            id,
            fields: {
              [`PROPERTY_${this.context.barcodePropertyId}`]: { value: barcode },
            },
          });
        } catch (err: any) {
          logger.warn({ err: err?.message, id }, 'crm.product.update for barcode failed');
        }
      }
      return catalogUpdated;
    } catch (error) {
      logger.error({ err: error }, `Failed to update product ${id}`);
      return false;
    }
  }

  async setPrice(productId: number, price: number): Promise<boolean> {
    try {
      if (!price || price <= 0) return true;

      const list = await this.client.callMethod('catalog.price.list', {
        filter: { productId },
      });
      const prices = (list && list.prices) || [];

      if (prices.length > 0) {
        await this.client.callMethod('catalog.price.update', {
          id: prices[0].id,
          fields: { price, currency: this.context.currency },
        });
      } else {
        await this.client.callMethod('catalog.price.add', {
          fields: {
            productId,
            catalogGroupId: this.context.basePriceTypeId,
            price,
            currency: this.context.currency,
          },
        });
      }
      return true;
    } catch (error) {
      logger.error({ err: error }, `Failed to set price for product ${productId}`);
      return false;
    }
  }

  async setQuantity(productId: number, quantity: number): Promise<{ supported: boolean; firstProbe: boolean }> {
    const state = quantitySupport.get(this.context.catalogId) ?? 'unknown';

    if (state === false) {
      return { supported: false, firstProbe: false };
    }

    const firstProbe = state === 'unknown';

    try {
      // Also update custom property if configured so grid columns reflect stock quantity
      if (this.context.stockQtyPropertyIds && this.context.stockQtyPropertyIds.length > 0) {
        const crmF: any = {};
        const catF: any = {};
        this.context.stockQtyPropertyIds.forEach(propId => {
          crmF[`PROPERTY_${propId}`] = { value: String(quantity) };
          catF[`property${propId}`] = { value: String(quantity) };
        });
        await this.client.callMethod('catalog.product.update', { id: productId, fields: catF }).catch(() => {});
        await this.client.callMethod('crm.product.update', { id: productId, fields: crmF }).catch(() => {});
      }

      await this.client.callMethod('catalog.product.update', {
        id: productId,
        fields: { quantity },
      });

      // Verify the portal actually persisted the quantity (many plans ignore stock via REST)
      const check = await this.client.callMethod('catalog.product.get', { id: productId });
      const stored = check && (check.product || {}).quantity;
      if (stored == null || Number(stored) !== Number(quantity)) {
        quantitySupport.set(this.context.catalogId, false);
        return { supported: false, firstProbe };
      }

      quantitySupport.set(this.context.catalogId, true);
      return { supported: true, firstProbe };
    } catch (error) {
      logger.warn({ err: error }, `Quantity update not supported for product ${productId}`);
      quantitySupport.set(this.context.catalogId, false);
      return { supported: false, firstProbe };
    }
  }

  async setReservedQuantity(productId: number, quantityReserved: number): Promise<boolean> {
    try {
      if (quantityReserved === undefined || quantityReserved === null || isNaN(Number(quantityReserved))) {
        return false;
      }
      await this.client.callMethod('catalog.product.update', {
        id: productId,
        fields: { quantityReserved: Number(quantityReserved) },
      });
      return true;
    } catch (error) {
      logger.warn({ err: error, productId, quantityReserved }, `Failed to update quantityReserved on product ${productId}`);
      return false;
    }
  }

  async findProductByCode(code: string): Promise<any | null> {
    try {
      const normalized = String(code || '').trim();
      if (!normalized) return null;

      // 1. Search in catalog.product.list by code
      try {
        const result = await this.client.callMethod('catalog.product.list', {
          select: ['id', 'iblockId', 'name', 'code', 'quantity', 'purchasingPrice'],
          filter: { iblockId: this.context.catalogId, code: normalized },
        });
        const products = (result && result.products) || [];
        if (products[0]) {
          return products[0];
        }
      } catch {
        // Fall back to CRM search
      }

      // 2. Search in crm.product.list by CODE
      const crmRes = await this.client.callMethod('crm.product.list', {
        filter: { CODE: normalized },
        select: ['ID', 'NAME', 'CODE', 'PRICE', 'DESCRIPTION'],
      });
      const crmList = Array.isArray(crmRes) ? crmRes : (crmRes && crmRes.result) || [];
      if (crmList[0]) {
        return {
          id: Number(crmList[0].ID),
          name: crmList[0].NAME,
          code: crmList[0].CODE,
          description: crmList[0].DESCRIPTION,
          price: crmList[0].PRICE,
        };
      }

      return null;
    } catch (error) {
      logger.warn({ err: error }, `Failed to search product by code ${code}`);
      return null;
    }
  }

  async setPriceForType(productId: number, priceTypeId: number, price: number): Promise<boolean> {
    try {
      if (price === undefined || price === null || isNaN(Number(price))) return true;

      const list = await this.client.callMethod('catalog.price.list', {
        filter: { productId, catalogGroupId: priceTypeId },
      });
      const prices = (list && list.prices) || [];

      if (prices.length > 0) {
        await this.client.callMethod('catalog.price.update', {
          id: prices[0].id,
          fields: { price: Number(price), currency: this.context.currency },
        });
      } else {
        await this.client.callMethod('catalog.price.add', {
          fields: {
            productId,
            catalogGroupId: priceTypeId,
            price: Number(price),
            currency: this.context.currency,
          },
        });
      }
      return true;
    } catch (error) {
      logger.warn({ err: error, productId, priceTypeId, price }, 'Failed to set price for price type');
      return false;
    }
  }

  async syncProductPrices(productId: number, data: { basePrice?: number; dealerPrice?: number; endUserPrice?: number; cost?: number }): Promise<void> {
    // 1. Purchasing Price / Cost on product
    if (data.cost !== undefined && data.cost !== null && !isNaN(Number(data.cost)) && Number(data.cost) >= 0) {
      try {
        await this.client.callMethod('catalog.product.update', {
          id: productId,
          fields: {
            purchasingPrice: Number(data.cost),
            purchasingCurrency: this.context.currency,
          },
        });
      } catch (err: any) {
        logger.warn({ err: err?.message, productId }, 'Failed to update purchasing price');
      }
    }

    // 2. Base Price
    const basePrice = data.endUserPrice ?? data.basePrice ?? data.dealerPrice;
    if (basePrice !== undefined && basePrice !== null && !isNaN(Number(basePrice))) {
      await this.setPriceForType(productId, this.context.basePriceTypeId, Number(basePrice));
    }

    // 3. Dealer Price
    if (this.context.dealerPriceTypeId && data.dealerPrice !== undefined && data.dealerPrice !== null && !isNaN(Number(data.dealerPrice))) {
      await this.setPriceForType(productId, this.context.dealerPriceTypeId, Number(data.dealerPrice));
    }

    // 4. End User Price
    if (this.context.endUserPriceTypeId && data.endUserPrice !== undefined && data.endUserPrice !== null && !isNaN(Number(data.endUserPrice))) {
      await this.setPriceForType(productId, this.context.endUserPriceTypeId, Number(data.endUserPrice));
    }
  }

  async createInventoryProduct(input: InventoryProductInput): Promise<number> {
    const partNum = (input.partNumber || '').trim();
    const codeVal = input.code.trim();
    const descVal = (input.description || '').trim();

    // Requirement 12: Product Title / Product Name in the Bitrix24 Product Catalog must be the PART NUMBER
    const displayName = partNum || codeVal;
    const partNumVal = partNum || codeVal;

    // 1. Primary creation via modern Bitrix24 Commercial Catalog API (catalog.product.add)
    // This creates the product directly in the trade catalog (iblockId: 24) so it immediately appears in the Product Catalog
    const catAddFields: any = {
      iblockId: this.context.catalogId,
      name: displayName,
      code: codeVal,
      active: 'Y',
      barcodeMulti: 'N',
    };
    if (descVal) {
      catAddFields.previewText = descVal;
      catAddFields.detailText = descVal;
      catAddFields.previewTextType = 'text';
      catAddFields.detailTextType = 'text';
    }

    // Populate all discovered matching properties on catalog
    this.context.partNumberPropertyIds?.forEach(propId => {
      catAddFields[`property${propId}`] = { value: partNumVal };
    });
    this.context.itemCodePropertyIds?.forEach(propId => {
      catAddFields[`property${propId}`] = { value: codeVal };
    });
    if (input.qtyInStock !== undefined && input.qtyInStock !== null && !isNaN(Number(input.qtyInStock))) {
      catAddFields.quantity = Number(input.qtyInStock);
      this.context.stockQtyPropertyIds?.forEach(propId => {
        catAddFields[`property${propId}`] = { value: String(input.qtyInStock) };
      });
    }
    if (input.cost !== undefined && input.cost !== null && !isNaN(Number(input.cost))) {
      catAddFields.purchasingPrice = Number(input.cost);
      catAddFields.purchasingCurrency = this.context.currency;
      this.context.costPropertyIds?.forEach(propId => {
        catAddFields[`property${propId}`] = { value: String(input.cost) };
      });
    }
    if (input.qtyOnOrder !== undefined && input.qtyOnOrder !== null && !isNaN(Number(input.qtyOnOrder))) {
      this.context.qtyOnOrderPropertyIds?.forEach(propId => {
        catAddFields[`property${propId}`] = { value: Number(input.qtyOnOrder) };
      });
    }
    if (input.dealerPrice !== undefined && input.dealerPrice !== null && !isNaN(Number(input.dealerPrice))) {
      this.context.dealerPricePropertyIds?.forEach(propId => {
        catAddFields[`property${propId}`] = { value: String(input.dealerPrice) };
      });
    }
    if (input.endUserPrice !== undefined && input.endUserPrice !== null && !isNaN(Number(input.endUserPrice))) {
      this.context.endUserPricePropertyIds?.forEach(propId => {
        catAddFields[`property${propId}`] = { value: String(input.endUserPrice) };
      });
    }
    if (this.context.barcodePropertyId && input.barcode) {
      catAddFields[`property${this.context.barcodePropertyId}`] = { value: input.barcode.trim() };
    }

    let productId: number | undefined;
    try {
      const catRes = await this.client.callMethod('catalog.product.add', { fields: catAddFields });
      const elem = catRes && (catRes.element || catRes.product);
      if (elem && elem.id) {
        productId = Number(elem.id);
      }
    } catch (catErr: any) {
      logger.warn({ err: catErr?.message, code: input.code }, 'catalog.product.add failed, attempting fallback to crm.product.add');
    }

    // 2. Fallback to crm.product.add if catalog.product.add did not succeed
    if (!productId) {
      const crmFields: any = {
        NAME: displayName,
        CODE: codeVal,
        DESCRIPTION: descVal,
        CURRENCY_ID: this.context.currency,
        PRICE: input.endUserPrice ?? input.dealerPrice ?? 0,
        ACTIVE: 'Y',
        CATALOG_ID: this.context.catalogId,
      };

      this.context.partNumberPropertyIds?.forEach(propId => {
        crmFields[`PROPERTY_${propId}`] = { value: partNumVal };
      });
      this.context.itemCodePropertyIds?.forEach(propId => {
        crmFields[`PROPERTY_${propId}`] = { value: codeVal };
      });
      if (input.qtyInStock !== undefined && input.qtyInStock !== null && !isNaN(Number(input.qtyInStock))) {
        this.context.stockQtyPropertyIds?.forEach(propId => {
          crmFields[`PROPERTY_${propId}`] = { value: String(input.qtyInStock) };
        });
      }
      if (input.cost !== undefined && input.cost !== null && !isNaN(Number(input.cost))) {
        this.context.costPropertyIds?.forEach(propId => {
          crmFields[`PROPERTY_${propId}`] = { value: String(input.cost) };
        });
      }
      if (input.qtyOnOrder !== undefined && input.qtyOnOrder !== null && !isNaN(Number(input.qtyOnOrder))) {
        this.context.qtyOnOrderPropertyIds?.forEach(propId => {
          crmFields[`PROPERTY_${propId}`] = { value: Number(input.qtyOnOrder) };
        });
      }
      if (input.dealerPrice !== undefined && input.dealerPrice !== null && !isNaN(Number(input.dealerPrice))) {
        this.context.dealerPricePropertyIds?.forEach(propId => {
          crmFields[`PROPERTY_${propId}`] = { value: String(input.dealerPrice) };
        });
      }
      if (input.endUserPrice !== undefined && input.endUserPrice !== null && !isNaN(Number(input.endUserPrice))) {
        this.context.endUserPricePropertyIds?.forEach(propId => {
          crmFields[`PROPERTY_${propId}`] = { value: String(input.endUserPrice) };
        });
      }
      if (this.context.barcodePropertyId && input.barcode) {
        crmFields[`PROPERTY_${this.context.barcodePropertyId}`] = { value: input.barcode.trim() };
      }

      const crmRes = await this.client.callMethod('crm.product.add', { fields: crmFields });
      const rawId = typeof crmRes === 'number' ? crmRes : crmRes?.result || crmRes?.id || crmRes?.ID;
      if (rawId) {
        productId = Number(rawId);
      }
    }

    if (!productId) {
      throw new Error(`Bitrix failed to create catalog product for code ${input.code}`);
    }

    const numId = Number(productId);

    // 3. Ensure CRM fields and properties are synced
    try {
      const syncCrmFields: any = {
        NAME: displayName,
        CODE: codeVal,
        DESCRIPTION: descVal,
        CURRENCY_ID: this.context.currency,
        PRICE: input.endUserPrice ?? input.dealerPrice ?? 0,
        ACTIVE: 'Y',
      };
      this.context.partNumberPropertyIds?.forEach(propId => {
        syncCrmFields[`PROPERTY_${propId}`] = { value: partNumVal };
      });
      this.context.itemCodePropertyIds?.forEach(propId => {
        syncCrmFields[`PROPERTY_${propId}`] = { value: codeVal };
      });
      if (input.cost !== undefined && input.cost !== null && !isNaN(Number(input.cost))) {
        this.context.costPropertyIds?.forEach(propId => {
          syncCrmFields[`PROPERTY_${propId}`] = { value: String(input.cost) };
        });
      }
      if (input.qtyInStock !== undefined && input.qtyInStock !== null && !isNaN(Number(input.qtyInStock))) {
        this.context.stockQtyPropertyIds?.forEach(propId => {
          syncCrmFields[`PROPERTY_${propId}`] = { value: String(input.qtyInStock) };
        });
      }
      if (input.dealerPrice !== undefined && input.dealerPrice !== null && !isNaN(Number(input.dealerPrice))) {
        this.context.dealerPricePropertyIds?.forEach(propId => {
          syncCrmFields[`PROPERTY_${propId}`] = { value: String(input.dealerPrice) };
        });
      }
      if (input.endUserPrice !== undefined && input.endUserPrice !== null && !isNaN(Number(input.endUserPrice))) {
        this.context.endUserPricePropertyIds?.forEach(propId => {
          syncCrmFields[`PROPERTY_${propId}`] = { value: String(input.endUserPrice) };
        });
      }
      if (this.context.barcodePropertyId && input.barcode) {
        syncCrmFields[`PROPERTY_${this.context.barcodePropertyId}`] = { value: input.barcode.trim() };
      }
      await this.client.callMethod('crm.product.update', { id: numId, fields: syncCrmFields });
    } catch (crmErr: any) {
      logger.warn({ err: crmErr?.message, numId }, 'crm.product.update in createInventoryProduct non-fatal');
    }

    // 4. Sync all price types (Cost, Dealer, End User, Base)
    await this.syncProductPrices(numId, {
      cost: input.cost,
      dealerPrice: input.dealerPrice,
      endUserPrice: input.endUserPrice,
      basePrice: input.endUserPrice ?? input.dealerPrice,
    });

    // 5. Requirement 4: Update Reserved Quantity if QTY ON ORDER is provided
    if (input.qtyOnOrder !== undefined && input.qtyOnOrder !== null && !isNaN(Number(input.qtyOnOrder))) {
      await this.setReservedQuantity(numId, Number(input.qtyOnOrder));
    }

    return numId;
  }

  async updateInventoryProduct(productId: number, input: Partial<InventoryProductInput>): Promise<boolean> {
    const crmFields: any = { ACTIVE: 'Y' };
    const partNum = (input.partNumber || '').trim();
    const codeVal = (input.code || '').trim();
    const descVal = (input.description || '').trim();

    // Requirement 12: Product Title / Product Name in Bitrix24 Product Catalog must be the PART NUMBER
    const displayName = partNum || (input.code ? input.code.trim() : '');
    if (displayName) {
      crmFields.NAME = displayName;
    }

    if (input.partNumber) {
      const pVal = input.partNumber.trim();
      this.context.partNumberPropertyIds?.forEach(propId => {
        crmFields[`PROPERTY_${propId}`] = { value: pVal };
      });
    }
    if (input.code) {
      crmFields.CODE = input.code.trim();
      this.context.itemCodePropertyIds?.forEach(propId => {
        crmFields[`PROPERTY_${propId}`] = { value: input.code!.trim() };
      });
    }
    if (input.description) {
      crmFields.DESCRIPTION = input.description.trim();
    }
    // End User Price is native to product (PRICE) and BASE catalog price type - also written to custom property for grid view
    if (input.endUserPrice !== undefined || input.dealerPrice !== undefined) {
      crmFields.PRICE = input.endUserPrice ?? input.dealerPrice ?? 0;
    }
    if (input.cost !== undefined && input.cost !== null && !isNaN(Number(input.cost))) {
      this.context.costPropertyIds?.forEach(propId => {
        crmFields[`PROPERTY_${propId}`] = { value: String(input.cost) };
      });
    }
    if (input.qtyInStock !== undefined && input.qtyInStock !== null && !isNaN(Number(input.qtyInStock))) {
      this.context.stockQtyPropertyIds?.forEach(propId => {
        crmFields[`PROPERTY_${propId}`] = { value: String(input.qtyInStock) };
      });
    }
    if (input.qtyOnOrder !== undefined && input.qtyOnOrder !== null && !isNaN(Number(input.qtyOnOrder))) {
      this.context.qtyOnOrderPropertyIds?.forEach(propId => {
        crmFields[`PROPERTY_${propId}`] = { value: Number(input.qtyOnOrder) };
      });
    }
    if (input.dealerPrice !== undefined && input.dealerPrice !== null && !isNaN(Number(input.dealerPrice))) {
      this.context.dealerPricePropertyIds?.forEach(propId => {
        crmFields[`PROPERTY_${propId}`] = { value: String(input.dealerPrice) };
      });
    }
    if (input.endUserPrice !== undefined && input.endUserPrice !== null && !isNaN(Number(input.endUserPrice))) {
      this.context.endUserPricePropertyIds?.forEach(propId => {
        crmFields[`PROPERTY_${propId}`] = { value: String(input.endUserPrice) };
      });
    }
    if (this.context.barcodePropertyId && input.barcode) {
      crmFields[`PROPERTY_${this.context.barcodePropertyId}`] = { value: input.barcode.trim() };
    }

    if (Object.keys(crmFields).length > 0) {
      try {
        await this.client.callMethod('crm.product.update', {
          id: productId,
          fields: crmFields,
        });
      } catch (err: any) {
        logger.warn({ err: err?.message, productId }, 'Failed to update CRM product details');
      }
    }

    // Also update commercial catalog element (catalog.product) to guarantee title, description, and active state in Product Catalog view
    try {
      const catFields: any = { active: 'Y' };
      if (displayName) catFields.name = displayName;
      if (codeVal) catFields.code = codeVal;
      if (descVal) {
        catFields.detailText = descVal;
        catFields.previewText = descVal;
        catFields.detailTextType = 'text';
        catFields.previewTextType = 'text';
      }
      if (input.partNumber) {
        const pVal = input.partNumber.trim();
        this.context.partNumberPropertyIds?.forEach(propId => {
          catFields[`property${propId}`] = { value: pVal };
        });
      }
      if (input.code) {
        this.context.itemCodePropertyIds?.forEach(propId => {
          catFields[`property${propId}`] = { value: input.code!.trim() };
        });
      }
      if (this.context.barcodePropertyId && input.barcode) {
        catFields[`property${this.context.barcodePropertyId}`] = { value: input.barcode.trim() };
      }
      // Cost is native to Bitrix Inventory Management (purchasingPrice) and custom property
      if (input.cost !== undefined && input.cost !== null && !isNaN(Number(input.cost))) {
        catFields.purchasingPrice = Number(input.cost);
        catFields.purchasingCurrency = this.context.currency;
        this.context.costPropertyIds?.forEach(propId => {
          catFields[`property${propId}`] = { value: String(input.cost) };
        });
      }
      // Stock Quantity is native to Bitrix Inventory Management (quantity) and custom property
      if (input.qtyInStock !== undefined && input.qtyInStock !== null && !isNaN(Number(input.qtyInStock))) {
        catFields.quantity = Number(input.qtyInStock);
        this.context.stockQtyPropertyIds?.forEach(propId => {
          catFields[`property${propId}`] = { value: String(input.qtyInStock) };
        });
      }
      if (input.qtyOnOrder !== undefined && input.qtyOnOrder !== null && !isNaN(Number(input.qtyOnOrder))) {
        this.context.qtyOnOrderPropertyIds?.forEach(propId => {
          catFields[`property${propId}`] = { value: Number(input.qtyOnOrder) };
        });
      }
      if (input.dealerPrice !== undefined && input.dealerPrice !== null && !isNaN(Number(input.dealerPrice))) {
        this.context.dealerPricePropertyIds?.forEach(propId => {
          catFields[`property${propId}`] = { value: String(input.dealerPrice) };
        });
      }
      // End User Price custom property for grid display
      if (input.endUserPrice !== undefined && input.endUserPrice !== null && !isNaN(Number(input.endUserPrice))) {
        this.context.endUserPricePropertyIds?.forEach(propId => {
          catFields[`property${propId}`] = { value: String(input.endUserPrice) };
        });
      }
      await this.client.callMethod('catalog.product.update', {
        id: productId,
        fields: catFields,
      });
    } catch (catErr: any) {
      logger.warn({ err: catErr?.message, productId }, 'catalog.product.update in updateInventoryProduct warning');
    }

    // Sync prices (Cost, Dealer, End User)
    await this.syncProductPrices(productId, {
      cost: input.cost,
      dealerPrice: input.dealerPrice,
      endUserPrice: input.endUserPrice,
      basePrice: input.endUserPrice ?? input.dealerPrice,
    });

    // Requirement 4: Update Reserved Quantity if QTY ON ORDER is provided
    if (input.qtyOnOrder !== undefined && input.qtyOnOrder !== null && !isNaN(Number(input.qtyOnOrder))) {
      await this.setReservedQuantity(productId, Number(input.qtyOnOrder));
    }

    return true;
  }
}

const quantitySupport = new Map<number, boolean | 'unknown'>();

// Kept for API compatibility with older callers.
export class BitrixInventoryService {
  private client: BitrixClient;

  constructor(client: BitrixClient) {
    this.client = client;
  }

  async updateStoreStock(productId: number, quantity: number): Promise<boolean> {
    const context = await resolveCatalogContext(this.client);
    const productService = new BitrixProductService(this.client, context);
    const result = await productService.setQuantity(productId, quantity);
    return result.supported;
  }
}

export class BitrixBatchService {
  private client: BitrixClient;

  constructor(client: BitrixClient) {
    this.client = client;
  }

  async processBatch(items: Array<{ method: string; params: any }>): Promise<any[]> {
    return this.client.batch(items);
  }
}