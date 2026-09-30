import { BitrixClient } from '../bitrix/BitrixClient';
import { BitrixCatalogService, BitrixProductService, InventoryProductInput } from '../bitrix/BitrixCatalogService';
import { BitrixStockReceiptService, BitrixStore } from '../bitrix/BitrixStockReceiptService';
import { logger } from '../../utils/logger';
import { debugLog } from '../debug/debugLog.service';

export interface StockReceiptRowData {
  sku?: string;
  code?: string;
  partNumber?: string;
  description?: string;
  name?: string;
  barcode?: string;
  purchasePrice?: number;
  cost?: number;
  salesPrice?: number;
  dealerPrice?: number;
  endUserPrice?: number;
  quantityArrived?: number;
  qtyInStock?: number;
  qtyOnOrder?: number;
  warehouse?: string;
  quantityDestination?: number;
  total?: number;
  defaultStoreId?: number;
  [key: string]: any;
}

export interface StockReceiptMapping {
  codeField?: string;
  skuField?: string;
  partNumberField?: string;
  descriptionField?: string;
  nameField?: string;
  barcodeField?: string;
  costField?: string;
  purchasePriceField?: string;
  dealerPriceField?: string;
  endUserPriceField?: string;
  salesPriceField?: string;
  qtyInStockField?: string;
  quantityArrivedField?: string;
  quantityField?: string;
  qtyOnOrderField?: string;
  warehouseField?: string;
  quantityDestinationField?: string;
  totalField?: string;
  defaultStoreId?: number;
  [key: string]: any;
}

export type StockReceiptResultStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'PARTIAL_FAILURE';

export interface StockReceiptResult {
  status: StockReceiptResultStatus;
  actionTaken?: 'CREATED' | 'UPDATED';
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
  errorMessage?: string;
  bitrixError?: string;
}

export class StockReceiptImportService {
  async processRecord(
    rowData: StockReceiptRowData,
    mapping: StockReceiptMapping,
    importMode: string,
    bitrixDocumentId?: number,
    storesList?: BitrixStore[],
    clientOrUserId?: BitrixClient | string
  ): Promise<StockReceiptResult> {
    const code = (rowData.code || rowData.sku || '').trim();
    const partNumber = (rowData.partNumber || rowData.name || '').trim();
    const description = (rowData.description || rowData.name || '').trim();
    const barcode = (rowData.barcode || '').trim();

    const cost = rowData.cost ?? rowData.purchasePrice;
    const dealerPrice = rowData.dealerPrice;
    const endUserPrice = rowData.endUserPrice ?? rowData.salesPrice;
    const qtyInStock = rowData.qtyInStock ?? rowData.quantityArrived;
    const qtyOnOrder = rowData.qtyOnOrder;

    // Requirement 2: CODE is mandatory product identifier
    if (!code) {
      return { status: 'FAILED', errorMessage: 'CODE field is mandatory' };
    }

    // Requirement 3: The DESCRIPTION field is mandatory
    if (!description) {
      return { status: 'FAILED', errorMessage: 'DESCRIPTION field is mandatory' };
    }

    try {
      const client = clientOrUserId instanceof BitrixClient
        ? clientOrUserId
        : await BitrixClient.fromDbConfiguration(clientOrUserId);
      const catalogService = new BitrixCatalogService(client);
      const stockReceiptService = new BitrixStockReceiptService(client);
      const context = await catalogService.getCatalogContext();
      const productService = new BitrixProductService(client, context);

      // Resolve destination warehouse
      let resolvedStoreId: number | undefined;
      if (rowData.warehouse && storesList && storesList.length > 0) {
        const whRaw = String(rowData.warehouse).trim().toLowerCase();
        const matched = storesList.find(s => 
          String(s.id) === whRaw || 
          s.title.toLowerCase() === whRaw || 
          s.title.toLowerCase().includes(whRaw)
        );
        if (matched) {
          resolvedStoreId = matched.id;
        }
      }

      if (!resolvedStoreId && (mapping.defaultStoreId || rowData.defaultStoreId)) {
        const reqStoreId = Number(mapping.defaultStoreId || rowData.defaultStoreId);
        if (storesList && storesList.some(s => s.id === reqStoreId)) {
          resolvedStoreId = reqStoreId;
        }
      }

      if (!resolvedStoreId) {
        if (!storesList || storesList.length === 0) {
          try {
            storesList = await stockReceiptService.getStores();
          } catch {
            storesList = [];
          }
        }
        if (storesList && storesList.length > 0) {
          const mainStore = storesList.find(s => s.title.toLowerCase().includes('main') || s.id === 62);
          resolvedStoreId = mainStore ? mainStore.id : storesList[0].id;
        }
      }
      if (!resolvedStoreId) resolvedStoreId = 1;

      // Step 1: Product Matching
      // Requirement 2: Match by CODE
      let existingProduct = await productService.findProductByCode(code);
      if (!existingProduct && code !== rowData.sku && rowData.sku) {
        existingProduct = await productService.findProductBySku(rowData.sku);
      }
      if (!existingProduct && barcode) {
        existingProduct = await productService.findProductByBarcode(barcode);
      }

      if (importMode === 'UPDATE_ONLY' && !existingProduct) {
        return { status: 'SKIPPED', errorMessage: 'Product does not exist in catalog (Update Only mode)' };
      }

      let productId: number;
      let actionTaken: 'CREATED' | 'UPDATED';
      let partialNotes: string[] = [];

      const productPayload: InventoryProductInput = {
        code,
        partNumber: partNumber || code, // Requirement 12: PART NUMBER → Product Title
        description,                   // Requirement 3 & 12: DESCRIPTION → Product Description
        cost: cost !== undefined ? Number(cost) : undefined,
        dealerPrice: dealerPrice !== undefined ? Number(dealerPrice) : undefined,
        endUserPrice: endUserPrice !== undefined ? Number(endUserPrice) : undefined,
        qtyOnOrder: qtyOnOrder !== undefined ? Number(qtyOnOrder) : undefined,
        qtyInStock: qtyInStock !== undefined && qtyInStock !== null && !isNaN(Number(qtyInStock)) ? Number(qtyInStock) : undefined,
        barcode: barcode || undefined,
      };

      if (existingProduct) {
        productId = Number(existingProduct.id);
        actionTaken = 'UPDATED';

        if (importMode !== 'CREATE_ONLY') {
          await productService.updateInventoryProduct(productId, productPayload);
        }
      } else {
        actionTaken = 'CREATED';
        productId = await productService.createInventoryProduct(productPayload);
      }

      if (!productId) {
        return { status: 'FAILED', errorMessage: 'Failed to obtain Bitrix product ID' };
      }

      // Step 2: Bitrix Inventory Stock Receipt Document Sync (QTY IN STOCK)
      const finalStoreId = Number(resolvedStoreId);
      const qtyNum = qtyInStock !== undefined && qtyInStock !== null && !isNaN(Number(qtyInStock)) ? Number(qtyInStock) : 0;

      if (bitrixDocumentId && qtyNum > 0) {
        try {
          await stockReceiptService.addDocumentElement(
            bitrixDocumentId,
            productId,
            qtyNum,
            cost !== undefined ? Number(cost) : undefined,
            finalStoreId
          );
          debugLog.debug('IMPORT', `Added product ${productId} to stock receipt doc ${bitrixDocumentId} with amount ${qtyNum}`);
        } catch (docErr: any) {
          partialNotes.push(`Stock receipt doc line item warning: ${docErr.message}`);
        }
      }

      // Sync direct store stock
      try {
        await stockReceiptService.syncDirectStoreStock(productId, finalStoreId, qtyNum);
      } catch {
        // Non-blocking
      }

      // Also set product quantity field if supported
      try {
        await productService.setQuantity(productId, qtyNum);
      } catch {
        // Non-blocking
      }

      // Also set product reserved quantity (QTY ON ORDER) if provided
      if (qtyOnOrder !== undefined && qtyOnOrder !== null && !isNaN(Number(qtyOnOrder))) {
        try {
          await productService.setReservedQuantity(productId, Number(qtyOnOrder));
        } catch {
          // Non-blocking
        }
      }

      const status: StockReceiptResultStatus = partialNotes.length > 0 ? 'PARTIAL_FAILURE' : 'SUCCESS';

      return {
        status,
        actionTaken,
        bitrixProductId: String(productId),
        bitrixDocumentId: bitrixDocumentId ? String(bitrixDocumentId) : undefined,
        warehouseId: finalStoreId,
        quantityArrived: qtyNum,
        purchasePrice: cost !== undefined ? Number(cost) : undefined,
        salesPrice: endUserPrice !== undefined ? Number(endUserPrice) : undefined,
        cost: cost !== undefined ? Number(cost) : undefined,
        dealerPrice: dealerPrice !== undefined ? Number(dealerPrice) : undefined,
        endUserPrice: endUserPrice !== undefined ? Number(endUserPrice) : undefined,
        qtyOnOrder: qtyOnOrder !== undefined ? Number(qtyOnOrder) : undefined,
        errorMessage: partialNotes.length > 0 ? partialNotes.join('; ') : undefined,
      };
    } catch (error: any) {
      logger.error({ err: error, code, partNumber }, 'Stock receipt record processing failed');
      return {
        status: 'FAILED',
        errorMessage: error.message || 'Unknown error while processing inventory record',
        bitrixError: 'Bitrix API error during inventory sync',
      };
    }
  }
}

export const stockReceiptImportService = new StockReceiptImportService();
