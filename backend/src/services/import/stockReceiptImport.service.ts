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

export interface StockAdjustmentContext {
  receiptDocId?: number;
  deductionDocId?: number;
  docTitle?: string;
  plannedStockMap?: Map<string, number>;
  getOrCreateReceiptDoc?: () => Promise<number>;
  getOrCreateDeductionDoc?: () => Promise<number>;
  onElementAdded?: (docType: 'S' | 'D', productId: number, amount: number) => void;
}

export class StockReceiptImportService {
  async processRecord(
    rowData: StockReceiptRowData,
    mapping: StockReceiptMapping,
    importMode: string,
    bitrixDocumentIdOrContext?: number | StockAdjustmentContext,
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

    // Resolve adjustment context
    const docContext: StockAdjustmentContext = typeof bitrixDocumentIdOrContext === 'number'
      ? { receiptDocId: bitrixDocumentIdOrContext }
      : (bitrixDocumentIdOrContext || {});

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

      // Step 2: Bitrix Inventory Stock Replacement (Replace existing stock with uploaded quantity)
      const finalStoreId = Number(resolvedStoreId);
      const hasValidStockQty = qtyInStock !== undefined && qtyInStock !== null && !isNaN(Number(qtyInStock));
      const targetQty = hasValidStockQty ? Math.max(0, Number(qtyInStock)) : undefined;

      if (targetQty !== undefined) {
        try {
          const stockKey = `${productId}_${finalStoreId}`;
          let previousStock: number;

          if (docContext.plannedStockMap && docContext.plannedStockMap.has(stockKey)) {
            // Already processed this product in this import file; prevent duplicate addition/deduction
            previousStock = docContext.plannedStockMap.get(stockKey)!;
          } else {
            previousStock = await stockReceiptService.getCurrentStoreStock(productId, finalStoreId);
          }

          const delta = targetQty - previousStock;
          if (docContext.plannedStockMap) {
            docContext.plannedStockMap.set(stockKey, targetQty);
          }

          if (delta > 0) {
            // Stock increased: Add element to Receipt document (docType 'S')
            let rDocId = docContext.receiptDocId;
            if (!rDocId && docContext.getOrCreateReceiptDoc) {
              rDocId = await docContext.getOrCreateReceiptDoc();
              docContext.receiptDocId = rDocId;
            }
            if (rDocId) {
              await stockReceiptService.addDocumentElement(
                rDocId,
                productId,
                delta,
                cost !== undefined ? Number(cost) : undefined,
                finalStoreId
              );
              if (docContext.onElementAdded) docContext.onElementAdded('S', productId, delta);
              debugLog.debug('IMPORT', `Added product ${productId} to receipt doc ${rDocId} with delta +${delta} (current: ${previousStock} -> target: ${targetQty})`);
            } else {
              // Direct one-off receipt document if not in batch
              const oneOffDoc = await stockReceiptService.createStockReceiptDocument(
                `Stock Adjustment (+) - Product ${productId}`,
                `Individual replacement adjustment (+${delta})`,
                undefined,
                undefined,
                'S'
              );
              await stockReceiptService.addDocumentElement(oneOffDoc.id, productId, delta, cost !== undefined ? Number(cost) : undefined, finalStoreId);
              await stockReceiptService.conductDocument(oneOffDoc.id);
            }
          } else if (delta < 0) {
            // Stock decreased: Add element to Deduction document (docType 'D')
            const deductAmount = Math.abs(delta);
            let dDocId = docContext.deductionDocId;
            if (!dDocId && docContext.getOrCreateDeductionDoc) {
              dDocId = await docContext.getOrCreateDeductionDoc();
              docContext.deductionDocId = dDocId;
            }
            if (dDocId) {
              await stockReceiptService.addDocumentElement(
                dDocId,
                productId,
                deductAmount,
                cost !== undefined ? Number(cost) : undefined,
                undefined,
                finalStoreId
              );
              if (docContext.onElementAdded) docContext.onElementAdded('D', productId, deductAmount);
              debugLog.debug('IMPORT', `Added product ${productId} to deduction doc ${dDocId} with delta -${deductAmount} (current: ${previousStock} -> target: ${targetQty})`);
            } else {
              // Direct one-off deduction document if not in batch
              const oneOffDoc = await stockReceiptService.createStockReceiptDocument(
                `Stock Adjustment (-) - Product ${productId}`,
                `Individual replacement deduction (-${deductAmount})`,
                undefined,
                undefined,
                'D'
              );
              await stockReceiptService.addDocumentElement(oneOffDoc.id, productId, deductAmount, cost !== undefined ? Number(cost) : undefined, undefined, finalStoreId);
              await stockReceiptService.conductDocument(oneOffDoc.id);
            }
          } else {
            debugLog.debug('IMPORT', `Product ${productId} stock in store ${finalStoreId} is already equal to target ${targetQty}; no document adjustment needed`);
          }

          // Also set product quantity and custom property 115 (Stock Quantity) to targetQty
          await productService.setQuantity(productId, targetQty);
        } catch (stockErr: any) {
          logger.warn({ err: stockErr, productId, targetQty }, 'Failed to adjust warehouse stock to target');
          partialNotes.push(`Stock replacement warning: ${stockErr.message}`);
        }
      }

      // Also set product reserved quantity (QTY ON ORDER) if provided
      if (qtyOnOrder !== undefined && qtyOnOrder !== null && !isNaN(Number(qtyOnOrder))) {
        try {
          await productService.setReservedQuantity(productId, Number(qtyOnOrder));
        } catch {
          // Non-blocking
        }
      }

      const hasError = partialNotes.length > 0;
      const status: StockReceiptResultStatus = hasError ? 'FAILED' : 'SUCCESS';

      return {
        status,
        actionTaken,
        bitrixProductId: String(productId),
        bitrixDocumentId: docContext.receiptDocId ? String(docContext.receiptDocId) : (docContext.deductionDocId ? String(docContext.deductionDocId) : undefined),
        warehouseId: finalStoreId,
        quantityArrived: targetQty !== undefined ? targetQty : 0,
        purchasePrice: cost !== undefined ? Number(cost) : undefined,
        salesPrice: endUserPrice !== undefined ? Number(endUserPrice) : undefined,
        cost: cost !== undefined ? Number(cost) : undefined,
        dealerPrice: dealerPrice !== undefined ? Number(dealerPrice) : undefined,
        endUserPrice: endUserPrice !== undefined ? Number(endUserPrice) : undefined,
        qtyOnOrder: qtyOnOrder !== undefined ? Number(qtyOnOrder) : undefined,
        errorMessage: hasError ? partialNotes.join('; ') : undefined,
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

  async processBatch(
    batchItems: Array<{ recordId: string; rowData: StockReceiptRowData }>,
    mapping: StockReceiptMapping,
    importMode: string,
    docContext: StockAdjustmentContext,
    storesList?: BitrixStore[],
    clientOrUserId?: BitrixClient | string
  ): Promise<Map<string, StockReceiptResult>> {
    const results = new Map<string, StockReceiptResult>();
    if (batchItems.length === 0) return results;

    const client = clientOrUserId instanceof BitrixClient
      ? clientOrUserId
      : await BitrixClient.fromDbConfiguration(clientOrUserId);
    const catalogService = new BitrixCatalogService(client);
    const stockReceiptService = new BitrixStockReceiptService(client);
    const context = await catalogService.getCatalogContext();
    const productService = new BitrixProductService(client, context);

    // Resolve default store ID
    let resolvedDefaultStoreId = 1;
    if (mapping.defaultStoreId) {
      resolvedDefaultStoreId = Number(mapping.defaultStoreId);
    } else if (storesList && storesList.length > 0) {
      const mainStore = storesList.find(s => s.title.toLowerCase().includes('main') || s.id === 62) || storesList[0];
      resolvedDefaultStoreId = mainStore ? mainStore.id : 1;
    }

    // Step 1: Pre-validate each row
    const eligibleItems: Array<{
      recordId: string;
      rowData: StockReceiptRowData;
      code: string;
      partNumber: string;
      description: string;
      barcode?: string;
      cost?: number;
      dealerPrice?: number;
      endUserPrice?: number;
      qtyInStock?: number;
      qtyOnOrder?: number;
      targetStoreId: number;
    }> = [];

    for (const item of batchItems) {
      const row = item.rowData;
      const code = (row.code || row.sku || '').trim();
      const partNumber = (row.partNumber || row.name || '').trim();
      const description = (row.description || row.name || '').trim();
      const barcode = (row.barcode || '').trim();
      const cost = row.cost ?? row.purchasePrice;
      const dealerPrice = row.dealerPrice;
      const endUserPrice = row.endUserPrice ?? row.salesPrice;
      const qtyInStock = row.qtyInStock ?? row.quantityArrived;
      const qtyOnOrder = row.qtyOnOrder;

      if (!code) {
        results.set(item.recordId, { status: 'FAILED', errorMessage: 'CODE field is mandatory' });
        continue;
      }
      if (!description) {
        results.set(item.recordId, { status: 'FAILED', errorMessage: 'DESCRIPTION field is mandatory' });
        continue;
      }

      // Warehouse resolution
      let storeId = resolvedDefaultStoreId;
      if (row.warehouse && storesList && storesList.length > 0) {
        const whRaw = String(row.warehouse).trim().toLowerCase();
        const matched = storesList.find(s =>
          String(s.id) === whRaw ||
          s.title.toLowerCase() === whRaw ||
          s.title.toLowerCase().includes(whRaw)
        );
        if (matched) storeId = matched.id;
      }

      eligibleItems.push({
        recordId: item.recordId,
        rowData: row,
        code,
        partNumber: partNumber || code,
        description,
        barcode: barcode || undefined,
        cost: cost !== undefined && !isNaN(Number(cost)) ? Number(cost) : undefined,
        dealerPrice: dealerPrice !== undefined && !isNaN(Number(dealerPrice)) ? Number(dealerPrice) : undefined,
        endUserPrice: endUserPrice !== undefined && !isNaN(Number(endUserPrice)) ? Number(endUserPrice) : undefined,
        qtyInStock: qtyInStock !== undefined && qtyInStock !== null && !isNaN(Number(qtyInStock)) ? Number(qtyInStock) : undefined,
        qtyOnOrder: qtyOnOrder !== undefined && qtyOnOrder !== null && !isNaN(Number(qtyOnOrder)) ? Number(qtyOnOrder) : undefined,
        targetStoreId: storeId,
      });
    }

    if (eligibleItems.length === 0) return results;

    // Step 2: Batch product lookup (1 call for 50 codes)
    const codesToLookup = eligibleItems.map(it => it.code);
    const foundProductMap = await productService.batchFindProductsByCodes(codesToLookup);

    // Batch fallback for barcodes if present on unmatched items
    const unmatchedBarcodes = eligibleItems
      .filter(it => !foundProductMap.has(it.code.toUpperCase()) && it.barcode)
      .map(it => it.barcode!);
    const foundBarcodeMap = unmatchedBarcodes.length > 0
      ? await productService.batchFindProductsByBarcodes(unmatchedBarcodes)
      : new Map<string, any>();

    // Filter out items based on importMode and map existing IDs
    const itemsToProcess: typeof eligibleItems = [];
    const itemExistingProduct = new Map<string, any>();

    for (const item of eligibleItems) {
      let existing = foundProductMap.get(item.code.toUpperCase());
      if (!existing && item.barcode) {
        existing = foundBarcodeMap.get(String(item.barcode).trim().toUpperCase());
      }
      // Fallback for SKU if different from code
      if (!existing && item.rowData.sku && item.rowData.sku !== item.code) {
        existing = await productService.findProductBySku(item.rowData.sku);
      }
      if (!existing && item.barcode && !foundBarcodeMap.has(String(item.barcode).trim().toUpperCase())) {
        existing = await productService.findProductByBarcode(item.barcode);
      }

      if (importMode === 'UPDATE_ONLY' && !existing) {
        results.set(item.recordId, {
          status: 'SKIPPED',
          errorMessage: 'Product does not exist in catalog (Update Only mode)',
        });
        continue;
      }

      itemExistingProduct.set(item.recordId, existing);
      itemsToProcess.push(item);
    }

    if (itemsToProcess.length === 0) return results;

    // Step 3: Batch Create / Update products (1 batch call for 50 products)
    const batchOps = itemsToProcess.map(item => {
      const existing = itemExistingProduct.get(item.recordId);
      return {
        key: item.recordId,
        code: item.code,
        existingProductId: existing ? Number(existing.id) : undefined,
        input: {
          code: item.code,
          partNumber: item.partNumber,
          description: item.description,
          cost: item.cost,
          dealerPrice: item.dealerPrice,
          endUserPrice: item.endUserPrice,
          qtyOnOrder: item.qtyOnOrder,
          qtyInStock: item.qtyInStock,
          barcode: item.barcode,
        },
      };
    });

    const syncProductResults = await productService.batchCreateOrUpdateProducts(batchOps);

    // Step 4: Batch Price Sync (1 batch call for 50 products)
    const priceItems: Array<{ productId: number; cost?: number; dealerPrice?: number; endUserPrice?: number }> = [];
    for (const item of itemsToProcess) {
      const opRes = syncProductResults.get(item.recordId);
      if (opRes && opRes.id > 0 && !opRes.error) {
        priceItems.push({
          productId: opRes.id,
          cost: item.cost,
          dealerPrice: item.dealerPrice,
          endUserPrice: item.endUserPrice,
        });
      }
    }

    if (priceItems.length > 0) {
      try {
        await productService.batchSyncPrices(priceItems);
      } catch (priceErr: any) {
        logger.warn({ err: priceErr?.message }, 'Batch price sync encountered non-fatal error');
      }
    }

    // Step 5: Stock Replacement & Batch Document Elements (1 batch call for 50 products)
    const receiptElements: Array<{ docId: number; productId: number; amount: number; purchasingPrice?: number; storeTo?: number }> = [];
    const deductionElements: Array<{ docId: number; productId: number; amount: number; purchasingPrice?: number; storeFrom?: number }> = [];
    const itemAdjustmentInfo = new Map<string, { productId: number; delta: number; targetQty?: number; actionTaken: 'CREATED' | 'UPDATED'; partialNotes: string[] }>();

    // 5a. Fast stock preparation:
    // For CREATED products: initial warehouse stock is 0 by definition (0 API calls!).
    // For UPDATED products: if not already cached in plannedStockMap, batch fetch via catalog.storeproduct.list (1 API call for all 50 items!).
    const storeLookupGroups = new Map<number, number[]>();

    for (const item of itemsToProcess) {
      const opRes = syncProductResults.get(item.recordId);
      if (!opRes || !opRes.id || opRes.error) continue;

      const hasValidStockQty = item.qtyInStock !== undefined && item.qtyInStock !== null && !isNaN(Number(item.qtyInStock));
      if (!hasValidStockQty) continue;

      const productId = opRes.id;
      const stockKey = `${productId}_${item.targetStoreId}`;

      if (opRes.actionTaken === 'CREATED') {
        if (docContext.plannedStockMap && !docContext.plannedStockMap.has(stockKey)) {
          docContext.plannedStockMap.set(stockKey, 0);
        }
      } else if (opRes.actionTaken === 'UPDATED') {
        if (!docContext.plannedStockMap || !docContext.plannedStockMap.has(stockKey)) {
          const list = storeLookupGroups.get(item.targetStoreId) || [];
          list.push(productId);
          storeLookupGroups.set(item.targetStoreId, list);
        }
      }
    }

    // 5b. Batch fetch store stock for all UPDATED products (1 batch call per store, eliminating 50 individual calls)
    for (const [storeId, pids] of storeLookupGroups.entries()) {
      try {
        const stockMap = await stockReceiptService.batchGetStoreStock(pids, storeId);
        for (const pid of pids) {
          const stockKey = `${pid}_${storeId}`;
          let currentStock = stockMap.get(pid);

          // If no storeproduct row exists in Bitrix yet, fallback to catalog quantity from Step 2
          if (currentStock === undefined) {
            const matchedItem = itemsToProcess.find(it => {
              const res = syncProductResults.get(it.recordId);
              return res && res.id === pid;
            });
            const existing = matchedItem ? itemExistingProduct.get(matchedItem.recordId) : null;
            if (existing && existing.quantity !== undefined && existing.quantity !== null && !isNaN(Number(existing.quantity))) {
              currentStock = Number(existing.quantity);
            } else {
              currentStock = 0;
            }
          }

          if (docContext.plannedStockMap) {
            docContext.plannedStockMap.set(stockKey, currentStock);
          }
        }
      } catch (err: any) {
        logger.warn({ err: err?.message, storeId }, 'Failed to batch fetch store stock for updated products; defaulting to 0');
        for (const pid of pids) {
          const stockKey = `${pid}_${storeId}`;
          if (docContext.plannedStockMap && !docContext.plannedStockMap.has(stockKey)) {
            docContext.plannedStockMap.set(stockKey, 0);
          }
        }
      }
    }

    // 5c. Calculate stock deltas purely in-memory (0 API calls!)
    for (const item of itemsToProcess) {
      const opRes = syncProductResults.get(item.recordId);
      if (!opRes || !opRes.id || opRes.error) {
        results.set(item.recordId, {
          status: 'FAILED',
          errorMessage: opRes?.error || 'Failed to obtain Bitrix product ID',
        });
        continue;
      }

      const productId = opRes.id;
      const partialNotes: string[] = [];
      const hasValidStockQty = item.qtyInStock !== undefined && item.qtyInStock !== null && !isNaN(Number(item.qtyInStock));
      const targetQty = hasValidStockQty ? Math.max(0, Number(item.qtyInStock)) : undefined;
      let delta = 0;

      if (targetQty !== undefined) {
        const stockKey = `${productId}_${item.targetStoreId}`;
        const previousStock = (docContext.plannedStockMap && docContext.plannedStockMap.get(stockKey)) ?? 0;

        delta = targetQty - previousStock;
        if (delta === 0 && docContext.plannedStockMap) {
          docContext.plannedStockMap.set(stockKey, targetQty);
        }
      }

      itemAdjustmentInfo.set(item.recordId, {
        productId,
        delta,
        targetQty,
        actionTaken: opRes.actionTaken,
        partialNotes,
      });
    }

    // Collect elements for documents
    for (const item of itemsToProcess) {
      const info = itemAdjustmentInfo.get(item.recordId);
      if (!info) continue;

      if (info.delta > 0) {
        receiptElements.push({
          docId: 0,
          productId: info.productId,
          amount: info.delta,
          purchasingPrice: item.cost,
          storeTo: item.targetStoreId,
        });
      } else if (info.delta < 0) {
        deductionElements.push({
          docId: 0,
          productId: info.productId,
          amount: Math.abs(info.delta),
          purchasingPrice: item.cost,
          storeFrom: item.targetStoreId,
        });
      }
    }

    // Add elements to Receipt document if any
    if (receiptElements.length > 0) {
      try {
        let rDocId = docContext.receiptDocId;
        if (!rDocId && docContext.getOrCreateReceiptDoc) {
          rDocId = await docContext.getOrCreateReceiptDoc();
          docContext.receiptDocId = rDocId;
        }
        if (rDocId) {
          receiptElements.forEach(el => (el.docId = rDocId!));
          const addRes = await stockReceiptService.batchAddDocumentElements(receiptElements);
          receiptElements.forEach((el, idx) => {
            const elRes = addRes.results?.[idx];
            if (elRes && elRes.success) {
              if (docContext.onElementAdded) docContext.onElementAdded('S', el.productId, el.amount);
              if (docContext.plannedStockMap && el.storeTo) {
                const matchedItem = itemsToProcess.find(it => {
                  const info = itemAdjustmentInfo.get(it.recordId);
                  return info && info.productId === el.productId;
                });
                const info = matchedItem ? itemAdjustmentInfo.get(matchedItem.recordId) : null;
                const newStock = info?.targetQty !== undefined ? info.targetQty : el.amount;
                docContext.plannedStockMap.set(`${el.productId}_${el.storeTo}`, newStock);
              }
            } else {
              const matchedItem = itemsToProcess.find(it => {
                const info = itemAdjustmentInfo.get(it.recordId);
                return info && info.productId === el.productId;
              });
              if (matchedItem) {
                const info = itemAdjustmentInfo.get(matchedItem.recordId);
                if (info) info.partialNotes.push(`Failed to add item to receipt document: ${elRes?.error || 'Bitrix error'}`);
              }
            }
          });
        } else {
          for (const el of receiptElements) {
            const matchedItem = itemsToProcess.find(it => {
              const info = itemAdjustmentInfo.get(it.recordId);
              return info && info.productId === el.productId;
            });
            if (matchedItem) {
              const info = itemAdjustmentInfo.get(matchedItem.recordId);
              if (info) info.partialNotes.push('Failed to create or obtain stock receipt document in Bitrix');
            }
          }
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'Failed to batch add receipt elements');
        for (const el of receiptElements) {
          const matchedItem = itemsToProcess.find(it => {
            const info = itemAdjustmentInfo.get(it.recordId);
            return info && info.productId === el.productId;
          });
          if (matchedItem) {
            const info = itemAdjustmentInfo.get(matchedItem.recordId);
            if (info) info.partialNotes.push(`Failed to add item to receipt document: ${err?.message || 'Bitrix error'}`);
          }
        }
      }
    }

    // Add elements to Deduction document if any
    if (deductionElements.length > 0) {
      try {
        let dDocId = docContext.deductionDocId;
        if (!dDocId && docContext.getOrCreateDeductionDoc) {
          dDocId = await docContext.getOrCreateDeductionDoc();
          docContext.deductionDocId = dDocId;
        }
        if (dDocId) {
          deductionElements.forEach(el => (el.docId = dDocId!));
          const addRes = await stockReceiptService.batchAddDocumentElements(deductionElements);
          deductionElements.forEach((el, idx) => {
            const elRes = addRes.results?.[idx];
            if (elRes && elRes.success) {
              if (docContext.onElementAdded) docContext.onElementAdded('D', el.productId, el.amount);
              if (docContext.plannedStockMap && el.storeFrom) {
                const matchedItem = itemsToProcess.find(it => {
                  const info = itemAdjustmentInfo.get(it.recordId);
                  return info && info.productId === el.productId;
                });
                const info = matchedItem ? itemAdjustmentInfo.get(matchedItem.recordId) : null;
                const newStock = info?.targetQty !== undefined ? info.targetQty : 0;
                docContext.plannedStockMap.set(`${el.productId}_${el.storeFrom}`, newStock);
              }
            } else {
              const matchedItem = itemsToProcess.find(it => {
                const info = itemAdjustmentInfo.get(it.recordId);
                return info && info.productId === el.productId;
              });
              if (matchedItem) {
                const info = itemAdjustmentInfo.get(matchedItem.recordId);
                if (info) info.partialNotes.push(`Failed to add item to deduction document: ${elRes?.error || 'Bitrix error'}`);
              }
            }
          });
        } else {
          for (const el of deductionElements) {
            const matchedItem = itemsToProcess.find(it => {
              const info = itemAdjustmentInfo.get(it.recordId);
              return info && info.productId === el.productId;
            });
            if (matchedItem) {
              const info = itemAdjustmentInfo.get(matchedItem.recordId);
              if (info) info.partialNotes.push('Failed to create or obtain stock deduction document in Bitrix');
            }
          }
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'Failed to batch add deduction elements');
        for (const el of deductionElements) {
          const matchedItem = itemsToProcess.find(it => {
            const info = itemAdjustmentInfo.get(it.recordId);
            return info && info.productId === el.productId;
          });
          if (matchedItem) {
            const info = itemAdjustmentInfo.get(matchedItem.recordId);
            if (info) info.partialNotes.push(`Failed to add item to deduction document: ${err?.message || 'Bitrix error'}`);
          }
        }
      }
    }

    // Build final results map for each record
    for (const item of itemsToProcess) {
      const info = itemAdjustmentInfo.get(item.recordId);
      if (!info) continue;

      const hasError = info.partialNotes.length > 0;
      const status: StockReceiptResultStatus = hasError ? 'FAILED' : 'SUCCESS';

      results.set(item.recordId, {
        status,
        actionTaken: info.actionTaken,
        bitrixProductId: String(info.productId),
        bitrixDocumentId: docContext.receiptDocId ? String(docContext.receiptDocId) : (docContext.deductionDocId ? String(docContext.deductionDocId) : undefined),
        warehouseId: item.targetStoreId,
        quantityArrived: info.targetQty !== undefined ? info.targetQty : 0,
        purchasePrice: item.cost,
        salesPrice: item.endUserPrice,
        cost: item.cost,
        dealerPrice: item.dealerPrice,
        endUserPrice: item.endUserPrice,
        qtyOnOrder: item.qtyOnOrder,
        errorMessage: hasError ? info.partialNotes.join('; ') : undefined,
      });
    }

    return results;
  }
}

export const stockReceiptImportService = new StockReceiptImportService();
