import { Response, NextFunction, Request } from 'express';
import { prisma } from '../config/database';
import { excelService } from '../services/excel/excel.service';
import { excelValidator } from '../services/excel/excel.validator';
import { mappingService } from '../services/excel/mapping.service';
import { importQueue, ImportType } from '../queues/import.queue';
import { AuthenticatedRequest, ExcelRow } from '../types';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { debugLog } from '../services/debug/debugLog.service';
import { BitrixClient } from '../services/bitrix/BitrixClient';
import { BitrixStockReceiptService } from '../services/bitrix/BitrixStockReceiptService';
import { stockReceiptImportService } from '../services/import/stockReceiptImport.service';
import { importService } from '../services/import/import.service';
import { invoiceImportService } from '../services/import/invoiceImport.service';
import { extractRowData, classifyError } from '../services/import/import.worker';
import path from 'path';
import fs from 'fs';

export class ImportController {
  async upload(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const file = req.file;

      if (!file) {
        throw new AppError('No file uploaded', 400);
      }

      // Record the file path for the job
      res.status(201).json({
        success: true,
        data: {
          fileId: file.filename,
          fileName: file.originalname,
          fileSize: file.size,
          filePath: file.path,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async preview(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { filePath, fileName } = req.body;

      if (!filePath || !fileName) {
        throw new AppError('filePath and fileName are required', 400);
      }

      // Security: ensure the file path is within uploads dir
      const uploadDir = path.resolve(__dirname, '../../uploads');
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(uploadDir)) {
        throw new AppError('Invalid file path', 400);
      }

      if (!fs.existsSync(resolvedPath)) {
        throw new AppError('File not found or expired', 404);
      }

      const fileSize = fs.statSync(resolvedPath).size;
      const data = await excelService.parseFile(resolvedPath, fileName, fileSize);

      // Return preview data (first 50 rows)
      res.json({
        success: true,
        data: {
          ...data,
          rows: data.rows.slice(0, 50),
          totalRows: data.totalRows,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async createImportJob(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        filePath,
        fileName,
        fileSize,
        mapping,
        importMode,
        type,
        documentTitle,
      } = req.body;

      if (documentTitle && typeof documentTitle === 'string' && documentTitle.trim()) {
        if (mapping && typeof mapping === 'object') {
          mapping.documentTitle = documentTitle.trim();
        }
      }

      const importType: 'PRODUCTS' | 'INVOICES' | 'STOCK_RECEIPTS' =
        type === 'INVOICES' ? 'INVOICES' : type === 'STOCK_RECEIPTS' ? 'STOCK_RECEIPTS' : 'PRODUCTS';

      if (!filePath || !fileName) {
        throw new AppError('filePath and fileName are required', 400);
      }

      const uploadDir = path.resolve(__dirname, '../../uploads');
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(uploadDir)) {
        throw new AppError('Invalid file path', 400);
      }

      if (!fs.existsSync(resolvedPath)) {
        throw new AppError('File not found or expired', 404);
      }

      if (importType === 'PRODUCTS' && (!mapping || !mapping.skuField)) {
        throw new AppError('A SKU field mapping is required', 400);
      }

      if (importType === 'INVOICES' && (!mapping || !mapping.accountNumberField)) {
        throw new AppError('An Invoice Number field mapping is required', 400);
      }

      if (importType === 'STOCK_RECEIPTS' && (!mapping || (!mapping.nameField && !mapping.skuField))) {
        throw new AppError('A Product Name or SKU field mapping is required for Stock Receipt', 400);
      }

      if (importType === 'STOCK_RECEIPTS' && (!mapping || !mapping.quantityArrivedField)) {
        throw new AppError('A Quantity Arrived field mapping is required for Stock Receipt', 400);
      }

      const fileStat = fs.statSync(resolvedPath);
      const parsed = await excelService.parseFile(resolvedPath, fileName, fileStat.size);

      // Validate all rows
      const validation = importType === 'INVOICES'
        ? excelValidator.validateInvoice(parsed.rows, mapping)
        : importType === 'STOCK_RECEIPTS'
          ? excelValidator.validateStockReceipt(parsed.rows, {
              skuField: mapping.skuField || mapping.codeField,
              codeField: mapping.codeField || mapping.skuField,
              nameField: mapping.nameField || mapping.partNumberField,
              descriptionField: mapping.descriptionField,
              barcodeField: mapping.barcodeField,
              purchasePriceField: mapping.purchasePriceField || mapping.costField,
              salesPriceField: mapping.salesPriceField || mapping.endUserPriceField,
              quantityArrivedField: mapping.quantityArrivedField || mapping.qtyInStockField,
              warehouseField: mapping.warehouseField,
              quantityDestinationField: mapping.quantityDestinationField,
              totalField: mapping.totalField,
              defaultStoreId: mapping.defaultStoreId ? Number(mapping.defaultStoreId) : undefined,
            })
          : excelValidator.validate(parsed.rows, {
              skuField: mapping.skuField,
              nameField: mapping.nameField,
              quantityField: mapping.quantityField,
              priceField: mapping.priceField,
              barcodeField: mapping.barcodeField,
            });

      // Create import job
      const importJob = await prisma.importJob.create({
        data: {
          fileName,
          filePath: resolvedPath,
          importMode: (importMode || 'CREATE_UPDATE') as 'CREATE_ONLY' | 'CREATE_UPDATE' | 'UPDATE_ONLY',
          type: importType,
          status: 'PENDING',
          totalRows: parsed.totalRows,
          mappingJson: mapping as any,
          createdById: req.user!.id,
        },
      });

      // Create import records
      const recordsData = parsed.rows.map(row => {
        const numVal = (k?: string) => (k && row[k] !== undefined && row[k] !== '' && !isNaN(Number(row[k])) ? Number(row[k]) : null);
        const codeVal = mapping.codeField ? row[mapping.codeField] : (mapping.skuField ? row[mapping.skuField] : null);
        const partNoVal = mapping.partNumberField ? row[mapping.partNumberField] : (mapping.nameField ? row[mapping.nameField] : null);
        const descVal = mapping.descriptionField ? row[mapping.descriptionField] : (mapping.nameField ? row[mapping.nameField] : null);

        const costVal = numVal(mapping.costField) ?? numVal(mapping.purchasePriceField);
        const dealerVal = numVal(mapping.dealerPriceField);
        const endUserVal = numVal(mapping.endUserPriceField) ?? numVal(mapping.salesPriceField);
        const qtyStockVal = numVal(mapping.qtyInStockField) ?? numVal(mapping.quantityArrivedField) ?? numVal(mapping.quantityField);
        const qtyOrderVal = numVal(mapping.qtyOnOrderField);

        return {
          importJobId: importJob.id,
          rowNumber: Number(row._rowNumber),
          sku: importType === 'INVOICES'
            ? (row[mapping.accountNumberField] ? String(row[mapping.accountNumberField]) : null)
            : (codeVal ? String(codeVal) : null),
          productName: importType === 'INVOICES'
            ? (mapping.orderTopicField && row[mapping.orderTopicField] ? String(row[mapping.orderTopicField]) : null)
            : (partNoVal ? String(partNoVal) : null),
          partNumber: partNoVal ? String(partNoVal) : null,
          description: descVal ? String(descVal) : null,
          cost: costVal,
          dealerPrice: dealerVal,
          endUserPrice: endUserVal,
          qtyOnOrder: qtyOrderVal,
          qtyInStock: qtyStockVal,
          quantityArrived: qtyStockVal,
          purchasePrice: costVal,
          salesPrice: endUserVal,
          status: 'PENDING',
          rawData: row as any,
        };
      });

      await prisma.importRecord.createMany({
        data: recordsData,
      });

      // Queue the job
      let queuePayload: any;
      if (importType === 'STOCK_RECEIPTS') {
        queuePayload = {
          importJobId: importJob.id,
          type: 'STOCK_RECEIPTS',
          mapping: {
            codeField: mapping.codeField || mapping.skuField,
            skuField: mapping.skuField || mapping.codeField,
            partNumberField: mapping.partNumberField || mapping.nameField,
            nameField: mapping.nameField || mapping.partNumberField,
            descriptionField: mapping.descriptionField,
            costField: mapping.costField || mapping.purchasePriceField,
            purchasePriceField: mapping.purchasePriceField || mapping.costField,
            dealerPriceField: mapping.dealerPriceField,
            endUserPriceField: mapping.endUserPriceField || mapping.salesPriceField,
            salesPriceField: mapping.salesPriceField || mapping.endUserPriceField,
            qtyInStockField: mapping.qtyInStockField || mapping.quantityArrivedField || mapping.quantityField,
            quantityArrivedField: mapping.quantityArrivedField || mapping.qtyInStockField || mapping.quantityField,
            qtyOnOrderField: mapping.qtyOnOrderField,
            barcodeField: mapping.barcodeField,
            warehouseField: mapping.warehouseField,
            quantityDestinationField: mapping.quantityDestinationField,
            totalField: mapping.totalField,
            defaultStoreId: mapping.defaultStoreId ? Number(mapping.defaultStoreId) : undefined,
            documentTitle: mapping.documentTitle,
          },
          importMode: (importMode || 'CREATE_UPDATE') as 'CREATE_ONLY' | 'CREATE_UPDATE' | 'UPDATE_ONLY',
        };
      } else if (importType === 'INVOICES') {
        queuePayload = {
          importJobId: importJob.id,
          type: 'INVOICES',
          mapping: {
            accountNumberField: mapping.accountNumberField,
            orderTopicField: mapping.orderTopicField,
            clientField: mapping.clientField,
            amountField: mapping.amountField,
            currencyField: mapping.currencyField,
            statusField: mapping.statusField,
            billDateField: mapping.billDateField,
            dueDateField: mapping.dueDateField,
            commentField: mapping.commentField,
          },
          importMode: (importMode || 'CREATE_UPDATE') as 'CREATE_ONLY' | 'CREATE_UPDATE' | 'UPDATE_ONLY',
        };
      } else {
        queuePayload = {
          importJobId: importJob.id,
          type: 'PRODUCTS',
          mapping: {
            skuField: mapping.skuField,
            nameField: mapping.nameField,
            quantityField: mapping.quantityField,
            priceField: mapping.priceField,
            barcodeField: mapping.barcodeField,
          },
          importMode: (importMode || 'CREATE_UPDATE') as 'CREATE_ONLY' | 'CREATE_UPDATE' | 'UPDATE_ONLY',
        };
      }

      await importQueue.add('process-import', queuePayload, {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      });

      logger.info(`Import job created: ${importJob.id} (${importType})`);
      debugLog.info('IMPORT', `Import job created: ${fileName} (${importType})`, {
        importJobId: importJob.id,
        importMode: importMode || 'CREATE_UPDATE',
        totalRows: validation.totalRows,
        validRows: validation.validCount,
        invalidRows: validation.invalidCount,
      });

      res.status(201).json({
        success: true,
        data: {
          id: importJob.id,
          fileName: importJob.fileName,
          type: importType,
          status: importJob.status,
          totalRows: validation.totalRows,
          validRows: validation.validCount,
          invalidRows: validation.invalidCount,
          duplicates: validation.duplicates,
          validationErrors: validation.errors,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async listImports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, page = 1, limit = 20 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const where = status && status !== 'ALL' ? { status: String(status) } : {};

      const [imports, total] = await Promise.all([
        prisma.importJob.findMany({
          where,
          include: {
            createdBy: { select: { email: true } },
            _count: { select: { records: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: Number(limit),
        }),
        prisma.importJob.count({ where }),
      ]);

      res.json({
        success: true,
        data: imports,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      });
    } catch (error) {
      next(error);
    }
  }

  async getImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const importJob = await prisma.importJob.findUnique({
        where: { id },
        include: {
          createdBy: { select: { email: true } },
        },
      });

      if (!importJob) {
        throw new AppError('Import job not found', 404);
      }

      // Get counts by status
      const records = await prisma.importRecord.groupBy({
        by: ['status'],
        where: { importJobId: id },
        _count: { id: true },
      });

      const statusCounts: Record<string, number> = {};
      records.forEach(r => {
        statusCounts[r.status] = r._count.id;
      });

      res.json({
        success: true,
        data: {
          ...importJob,
          statusCounts,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getErrors(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const errors = await prisma.importRecord.findMany({
        where: {
          importJobId: id,
          status: { in: ['FAILED', 'PARTIAL_FAILURE'] },
        },
        orderBy: { rowNumber: 'asc' },
      });

      res.json({
        success: true,
        data: errors,
      });
    } catch (error) {
      next(error);
    }
  }

  async getErrorReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const errors = await prisma.importRecord.findMany({
        where: {
          importJobId: id,
          status: { in: ['FAILED', 'PARTIAL_FAILURE'] },
        },
        orderBy: { rowNumber: 'asc' },
      });

      const reportData = errors.map(e => ({
        rowNumber: e.rowNumber,
        sku: e.sku || '',
        partNumber: e.partNumber || e.productName || '',
        productName: e.description || e.productName || '',
        status: e.status,
        errorMessage: e.errorMessage || e.bitrixError || '',
      }));

      const workbook = await excelService.generateErrorReport(reportData);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="import_errors_${id}.xlsx"`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      next(error);
    }
  }

  async retryFailedRecords(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const importJob = await prisma.importJob.findUnique({ where: { id } });
      if (!importJob) {
        throw new AppError('Import job not found', 404);
      }

      // Update failed/partial/stuck-pending records back to PENDING
      const updated = await prisma.importRecord.updateMany({
        where: {
          importJobId: id,
          status: { in: ['FAILED', 'PARTIAL_FAILURE', 'PENDING'] },
        },
        data: {
          status: 'PENDING',
          errorMessage: null,
          bitrixError: null,
        },
      });

      // Reset job status
      await prisma.importJob.update({
        where: { id },
        data: {
          status: 'PENDING',
          failedRows: 0,
          processedRows: 0,
          startedAt: null,
          completedAt: null,
        },
      });

      // Re-queue
      await importQueue.add('process-import', {
        importJobId: id,
        type: (importJob.type || 'PRODUCTS') as 'PRODUCTS' | 'INVOICES' | 'STOCK_RECEIPTS',
        mapping: importJob.mappingJson as any,
        importMode: (importJob.importMode as 'CREATE_ONLY' | 'CREATE_UPDATE' | 'UPDATE_ONLY') || 'CREATE_UPDATE',
      }, {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      });

      logger.info(`Retrying ${updated.count} failed records for import ${id}`);
      debugLog.warn('IMPORT', `Retrying ${updated.count} records for import ${id}`, {
        importJobId: id,
        retriedCount: updated.count,
      });

      res.json({
        success: true,
        data: {
          retriedCount: updated.count,
          importJobId: id,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getImportRecords(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const {
        page = 1,
        limit = 50,
        status = 'ALL',
        search = '',
        errorType = 'ALL',
      } = req.query;

      const importJob = await prisma.importJob.findUnique({
        where: { id },
        include: { createdBy: { select: { email: true } } },
      });

      if (!importJob) {
        throw new AppError('Import job not found', 404);
      }

      // Build where filter for records
      const where: any = { importJobId: id };

      if (status && status !== 'ALL') {
        const s = String(status).toUpperCase();
        if (s === 'CREATED') {
          where.actionTaken = 'CREATED';
          where.status = { in: ['SUCCESS', 'PARTIAL_FAILURE'] };
        } else if (s === 'UPDATED') {
          where.actionTaken = 'UPDATED';
          where.status = { in: ['SUCCESS', 'PARTIAL_FAILURE'] };
        } else if (s === 'FAILED') {
          where.status = { in: ['FAILED', 'PARTIAL_FAILURE'] };
        } else {
          where.status = s;
        }
      }

      if (errorType && errorType !== 'ALL') {
        where.errorType = String(errorType);
      }

      if (search && String(search).trim()) {
        const s = String(search).trim();
        where.OR = [
          { sku: { contains: s, mode: 'insensitive' } },
          { partNumber: { contains: s, mode: 'insensitive' } },
          { productName: { contains: s, mode: 'insensitive' } },
          { description: { contains: s, mode: 'insensitive' } },
          { errorMessage: { contains: s, mode: 'insensitive' } },
          { bitrixError: { contains: s, mode: 'insensitive' } },
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);
      const take = Number(limit);

      const [records, totalFiltered, allRecordsForJob] = await Promise.all([
        prisma.importRecord.findMany({
          where,
          orderBy: { rowNumber: 'asc' },
          skip,
          take,
        }),
        prisma.importRecord.count({ where }),
        prisma.importRecord.groupBy({
          by: ['status', 'actionTaken'],
          where: { importJobId: id },
          _count: { id: true },
        }),
      ]);

      // Calculate live summary breakdown
      let processing = 0;
      let successful = 0;
      let created = 0;
      let updated = 0;
      let failed = 0;
      let skipped = 0;
      let retrying = 0;
      let pending = 0;
      let totalRecords = 0;

      allRecordsForJob.forEach((group: any) => {
        const cnt = group._count.id;
        totalRecords += cnt;
        if (group.status === 'PROCESSING') processing += cnt;
        else if (group.status === 'SUCCESS') {
          successful += cnt;
          if (group.actionTaken === 'CREATED') created += cnt;
          else if (group.actionTaken === 'UPDATED') updated += cnt;
        } else if (group.status === 'FAILED' || group.status === 'PARTIAL_FAILURE') {
          failed += cnt;
        } else if (group.status === 'SKIPPED') {
          skipped += cnt;
        } else if (group.status === 'RETRYING') {
          retrying += cnt;
        } else if (group.status === 'PENDING') {
          pending += cnt;
        }
      });

      const retryAggregate = await prisma.importRecord.aggregate({
        where: { importJobId: id },
        _sum: { retryCount: true },
      });
      const totalRetries = retryAggregate._sum.retryCount || 0;

      const duration = importJob.startedAt && importJob.completedAt
        ? Math.round((new Date(importJob.completedAt).getTime() - new Date(importJob.startedAt).getTime()) / 1000)
        : (importJob.startedAt ? Math.round((Date.now() - new Date(importJob.startedAt).getTime()) / 1000) : 0);

      res.json({
        success: true,
        data: {
          job: {
            id: importJob.id,
            fileName: importJob.fileName,
            status: importJob.status,
            type: importJob.type,
            totalRows: importJob.totalRows,
            processedRows: importJob.processedRows,
            createdAt: importJob.createdAt,
            startedAt: importJob.startedAt,
            completedAt: importJob.completedAt,
            createdBy: importJob.createdBy?.email || 'system',
            bitrixDocumentId: importJob.bitrixDocumentId,
            duration,
          },
          summary: {
            totalRecords: totalRecords || importJob.totalRows,
            processing,
            successful,
            created: created || importJob.createdProductsCount,
            updated: updated || importJob.updatedProductsCount,
            failed,
            skipped,
            retrying,
            pending,
            totalRetries,
          },
          records,
          pagination: {
            page: Number(page),
            limit: take,
            total: totalFiltered,
            totalPages: Math.ceil(totalFiltered / take),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async retrySingleRecord(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, recordId } = req.params;

      const record = await prisma.importRecord.findFirst({
        where: { id: recordId, importJobId: id },
        include: { importJob: true },
      });

      if (!record) {
        throw new AppError('Record not found for this import job', 404);
      }

      // Mark as RETRYING and increment retryCount
      await prisma.importRecord.update({
        where: { id: recordId },
        data: {
          status: 'RETRYING',
          retryCount: { increment: 1 },
          errorMessage: null,
          bitrixError: null,
        },
      });

      debugLog.info('IMPORT', `Retrying single record ID ${recordId} (Row ${record.rowNumber}, SKU ${record.sku})`, {
        importJobId: id,
        recordId,
        rowNumber: record.rowNumber,
        sku: record.sku,
        retryCount: (record.retryCount || 0) + 1,
      });

      const mapping = (record.importJob.mappingJson as any) || {};
      const importType = (record.importJob.type || 'STOCK_RECEIPTS') as ImportType;
      const rowData = extractRowData(record, mapping, importType);

      let result: any;
      try {
        const client = await BitrixClient.fromDbConfiguration();

        if (importType === 'STOCK_RECEIPTS') {
          const stockReceiptService = new BitrixStockReceiptService(client);
          const stores = await stockReceiptService.getStores();
          result = await stockReceiptImportService.processRecord(
            rowData,
            mapping,
            record.importJob.importMode,
            record.importJob.bitrixDocumentId ? Number(record.importJob.bitrixDocumentId) : undefined,
            stores
          );
        } else if (importType === 'INVOICES') {
          result = await invoiceImportService.processInvoiceRecord(rowData, mapping, record.importJob.importMode);
        } else {
          result = await importService.processRecord(rowData, mapping, record.importJob.importMode);
        }
      } catch (err: any) {
        result = {
          status: 'FAILED',
          errorMessage: err.message || 'Error executing retry on Bitrix24',
          errorType: classifyError(err.message),
        };
      }

      // Update record with outcome
      const updatedRecord = await prisma.importRecord.update({
        where: { id: recordId },
        data: {
          status: result.status,
          ...(result.actionTaken ? { actionTaken: result.actionTaken } : {}),
          ...(result.bitrixProductId ? { bitrixProductId: String(result.bitrixProductId) } : {}),
          ...(result.errorMessage ? { errorMessage: result.errorMessage } : { errorMessage: null }),
          ...(result.bitrixError ? { bitrixError: result.bitrixError } : { bitrixError: null }),
          errorType: result.status === 'FAILED' ? (result.errorType || classifyError(result.errorMessage)) : null,
        },
      });

      // Update importJob aggregate counters
      const [successCount, failedCount, partialCount, createdCount, updatedCount] = await Promise.all([
        prisma.importRecord.count({ where: { importJobId: id, status: 'SUCCESS' } }),
        prisma.importRecord.count({ where: { importJobId: id, status: 'FAILED' } }),
        prisma.importRecord.count({ where: { importJobId: id, status: 'PARTIAL_FAILURE' } }),
        prisma.importRecord.count({ where: { importJobId: id, actionTaken: 'CREATED', status: { in: ['SUCCESS', 'PARTIAL_FAILURE'] } } }),
        prisma.importRecord.count({ where: { importJobId: id, actionTaken: 'UPDATED', status: { in: ['SUCCESS', 'PARTIAL_FAILURE'] } } }),
      ]);

      await prisma.importJob.update({
        where: { id },
        data: {
          successfulRows: successCount,
          failedRows: failedCount + partialCount,
          createdProductsCount: createdCount,
          updatedProductsCount: updatedCount,
        },
      });

      res.json({
        success: true,
        data: updatedRecord,
      });
    } catch (error) {
      next(error);
    }
  }

  async getTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workbook = await excelService.generateTemplate();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="inventory_template.xlsx"');
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      next(error);
    }
  }

  async getDailySchedule(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { DailyImportScheduler } = await import('../services/schedule/dailyImport.scheduler');
      const config = DailyImportScheduler.getConfig();
      res.json({ success: true, data: config });
    } catch (error) {
      next(error);
    }
  }

  async updateDailySchedule(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { DailyImportScheduler } = await import('../services/schedule/dailyImport.scheduler');
      const updated = DailyImportScheduler.updateConfig(req.body);
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }

  async triggerDailyImport(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { DailyImportScheduler } = await import('../services/schedule/dailyImport.scheduler');
      const result = await DailyImportScheduler.triggerImport(req.user?.email);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const importController = new ImportController();
