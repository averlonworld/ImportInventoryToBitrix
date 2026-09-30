import fs from 'fs';
import path from 'path';
import os from 'os';
import { prisma } from '../../config/database';
import { excelService } from '../excel/excel.service';
import { excelValidator } from '../excel/excel.validator';
import { importQueue } from '../../queues/import.queue';
import { logger } from '../../utils/logger';
import { debugLog } from '../debug/debugLog.service';
import { env } from '../../config/env';

export interface DailySchedulerConfig {
  enabled: boolean;
  timeOfDay: string; // e.g. "02:00" (24h)
  feedFolderPath: string;
  autoArchive: boolean;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastFileName?: string | null;
  lastJobId?: string | null;
}

// In-memory scheduler config with default persistence
const FEED_DIR = path.resolve(os.tmpdir(), 'daily_feed');
const PROCESSED_DIR = path.resolve(FEED_DIR, 'processed');

let schedulerConfig: DailySchedulerConfig = {
  enabled: true,
  timeOfDay: '02:00',
  feedFolderPath: FEED_DIR,
  autoArchive: true,
  lastRunAt: null,
  lastRunStatus: null,
  lastFileName: null,
  lastJobId: null,
};

let timerHandle: NodeJS.Timeout | null = null;
let lastTriggerDateStr: string = '';

export class DailyImportScheduler {
  static ensureFolders(): void {
    try {
      if (!fs.existsSync(FEED_DIR)) {
        fs.mkdirSync(FEED_DIR, { recursive: true });
      }
      if (!fs.existsSync(PROCESSED_DIR)) {
        fs.mkdirSync(PROCESSED_DIR, { recursive: true });
      }
    } catch (err: any) {
      logger.error({ err: err?.message }, 'Failed to create daily_feed directories');
    }
  }

  static getConfig(): DailySchedulerConfig & { feedFileCount: number; pendingFiles: string[] } {
    this.ensureFolders();
    let pendingFiles: string[] = [];
    try {
      if (fs.existsSync(FEED_DIR)) {
        pendingFiles = fs
          .readdirSync(FEED_DIR)
          .filter((f) => !f.startsWith('.') && (f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv')));
      }
    } catch {
      pendingFiles = [];
    }

    return {
      ...schedulerConfig,
      feedFileCount: pendingFiles.length,
      pendingFiles,
    };
  }

  static updateConfig(partial: Partial<DailySchedulerConfig>): DailySchedulerConfig {
    schedulerConfig = {
      ...schedulerConfig,
      ...partial,
    };
    logger.info({ schedulerConfig }, 'Daily import scheduler configuration updated');
    debugLog.info('SETTINGS', `Daily import scheduler updated: enabled=${schedulerConfig.enabled}, time=${schedulerConfig.timeOfDay}`);
    return schedulerConfig;
  }

  /**
   * Scans the daily_feed directory for any waiting inventory files,
   * stages them, creates the ImportJob, and enqueues to BullMQ.
   */
  static async triggerImport(manualTriggerUserEmail?: string): Promise<{ success: boolean; jobId?: string; message: string }> {
    this.ensureFolders();

    const pending = fs
      .readdirSync(FEED_DIR)
      .filter((f) => !f.startsWith('.') && (f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv')));

    if (pending.length === 0) {
      schedulerConfig.lastRunAt = new Date().toISOString();
      schedulerConfig.lastRunStatus = 'NO_FILES';
      return {
        success: false,
        message: `No inventory files found in daily feed folder (${FEED_DIR}). Place a .xlsx or .csv file to import.`,
      };
    }

    // Pick the most recent file
    const sorted = pending
      .map((f) => ({
        name: f,
        fullPath: path.join(FEED_DIR, f),
        mtime: fs.statSync(path.join(FEED_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    const target = sorted[0];
    const fileName = target.name;
    const sourceFilePath = target.fullPath;
    const fileSize = fs.statSync(sourceFilePath).size;

    logger.info({ fileName, fileSize }, 'Daily Import Scheduler picked up inventory feed file');
    debugLog.info('IMPORT', `Daily Import Scheduler started for feed file: ${fileName}`, {
      fileName,
      fileSize,
      feedFolder: FEED_DIR,
    });

    try {
      // 1. Copy file to temporary directory so worker can process and clean up
      const destFileName = `daily_${Date.now()}_${fileName}`;
      const destFilePath = path.join(os.tmpdir(), destFileName);
      fs.copyFileSync(sourceFilePath, destFilePath);

      // 2. Parse file
      const parsed = await excelService.parseFile(destFilePath, fileName, fileSize);

      // 3. Auto-detect column headers for the 8 standard inventory fields
      const headers = parsed.headers || [];
      const clean = (s: string) => s.trim().toLowerCase();

      let codeField: string | undefined;
      let partNumberField: string | undefined;
      let descriptionField: string | undefined;
      let qtyInStockField: string | undefined;
      let qtyOnOrderField: string | undefined;
      let costField: string | undefined;
      let dealerPriceField: string | undefined;
      let endUserPriceField: string | undefined;
      let barcodeField: string | undefined;

      for (const h of headers) {
        const c = clean(h);
        if (!codeField && ['code', 'item code', 'product code', 'sku', 'product sku', 'item #', 'item_code'].includes(c)) codeField = h;
        if (!partNumberField && ['part number', 'part no', 'part_number', 'partno', 'part #', 'model', 'product name', 'product', 'item name', 'item', 'title', 'name'].includes(c)) partNumberField = h;
        if (!descriptionField && ['description', 'product description', 'item description', 'desc', 'details', 'specification'].includes(c)) descriptionField = h;
        if (!qtyInStockField && ['qty in stock', 'quantity in stock', 'in stock', 'qty', 'quantity', 'stock', 'qty arrived', 'quantity arrived'].includes(c)) qtyInStockField = h;
        if (!qtyOnOrderField && ['qty on order', 'quantity on order', 'on order', 'qty_on_order', 'order qty'].includes(c)) qtyOnOrderField = h;
        if (!costField && ['cost', 'cost ', 'purchase price', 'purchasing price', 'cost price', 'unit cost'].includes(c)) costField = h;
        if (!dealerPriceField && ['dealer price', 'dealer_price', 'dealer', 'wholesale price', 'b2b price'].includes(c)) dealerPriceField = h;
        if (!endUserPriceField && ['end user price', 'end_user_price', 'retail price', 'selling price', 'price', 'unit price'].includes(c)) endUserPriceField = h;
        if (!barcodeField && ['barcode', 'bar code', 'ean', 'upc', 'gtin'].includes(c)) barcodeField = h;
      }

      // Intelligent fallbacks
      const resolvedPartNumberField = partNumberField || headers.find(h => clean(h).includes('name') || clean(h).includes('product')) || codeField || 'PART NUMBER';
      const resolvedDescField = descriptionField || resolvedPartNumberField || 'DESCRIPTION';

      const mapping: any = {
        codeField: codeField || 'CODE',
        skuField: codeField || 'CODE',
        partNumberField: resolvedPartNumberField,
        nameField: resolvedPartNumberField,
        descriptionField: resolvedDescField,
        costField: costField || 'COST',
        purchasePriceField: costField || 'COST',
        dealerPriceField: dealerPriceField || 'DEALER PRICE',
        endUserPriceField: endUserPriceField || 'END USER PRICE',
        salesPriceField: endUserPriceField || 'END USER PRICE',
        qtyInStockField: qtyInStockField || 'QTY IN STOCK',
        quantityArrivedField: qtyInStockField || 'QTY IN STOCK',
        qtyOnOrderField: qtyOnOrderField || 'QTY ON ORDER',
        barcodeField,
        documentTitle: `Daily Stock Feed - ${new Date().toISOString().slice(0, 10)}`,
      };

      // 4. Validate
      const validation = excelValidator.validateStockReceipt(parsed.rows, {
        skuField: mapping.codeField,
        codeField: mapping.codeField,
        nameField: mapping.partNumberField,
        descriptionField: mapping.descriptionField,
        quantityArrivedField: mapping.qtyInStockField,
        purchasePriceField: mapping.costField,
        salesPriceField: mapping.endUserPriceField,
      });

      // 5. Find system or admin user
      const user = await prisma.user.findFirst({
        where: manualTriggerUserEmail ? { email: manualTriggerUserEmail } : { role: 'ADMIN' },
      });

      // 6. Create ImportJob
      const importJob = await prisma.importJob.create({
        data: {
          fileName: `[Daily Feed] ${fileName}`,
          filePath: destFilePath,
          importMode: 'CREATE_UPDATE',
          type: 'STOCK_RECEIPTS',
          status: 'PENDING',
          totalRows: parsed.totalRows,
          mappingJson: mapping,
          createdById: user?.id,
        },
      });

      // 7. Create ImportRecords
      const recordsData = parsed.rows.map((row) => {
        const numVal = (k?: string) => (k && row[k] !== undefined && row[k] !== '' && !isNaN(Number(row[k])) ? Number(row[k]) : null);
        const codeVal = mapping.codeField ? row[mapping.codeField] : null;
        const partNoVal = mapping.partNumberField ? row[mapping.partNumberField] : null;
        const descVal = mapping.descriptionField ? row[mapping.descriptionField] : null;

        const costVal = numVal(mapping.costField);
        const dealerVal = numVal(mapping.dealerPriceField);
        const endUserVal = numVal(mapping.endUserPriceField);
        const qtyStockVal = numVal(mapping.qtyInStockField);
        const qtyOrderVal = numVal(mapping.qtyOnOrderField);

        return {
          importJobId: importJob.id,
          rowNumber: Number(row._rowNumber),
          sku: codeVal ? String(codeVal) : null,
          productName: partNoVal ? String(partNoVal) : null,
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

      // 8. Queue in BullMQ
      await importQueue.add(
        'process-import',
        {
          importJobId: importJob.id,
          type: 'STOCK_RECEIPTS',
          mapping,
          importMode: 'CREATE_UPDATE',
        },
        {
          attempts: 1,
          removeOnComplete: false,
          removeOnFail: false,
        }
      );

      // 9. Auto-archive the source file if enabled
      if (schedulerConfig.autoArchive) {
        const archiveDest = path.join(PROCESSED_DIR, `${Date.now()}_${fileName}`);
        try {
          fs.renameSync(sourceFilePath, archiveDest);
        } catch {
          // ignore move errors
        }
      }

      schedulerConfig.lastRunAt = new Date().toISOString();
      schedulerConfig.lastRunStatus = 'QUEUED';
      schedulerConfig.lastFileName = fileName;
      schedulerConfig.lastJobId = importJob.id;

      logger.info({ importJobId: importJob.id }, 'Daily import job queued successfully');
      debugLog.info('IMPORT', `Daily import job ${importJob.id} queued (${parsed.totalRows} rows)`);

      return {
        success: true,
        jobId: importJob.id,
        message: `Daily inventory feed "${fileName}" with ${parsed.totalRows} rows enqueued successfully (Job: ${importJob.id}).`,
      };
    } catch (err: any) {
      schedulerConfig.lastRunAt = new Date().toISOString();
      schedulerConfig.lastRunStatus = 'ERROR';
      logger.error({ err }, 'Daily import processing failed');
      debugLog.error('IMPORT', `Daily import processing error: ${err.message}`);
      return {
        success: false,
        message: `Failed to process daily feed: ${err.message}`,
      };
    }
  }

  /**
   * Starts the cron polling loop (checks every 60 seconds)
   */
  static startScheduler(): void {
    if (timerHandle) return;

    this.ensureFolders();

    timerHandle = setInterval(async () => {
      if (!schedulerConfig.enabled) return;

      const now = new Date();
      const currentHours = String(now.getHours()).padStart(2, '0');
      const currentMinutes = String(now.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentHours}:${currentMinutes}`;
      const todayDateStr = now.toISOString().slice(0, 10);

      // Trigger once per day at the configured time
      if (currentTimeStr === schedulerConfig.timeOfDay && lastTriggerDateStr !== todayDateStr) {
        lastTriggerDateStr = todayDateStr;
        logger.info(`Scheduled daily inventory import firing at ${currentTimeStr}`);
        debugLog.info('WORKER', `Automated daily import triggered at scheduled time ${currentTimeStr}`);
        await this.triggerImport();
      }
    }, 60 * 1000);

    logger.info(`Daily import scheduler active (scheduled for ${schedulerConfig.timeOfDay} daily)`);
  }

  static stopScheduler(): void {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
      logger.info('Daily import scheduler stopped');
    }
  }
}
