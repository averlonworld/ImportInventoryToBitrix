import { Job, Worker } from 'bullmq';
import fs from 'fs';
import { prisma } from '../../config/database';
import { importService } from './import.service';
import { invoiceImportService } from './invoiceImport.service';
import { stockReceiptImportService, StockAdjustmentContext } from './stockReceiptImport.service';
import { BitrixClient } from '../bitrix/BitrixClient';
import { BitrixStockReceiptService, BitrixStore } from '../bitrix/BitrixStockReceiptService';
import { createImportWorker, ImportJobData, ImportType } from '../../queues/import.queue';
import { logger } from '../../utils/logger';
import { debugLog } from '../../services/debug/debugLog.service';
import { bitrixConfig } from '../../config/bitrix';

const BATCH_SIZE = bitrixConfig.batchSize;

let activeWorker: Worker | null = null;

export function classifyError(msg?: string | null): string {
  if (!msg) return 'UNKNOWN_ERROR';
  const m = msg.toLowerCase();
  if (m.includes('mandatory') || m.includes('required') || m.includes('missing') || m.includes('invalid format')) {
    return 'VALIDATION_ERROR';
  }
  if (m.includes('rate limit') || m.includes('too many requests') || m.includes('query_limit_exceeded')) {
    return 'RATE_LIMIT_ERROR';
  }
  if (m.includes('auth') || m.includes('unauthorized') || m.includes('forbidden') || m.includes('invalid credentials')) {
    return 'AUTH_ERROR';
  }
  if (m.includes('timeout') || m.includes('econnrefused') || m.includes('network') || m.includes('enotfound')) {
    return 'NETWORK_ERROR';
  }
  if (m.includes('duplicate')) {
    return 'DUPLICATE_ERROR';
  }
  if (m.includes('bitrix') || m.includes('rest') || m.includes('catalog') || m.includes('product') || m.includes('document')) {
    return 'BITRIX_API_ERROR';
  }
  return 'PROCESSING_ERROR';
}

export function extractRowData(record: any, mapping: any, importType: ImportType): any {
  const rawData = (record.rawData as any) || {};
  const num = (v: any) => (v !== undefined && v !== '' && v !== null && !isNaN(Number(v)) ? Number(v) : undefined);

  // Helper to find value from rawData or record
  const findVal = (candidates: string[]): any => {
    for (const cand of candidates) {
      if (mapping[cand] && rawData[mapping[cand]] !== undefined && rawData[mapping[cand]] !== '') {
        return rawData[mapping[cand]];
      }
    }
    for (const [k, v] of Object.entries(rawData)) {
      if (k.startsWith('_')) continue;
      const cleanK = k.trim().toLowerCase();
      for (const cand of candidates) {
        if (cleanK === cand.toLowerCase() && v !== undefined && v !== '') {
          return v;
        }
      }
    }
    return undefined;
  };

  if (importType === 'STOCK_RECEIPTS' || mapping.quantityArrivedField || mapping.quantityField || mapping.qtyInStockField) {
    const rawCode = findVal(['codeField', 'skuField', 'code', 'item code', 'sku', 'product code']) ?? record.sku;
    const rawPartNumber = findVal(['partNumberField', 'part number', 'part no', 'part_number', 'partno']) ?? record.partNumber ?? record.productName;
    const rawDescription = findVal(['descriptionField', 'nameField', 'description', 'product description', 'desc']) ?? record.description ?? record.productName;

    const rawCost = num(findVal(['costField', 'purchasePriceField', 'cost', 'cost ', 'purchase price', 'purchasing price'])) ?? record.cost ?? record.purchasePrice;
    const rawDealerPrice = num(findVal(['dealerPriceField', 'dealer price', 'dealer'])) ?? record.dealerPrice;
    const rawEndUserPrice = num(findVal(['endUserPriceField', 'salesPriceField', 'priceField', 'end user price', 'sales price', 'selling price', 'retail price', 'price'])) ?? record.endUserPrice ?? record.salesPrice;
    const rawQtyStock = num(findVal(['qtyInStockField', 'quantityArrivedField', 'quantityField', 'qty in stock', 'quantity arrived', 'quantity', 'qty', 'in stock'])) ?? record.qtyInStock ?? record.quantityArrived ?? 0;
    const rawQtyOrder = num(findVal(['qtyOnOrderField', 'qty on order', 'on order', 'qty_on_order'])) ?? record.qtyOnOrder;

    let barcodeVal = mapping.barcodeField ? String(rawData[mapping.barcodeField] ?? '').trim() : undefined;
    if (!barcodeVal) {
      for (const [k, v] of Object.entries(rawData)) {
        if (k.startsWith('_')) continue;
        const kLower = k.toLowerCase().trim();
        if (kLower.includes('barcode') || kLower.includes('bar code') || kLower === 'ean' || kLower === 'upc') {
          if (v !== undefined && v !== null && String(v).trim()) {
            barcodeVal = String(v).trim();
            break;
          }
        }
      }
    }

    return {
      code: rawCode ? String(rawCode).trim() : '',
      sku: rawCode ? String(rawCode).trim() : '',
      partNumber: rawPartNumber ? String(rawPartNumber).trim() : (rawCode ? String(rawCode).trim() : ''),
      name: rawPartNumber ? String(rawPartNumber).trim() : (rawCode ? String(rawCode).trim() : ''),
      description: rawDescription ? String(rawDescription).trim() : '',
      cost: rawCost,
      purchasePrice: rawCost,
      dealerPrice: rawDealerPrice,
      endUserPrice: rawEndUserPrice,
      salesPrice: rawEndUserPrice,
      qtyInStock: rawQtyStock,
      quantityArrived: rawQtyStock,
      qtyOnOrder: rawQtyOrder,
      barcode: barcodeVal,
      warehouse: mapping.warehouseField ? String(rawData[mapping.warehouseField] ?? '').trim() : undefined,
      quantityDestination: mapping.quantityDestinationField ? num(rawData[mapping.quantityDestinationField]) : undefined,
      total: mapping.totalField ? num(rawData[mapping.totalField]) : undefined,
      defaultStoreId: mapping.defaultStoreId ? Number(mapping.defaultStoreId) : 1,
    };
  }

  if (importType === 'INVOICES') {
    const num = (v: any) => (v !== undefined && v !== '' ? Number(v) : undefined);
    return {
      accountNumber: mapping.accountNumberField
        ? (rawData[mapping.accountNumberField] !== undefined && rawData[mapping.accountNumberField] !== ''
            ? String(rawData[mapping.accountNumberField])
            : '')
        : '',
      orderTopic: mapping.orderTopicField
        ? (rawData[mapping.orderTopicField] ? String(rawData[mapping.orderTopicField]) : undefined)
        : undefined,
      client: mapping.clientField
        ? (rawData[mapping.clientField] ? String(rawData[mapping.clientField]) : undefined)
        : undefined,
      amount: mapping.amountField ? num(rawData[mapping.amountField]) : undefined,
      currency: mapping.currencyField
        ? (rawData[mapping.currencyField] ? String(rawData[mapping.currencyField]) : undefined)
        : undefined,
      status: mapping.statusField
        ? (rawData[mapping.statusField] ? String(rawData[mapping.statusField]) : undefined)
        : undefined,
      billDate: mapping.billDateField
        ? (rawData[mapping.billDateField] ? String(rawData[mapping.billDateField]) : undefined)
        : undefined,
      dueDate: mapping.dueDateField
        ? (rawData[mapping.dueDateField] ? String(rawData[mapping.dueDateField]) : undefined)
        : undefined,
      comment: mapping.commentField
        ? (rawData[mapping.commentField] ? String(rawData[mapping.commentField]) : undefined)
        : undefined,
    };
  }

  let productBarcodeVal = mapping.barcodeField ? String(rawData[mapping.barcodeField] ?? '').trim() : undefined;
  if (!productBarcodeVal) {
    for (const [k, v] of Object.entries(rawData)) {
      if (k.startsWith('_')) continue;
      const kLower = k.toLowerCase().trim();
      if (kLower.includes('barcode') || kLower.includes('bar code') || kLower === 'ean' || kLower === 'upc' || kLower === 'gtin') {
        if (v !== undefined && v !== null && String(v).trim()) {
          productBarcodeVal = String(v).trim();
          break;
        }
      }
    }
  }

  return {
    sku: mapping.skuField ? String(rawData[mapping.skuField] ?? '').trim() : '',
    name: mapping.nameField ? String(rawData[mapping.nameField] ?? '').trim() : '',
    quantity: mapping.quantityField ? (rawData[mapping.quantityField] !== undefined && rawData[mapping.quantityField] !== '' ? Number(rawData[mapping.quantityField]) : undefined) : undefined,
    price: mapping.priceField ? (rawData[mapping.priceField] !== undefined && rawData[mapping.priceField] !== '' ? Number(rawData[mapping.priceField]) : undefined) : undefined,
    barcode: productBarcodeVal,
  };
}

async function processJob(job: Job<ImportJobData>): Promise<void> {
  const { importJobId, importMode } = job.data;
  const importType: ImportType = job.data.type || 'PRODUCTS';

  try {
    // Load import job
    const importJob = await prisma.importJob.findUnique({ where: { id: importJobId } });
    if (!importJob) {
      throw new Error(`Import job ${importJobId} not found`);
    }

    const effectiveMapping = job.data.mapping || (importJob.mappingJson as any) || {};

    // Mark job as processing
    await prisma.importJob.update({
      where: { id: importJobId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    logger.info(`Import job ${importJobId} started (${importType})`);
    debugLog.info('WORKER', `Import job ${importJobId} started (${importType})`, {
      importJobId,
      importType,
      recordCount: await prisma.importRecord.count({ where: { importJobId, status: 'PENDING' } }),
    });

    let receiptDocId: number | undefined;
    let deductionDocId: number | undefined;
    let receiptElemCount = 0;
    let deductionElemCount = 0;
    const plannedStockMap = new Map<string, number>();
    let storesList: BitrixStore[] = [];
    const customTitle = (effectiveMapping && (effectiveMapping as any).documentTitle && String((effectiveMapping as any).documentTitle).trim()) ||
                        (importJob.mappingJson && (importJob.mappingJson as any).documentTitle && String((importJob.mappingJson as any).documentTitle).trim()) ||
                        undefined;
    const cleanFileName = importJob.fileName.replace(/\.[^/.]+$/, '').trim();
    const docTitle = customTitle || cleanFileName;
    const hasInventoryStock = importType === 'STOCK_RECEIPTS' || !!effectiveMapping.quantityField || !!effectiveMapping.quantityArrivedField || !!effectiveMapping.qtyInStockField;

    if (hasInventoryStock) {
      try {
        const client = await BitrixClient.fromDbConfiguration(importJob.createdById || undefined);
        const stockReceiptService = new BitrixStockReceiptService(client);
        storesList = await stockReceiptService.getStores();
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'Failed to fetch stores list; defaulting to primary store');
      }
    }

    const getOrCreateReceiptDoc = async (): Promise<number> => {
      if (!receiptDocId) {
        const client = await BitrixClient.fromDbConfiguration(importJob.createdById || undefined);
        const stockReceiptService = new BitrixStockReceiptService(client);
        const doc = await stockReceiptService.createStockReceiptDocument(
          `${docTitle} (Adjustment +)`,
          `Stock replacement upward adjustment for import job ${importJobId}`,
          undefined,
          undefined,
          'S'
        );
        receiptDocId = doc.id;
        logger.info(`Created Bitrix stock receipt document ID ${receiptDocId} for job ${importJobId}`);
      }
      return receiptDocId;
    };

    const getOrCreateDeductionDoc = async (): Promise<number> => {
      if (!deductionDocId) {
        const client = await BitrixClient.fromDbConfiguration(importJob.createdById || undefined);
        const stockReceiptService = new BitrixStockReceiptService(client);
        const doc = await stockReceiptService.createStockReceiptDocument(
          `${docTitle} (Adjustment -)`,
          `Stock replacement downward adjustment (write-off) for import job ${importJobId}`,
          undefined,
          undefined,
          'D'
        );
        deductionDocId = doc.id;
        logger.info(`Created Bitrix stock deduction document ID ${deductionDocId} for job ${importJobId}`);
      }
      return deductionDocId;
    };

    const stockAdjustmentContext: StockAdjustmentContext = {
      docTitle,
      plannedStockMap,
      getOrCreateReceiptDoc,
      getOrCreateDeductionDoc,
      onElementAdded: (docType) => {
        if (docType === 'S') receiptElemCount++;
        else if (docType === 'D') deductionElemCount++;
      },
    };

    // Load pending records, draining the queue until none remain.
    // NOTE: skip is always 0 because processed records leave the PENDING set;
    // paginating with an accumulating offset skips live records and strands them.
    while (true) {
      const pendingRecords = await prisma.importRecord.findMany({
        where: {
          importJobId,
          status: 'PENDING',
        },
        orderBy: { rowNumber: 'asc' },
        skip: 0,
        take: BATCH_SIZE,
      });

      if (pendingRecords.length === 0) {
        break;
      }

      logger.info(`Processing batch of ${pendingRecords.length} records`);

      // Process each record asynchronously with controlled concurrency
      const concurrency = bitrixConfig.concurrency || 5;
      const seenCodes = new Set<string>();

      const worker = async (record: any): Promise<void> => {
        try {
          const rowData = extractRowData(record, effectiveMapping, importType);

          // Track duplicate rows within this import file (Requirement 2 & 8)
          const itemCode = (rowData.code || rowData.sku || record.sku || '').trim().toUpperCase();
          if (itemCode) {
            if (seenCodes.has(itemCode)) {
              await prisma.importJob.update({
                where: { id: importJobId },
                data: { duplicateRows: { increment: 1 } },
              });
            } else {
              seenCodes.add(itemCode);
            }
          }

          // Mark as processing
          await prisma.importRecord.update({
            where: { id: record.id },
            data: { status: 'PROCESSING' },
          });

          const result = hasInventoryStock
            ? await stockReceiptImportService.processRecord(rowData, effectiveMapping, importMode, stockAdjustmentContext, storesList, importJob.createdById || undefined)
            : importType === 'INVOICES'
              ? await invoiceImportService.processInvoiceRecord(rowData, effectiveMapping, importMode, importJob.createdById || undefined)
              : await importService.processRecord(rowData, effectiveMapping, importMode, importJob.createdById || undefined);

          const rec = result as any;

          await prisma.importRecord.update({
            where: { id: record.id },
            data: {
              status: result.status,
              ...(rec.actionTaken ? { actionTaken: rec.actionTaken } : {}),
              ...(rowData.partNumber ? { partNumber: rowData.partNumber } : {}),
              ...(rowData.description ? { description: rowData.description } : {}),
              ...(rowData.cost !== undefined ? { cost: rowData.cost } : {}),
              ...(rowData.dealerPrice !== undefined ? { dealerPrice: rowData.dealerPrice } : {}),
              ...(rowData.endUserPrice !== undefined ? { endUserPrice: rowData.endUserPrice } : {}),
              ...(rowData.qtyOnOrder !== undefined ? { qtyOnOrder: rowData.qtyOnOrder } : {}),
              ...(rowData.qtyInStock !== undefined ? { qtyInStock: rowData.qtyInStock } : {}),
              ...(rec.bitrixProductId ? { bitrixProductId: rec.bitrixProductId } : {}),
              ...(rec.bitrixDocumentId ? { bitrixDocumentId: rec.bitrixDocumentId } : {}),
              ...(rec.warehouseId !== undefined ? { warehouseId: rec.warehouseId } : {}),
              ...(rec.quantityArrived !== undefined ? { quantityArrived: rec.quantityArrived } : {}),
              ...(rec.purchasePrice !== undefined ? { purchasePrice: rec.purchasePrice } : {}),
              ...(rec.salesPrice !== undefined ? { salesPrice: rec.salesPrice } : {}),
              ...(result.errorMessage ? { errorMessage: result.errorMessage, errorType: classifyError(result.errorMessage) } : {}),
              ...(result.bitrixError ? { bitrixError: result.bitrixError } : {}),
            },
          });

          // Update job progress counters
          await prisma.importJob.update({
            where: { id: importJobId },
            data: {
              processedRows: { increment: 1 },
              successfulRows: { increment: result.status === 'SUCCESS' ? 1 : 0 },
              failedRows: { increment: (result.status === 'FAILED' || result.status === 'PARTIAL_FAILURE') ? 1 : 0 },
              skippedRows: { increment: result.status === 'SKIPPED' ? 1 : 0 },
              createdProductsCount: { increment: rec.actionTaken === 'CREATED' ? 1 : 0 },
              updatedProductsCount: { increment: rec.actionTaken === 'UPDATED' ? 1 : 0 },
            },
          });

          const key = importType === 'INVOICES' ? rowData.accountNumber || record.sku : record.sku;

          if (result.status === 'FAILED' || result.status === 'PARTIAL_FAILURE') {
            debugLog.warn('WORKER', `Record row ${record.rowNumber} (${key}): ${result.status}`, {
              importJobId,
              rowNumber: record.rowNumber,
              key,
              errorMessage: result.errorMessage,
              bitrixError: result.bitrixError,
            });
          }

          logger.info(`Processed record ${key} (row ${record.rowNumber}): ${result.status}`);
        } catch (error) {
          logger.error({ err: error }, `Failed to process record ${record.id}`);
          const errMessage = error instanceof Error ? error.message : 'Unknown error';

          debugLog.error('WORKER', `Unexpected error on record row ${record.rowNumber}: ${errMessage}`, {
            importJobId,
            rowNumber: record.rowNumber,
            recordId: record.id,
          });

          await prisma.importRecord.update({
            where: { id: record.id },
            data: {
              status: 'FAILED',
              errorMessage: errMessage,
            },
          });

          await prisma.importJob.update({
            where: { id: importJobId },
            data: {
              processedRows: { increment: 1 },
              failedRows: { increment: 1 },
            },
          });
        }
      };

      // Process with concurrency control
      for (let i = 0; i < pendingRecords.length; i += concurrency) {
        const chunk = pendingRecords.slice(i, i + concurrency);
        await Promise.all(chunk.map(worker));
      }
    }

    // Reconciliation: records left PENDING/PROCESSING mean the run was interrupted
    const stuck = await prisma.importRecord.updateMany({
      where: {
        importJobId,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      data: {
        status: 'FAILED',
        errorMessage: 'Worker interrupted before this record was processed. Use Retry to continue.',
      },
    });

    if (stuck.count > 0) {
      await prisma.importJob.update({
        where: { id: importJobId },
        data: { failedRows: { increment: stuck.count }, processedRows: { increment: stuck.count } },
      });
    }

    // Conduct stock adjustment documents in Bitrix24 if applicable
    let conductionError: string | undefined;
    if (hasInventoryStock) {
      try {
        const client = await BitrixClient.fromDbConfiguration(importJob.createdById || undefined);
        const stockReceiptService = new BitrixStockReceiptService(client);
        const conductedDocs: number[] = [];

        // Helper to set total headers and conduct document
        const finalizeDoc = async (docId: number, count: number, typeLabel: string) => {
          if (count > 0) {
            try {
              const elemRes = await client.callMethod('catalog.document.element.list', {
                filter: { docId: Number(docId) }
              });
              const elems = (elemRes && (elemRes.documentElements || elemRes.result || elemRes)) || [];
              if (Array.isArray(elems) && elems.length > 0) {
                const docTotal = elems.reduce((acc: number, el: any) => {
                  const amt = Number(el.amount) || 0;
                  const price = Number(el.purchasingPrice) || 0;
                  return acc + (amt * price);
                }, 0);

                const docFields: any = {};
                if (docTotal > 0) docFields.total = docTotal;
                docFields.commentary = `${typeLabel}: ${docTitle} (${elems.length} items adjusted)`;
                await client.callMethod('catalog.document.update', {
                  id: Number(docId),
                  fields: docFields,
                });
              }
            } catch (totErr: any) {
              logger.warn({ err: totErr }, `Could not set document header total for doc ${docId}`);
            }

            const conductRes = await stockReceiptService.conductDocument(docId);
            if (conductRes.success) {
              conductedDocs.push(docId);
              logger.info(`Conducted Bitrix inventory document (${typeLabel}) ID ${docId}`);
              debugLog.info('WORKER', `Conducted Bitrix inventory document (${typeLabel}) ID ${docId}`);
            } else {
              const errStr = `Could not conduct Bitrix inventory document ID ${docId}: ${conductRes.error}`;
              logger.error(errStr);
              debugLog.error('WORKER', errStr);
              conductionError = conductRes.error || errStr;
            }
          } else {
            // Delete unused draft document
            await stockReceiptService.deleteDocument(docId);
          }
        };

        if (receiptDocId) {
          await finalizeDoc(receiptDocId, receiptElemCount, 'Stock Replacement (+) Receipt');
        }
        if (deductionDocId) {
          await finalizeDoc(deductionDocId, deductionElemCount, 'Stock Replacement (-) Deduction');
        }

        if (conductedDocs.length > 0) {
          await prisma.importJob.update({
            where: { id: importJobId },
            data: { bitrixDocumentId: conductedDocs.join(', ') },
          });
        }
      } catch (err: any) {
        logger.error({ err }, 'Error during stock adjustment document conduction');
        conductionError = err.message || 'Stock document conduction error';
      }
    }

    // Determine final job status
    const [successCount, failedCount, skippedCount, partialCount, createdCount, updatedCount] = await Promise.all([
      prisma.importRecord.count({ where: { importJobId, status: 'SUCCESS' } }),
      prisma.importRecord.count({ where: { importJobId, status: 'FAILED' } }),
      prisma.importRecord.count({ where: { importJobId, status: 'SKIPPED' } }),
      prisma.importRecord.count({ where: { importJobId, status: 'PARTIAL_FAILURE' } }),
      prisma.importRecord.count({ where: { importJobId, actionTaken: 'CREATED', status: { in: ['SUCCESS', 'PARTIAL_FAILURE'] } } }),
      prisma.importRecord.count({ where: { importJobId, actionTaken: 'UPDATED', status: { in: ['SUCCESS', 'PARTIAL_FAILURE'] } } }),
    ]);

    let finalStatus = 'COMPLETED';
    if (failedCount > 0 || partialCount > 0 || conductionError) {
      finalStatus = 'COMPLETED_WITH_ERRORS';
    }

    await prisma.importJob.update({
      where: { id: importJobId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        successfulRows: successCount,
        failedRows: failedCount + partialCount,
        skippedRows: skippedCount,
        processedRows: successCount + failedCount + skippedCount + partialCount,
        createdProductsCount: createdCount,
        updatedProductsCount: updatedCount,
      },
    });

    logger.info(`Import job ${importJobId} completed with status: ${finalStatus}`);
    debugLog.info('WORKER', `Import job ${importJobId} completed (${finalStatus})`, {
      importJobId,
      finalStatus,
      success: successCount,
      failed: failedCount,
      skipped: skippedCount,
      partial: partialCount,
      stuckReconciled: stuck.count,
    });

    // Clean up uploaded file after processing
    try {
      if (importJob.filePath && fs.existsSync(importJob.filePath)) {
        fs.unlinkSync(importJob.filePath);
      }
    } catch {
      logger.warn(`Failed to clean up file for import ${importJobId}`);
    }
  } catch (error) {
    logger.error({ err: error }, `Import job ${importJobId} failed`);
    debugLog.error('WORKER', `Import job ${importJobId} failed: ${(error as Error).message}`, {
      importJobId,
      importType,
      errorMessage: (error as Error).message,
    });
    await prisma.importJob.update({
      where: { id: importJobId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
      },
    }).catch(() => {});
    throw error;
  }
}

export function startImportWorker(): void {
  if (activeWorker) {
    logger.warn('Import worker already running, skipping duplicate start');
    return;
  }

  activeWorker = createImportWorker(processJob);
  logger.info('Import worker started');
  debugLog.info('WORKER', 'Import worker started');
}

export async function stopImportWorker(): Promise<void> {
  if (!activeWorker) {
    return;
  }

  const worker = activeWorker;
  activeWorker = null;

  await worker.close();
  logger.info('Import worker stopped');
}