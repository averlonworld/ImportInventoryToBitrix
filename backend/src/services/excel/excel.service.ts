import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { logger } from '../../utils/logger';
import { AppError } from '../../middleware/error.middleware';
import { ExcelRow, ColumnMappingConfig } from '../../types';

export interface ParsedExcelData {
  fileName: string;
  fileSize: number;
  worksheetName: string;
  headers: string[];
  rows: ExcelRow[];
  totalRows: number;
  columnCount: number;
}

export class ExcelService {
  async parseFile(filePath: string, fileName: string, fileSize: number): Promise<ParsedExcelData> {
    const ext = path.extname(fileName).toLowerCase();

    if (ext === '.csv') {
      return this.parseCsv(filePath, fileName, fileSize);
    }

    if (ext === '.xlsx' || ext === '.xls') {
      return this.parseXlsx(filePath, fileName, fileSize);
    }

    throw new AppError(`Unsupported file format: ${ext}`, 400);
  }

  private async parseXlsx(filePath: string, fileName: string, fileSize: number): Promise<ParsedExcelData> {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.worksheets[0];

      if (!worksheet) {
        throw new AppError('Excel file contains no worksheets', 400);
      }

      const headers: string[] = [];
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        const header = String(cell.value ?? '').trim();
        if (header) headers.push(header);
      });

      if (headers.length === 0) {
        throw new AppError('Excel file has no headers in the first row', 400);
      }

      const rows: ExcelRow[] = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header row

        const excelRow: ExcelRow = {};
        let hasData = false;

        headers.forEach((header, idx) => {
          const cell = row.getCell(idx + 1);
          const textVal = cell.text ? String(cell.text).trim() : '';
          const rawVal = textVal || this.cellToString(cell.value).trim();
          excelRow[header] = rawVal;
          if (rawVal) hasData = true;
        });

        if (hasData) {
          rows.push({
            _rowNumber: rowNumber,
            ...excelRow,
          });
        }
      });

      return {
        fileName,
        fileSize,
        worksheetName: worksheet.name,
        headers,
        rows,
        totalRows: rows.length,
        columnCount: headers.length,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to parse Excel file');
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to parse Excel file. Ensure it is a valid .xlsx/.xls file', 400);
    }
  }

  private async parseCsv(filePath: string, fileName: string, fileSize: number): Promise<ParsedExcelData> {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = this.parseCsvText(raw);

      const headers = (parsed[0] || []).map(h => String(h ?? '').trim()).filter(Boolean);

      if (headers.length === 0) {
        throw new AppError('CSV file has no headers in the first row', 400);
      }

      const rows: ExcelRow[] = [];
      for (let i = 1; i < parsed.length; i++) {
        const line = parsed[i];
        const excelRow: ExcelRow = {};
        let hasData = false;

        headers.forEach((header, idx) => {
          const value = line[idx] !== undefined ? line[idx] : '';
          // Preserve exact string values (leading zeros, formatting)
          excelRow[header] = value;
          if (value !== '') hasData = true;
        });

        if (hasData) {
          rows.push({ _rowNumber: i + 1, ...excelRow });
        }
      }

      return {
        fileName,
        fileSize,
        worksheetName: 'CSV Data',
        headers,
        rows,
        totalRows: rows.length,
        columnCount: headers.length,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to parse CSV file');
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to parse CSV file', 400);
    }
  }

  private parseCsvText(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(field);
        field = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && next === '\n') {
          i++;
        }
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += char;
      }
    }

    // Push last field/row if any content remains
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    // Filter out completely empty rows
    return rows.filter(r => r.length > 0 && r.some((cell: string) => cell.trim() !== ''));
  }

  private cellToString(value: any): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object' && value !== null) {
      if (value.text) return String(value.text);
      if (value.result) return String(value.result);
      return String(value);
    }
    // Preserve leading zeros: if it's a number but original was text with zeros, 
    // ExcelJS preserves text via .text, but for raw numbers we keep them as-is
    return String(value);
  }

  async generateErrorReport(
    records: Array<{ rowNumber: number; sku: string; partNumber?: string; productName: string; status: string; errorMessage: string }>
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Error Report');

    sheet.columns = [
      { header: 'Row', key: 'row', width: 10 },
      { header: 'CODE', key: 'code', width: 25 },
      { header: 'Part Number', key: 'partNumber', width: 25 },
      { header: 'Description / Product', key: 'product', width: 40 },
      { header: 'Import Status', key: 'status', width: 20 },
      { header: 'Error Reason', key: 'error', width: 50 },
    ];

    records.forEach(record => {
      sheet.addRow({
        row: record.rowNumber,
        code: record.sku,
        partNumber: record.partNumber || record.productName,
        product: record.productName,
        status: record.status,
        error: record.errorMessage,
      });
    });

    sheet.getRow(1).font = { bold: true };

    return workbook;
  }

  async generateTemplate(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Inventory');

    sheet.columns = [
      { header: 'SKU', key: 'sku', width: 20 },
      { header: 'Product Name', key: 'name', width: 40 },
      { header: 'Quantity', key: 'qty', width: 15 },
      { header: 'Price', key: 'price', width: 15 },
      { header: 'Barcode', key: 'barcode', width: 20 },
    ];

    sheet.addRow({ sku: '000123', name: 'Example Product A', qty: 100, price: 500, barcode: '8901234567890' });
    sheet.addRow({ sku: '000124', name: 'Example Product B', qty: 250, price: 700, barcode: '8901234567891' });

    sheet.getRow(1).font = { bold: true };

    return workbook;
  }
}

export const excelService = new ExcelService();
