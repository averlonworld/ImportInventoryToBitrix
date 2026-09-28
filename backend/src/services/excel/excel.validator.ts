import { ExcelRow } from '../../types';
import { logger } from '../../utils/logger';

export interface ValidationError {
  rowNumber: number;
  sku?: string;
  errors: string[];
}

export interface ValidationResult {
  valid: boolean;
  validRows: ExcelRow[];
  invalidRows: Array<ExcelRow & { _errors: string[] }>;
  errors: ValidationError[];
  duplicates: Array<{ sku: string; rows: number[] }>;
  totalRows: number;
  validCount: number;
  invalidCount: number;
}

interface MappingFields {
  skuField: string;
  nameField: string;
  quantityField?: string;
  priceField?: string;
  barcodeField?: string;
}

interface InvoiceMappingFields {
  accountNumberField: string;
  orderTopicField?: string;
  amountField?: string;
  currencyField?: string;
  statusField?: string;
  billDateField?: string;
  dueDateField?: string;
  commentField?: string;
}

export interface InvoiceValidationResult {
  valid: boolean;
  validRows: ExcelRow[];
  invalidRows: Array<ExcelRow & { _errors: string[] }>;
  errors: ValidationError[];
  duplicates: Array<{ accountNumber: string; rows: number[] }>;
  totalRows: number;
  validCount: number;
  invalidCount: number;
}

export class ExcelValidator {
  validate(rows: ExcelRow[], mapping: MappingFields): ValidationResult {
    const validRows: ExcelRow[] = [];
    const invalidRows: Array<ExcelRow & { _errors: string[] }> = [];
    const errors: ValidationError[] = [];
    const skuMap = new Map<string, number[]>();

    rows.forEach(row => {
      const rowNumber = Number(row._rowNumber);
      const rowErrors: string[] = [];

      const sku = this.getFieldValue(row, mapping.skuField);
      const name = this.getFieldValue(row, mapping.nameField);
      const quantity = mapping.quantityField ? this.getFieldValue(row, mapping.quantityField) : undefined;
      const price = mapping.priceField ? this.getFieldValue(row, mapping.priceField) : undefined;

      // Required SKU
      if (!sku || String(sku).trim() === '') {
        rowErrors.push(`${mapping.skuField || 'SKU'} is required.`);
      }

      // Required Product Name
      if (!name || String(name).trim() === '') {
        rowErrors.push(`${mapping.nameField || 'Product Name'} is required.`);
      }

      // Quantity must be numeric and >= 0
      if (quantity !== undefined && quantity !== '') {
        const qtyNum = Number(quantity);
        if (isNaN(qtyNum)) {
          rowErrors.push(`${mapping.quantityField} must be numeric.`);
        } else if (qtyNum < 0) {
          rowErrors.push(`${mapping.quantityField} cannot be negative.`);
        }
      }

      // Price must be numeric and >= 0
      if (price !== undefined && price !== '') {
        const priceNum = Number(price);
        if (isNaN(priceNum)) {
          rowErrors.push(`${mapping.priceField} must be numeric.`);
        } else if (priceNum < 0) {
          rowErrors.push(`${mapping.priceField} cannot be negative.`);
        }
      }

      // Track duplicate SKUs
      if (sku && String(sku).trim() !== '') {
        const skuStr = String(sku).trim();
        if (skuMap.has(skuStr)) {
          skuMap.get(skuStr)!.push(rowNumber);
        } else {
          skuMap.set(skuStr, [rowNumber]);
        }
      }

      if (rowErrors.length > 0) {
        invalidRows.push({ ...row, _errors: rowErrors });
        errors.push({ rowNumber, sku: sku ? String(sku) : undefined, errors: rowErrors });
      } else {
        validRows.push(row);
      }
    });

    // Detect duplicates
    const duplicates: Array<{ sku: string; rows: number[] }> = [];
    skuMap.forEach((rows, sku) => {
      if (rows.length > 1) {
        duplicates.push({ sku, rows });
      }
    });

    return {
      valid: invalidRows.length === 0,
      validRows,
      invalidRows,
      errors,
      duplicates,
      totalRows: rows.length,
      validCount: validRows.length,
      invalidCount: invalidRows.length,
    };
  }

  private getFieldValue(row: ExcelRow, field: string): any {
    if (!field) return undefined;

    // Try exact match
    if (row[field] !== undefined) return row[field];

    // Try case-insensitive match
    const lower = field.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lower && key !== '_rowNumber') {
        return row[key];
      }
    }

    return undefined;
  }

  validateInvoice(rows: ExcelRow[], mapping: InvoiceMappingFields): InvoiceValidationResult {
    const validRows: ExcelRow[] = [];
    const invalidRows: Array<ExcelRow & { _errors: string[] }> = [];
    const errors: ValidationError[] = [];
    const numberMap = new Map<string, number[]>();

    rows.forEach(row => {
      const rowNumber = Number(row._rowNumber);
      const rowErrors: string[] = [];

      const accountNumber = this.getFieldValue(row, mapping.accountNumberField);
      const amount = mapping.amountField ? this.getFieldValue(row, mapping.amountField) : undefined;

      if (!accountNumber || String(accountNumber).trim() === '') {
        rowErrors.push(`${mapping.accountNumberField || 'Invoice Number'} is required.`);
      }

      if (amount !== undefined && amount !== '') {
        const amountNum = Number(amount);
        if (isNaN(amountNum)) {
          rowErrors.push(`${mapping.amountField} must be numeric.`);
        } else if (amountNum < 0) {
          rowErrors.push(`${mapping.amountField} cannot be negative.`);
        }
      }

      if (accountNumber && String(accountNumber).trim() !== '') {
        const numStr = String(accountNumber).trim();
        if (numberMap.has(numStr)) {
          numberMap.get(numStr)!.push(rowNumber);
        } else {
          numberMap.set(numStr, [rowNumber]);
        }
      }

      if (rowErrors.length > 0) {
        invalidRows.push({ ...row, _errors: rowErrors });
        errors.push({ rowNumber, sku: accountNumber ? String(accountNumber) : undefined, errors: rowErrors });
      } else {
        validRows.push(row);
      }
    });

    const duplicates: Array<{ accountNumber: string; rows: number[] }> = [];
    numberMap.forEach((rows, accountNumber) => {
      if (rows.length > 1) {
        duplicates.push({ accountNumber, rows });
      }
    });

    return {
      valid: invalidRows.length === 0,
      validRows,
      invalidRows,
      errors,
      duplicates,
      totalRows: rows.length,
      validCount: validRows.length,
      invalidCount: invalidRows.length,
    };
  }

  validateStockReceipt(rows: ExcelRow[], mapping: StockReceiptMappingValidationFields): ValidationResult {
    const validRows: ExcelRow[] = [];
    const invalidRows: Array<ExcelRow & { _errors: string[] }> = [];
    const errors: ValidationError[] = [];
    const skuMap = new Map<string, number[]>();

    rows.forEach(row => {
      const rowNumber = Number(row._rowNumber);
      const rowErrors: string[] = [];

      const name = mapping.nameField ? this.getFieldValue(row, mapping.nameField) : undefined;
      const sku = mapping.skuField ? this.getFieldValue(row, mapping.skuField) : undefined;
      const code = mapping.codeField ? this.getFieldValue(row, mapping.codeField) : undefined;
      const description = mapping.descriptionField ? this.getFieldValue(row, mapping.descriptionField) : undefined;
      const quantityArrived = mapping.quantityArrivedField ? this.getFieldValue(row, mapping.quantityArrivedField) : undefined;
      const purchasePrice = mapping.purchasePriceField ? this.getFieldValue(row, mapping.purchasePriceField) : undefined;
      const salesPrice = mapping.salesPriceField ? this.getFieldValue(row, mapping.salesPriceField) : undefined;
      const total = mapping.totalField ? this.getFieldValue(row, mapping.totalField) : undefined;
      const quantityDestination = mapping.quantityDestinationField ? this.getFieldValue(row, mapping.quantityDestinationField) : undefined;

      const hasName = name && String(name).trim() !== '';
      const hasSku = (sku && String(sku).trim() !== '') || (code && String(code).trim() !== '');

      if (!hasName && !hasSku) {
        rowErrors.push('Either Product Name / Part Number or CODE / SKU is required.');
      }

      if (mapping.descriptionField && (!description || String(description).trim() === '')) {
        rowErrors.push(`${mapping.descriptionField} (Description) is mandatory.`);
      }

      if (quantityArrived === undefined || quantityArrived === '' || quantityArrived === null) {
        rowErrors.push(`${mapping.quantityArrivedField || 'Quantity Arrived'} is required.`);
      } else {
        const qtyNum = Number(quantityArrived);
        if (isNaN(qtyNum)) {
          rowErrors.push(`${mapping.quantityArrivedField} must be numeric.`);
        } else if (qtyNum < 0) {
          rowErrors.push(`${mapping.quantityArrivedField} cannot be negative.`);
        }
      }

      if (purchasePrice !== undefined && purchasePrice !== '' && purchasePrice !== null) {
        const num = Number(purchasePrice);
        if (isNaN(num)) {
          rowErrors.push(`${mapping.purchasePriceField} must be numeric.`);
        } else if (num < 0) {
          rowErrors.push(`${mapping.purchasePriceField} cannot be negative.`);
        }
      }

      if (salesPrice !== undefined && salesPrice !== '' && salesPrice !== null) {
        const num = Number(salesPrice);
        if (isNaN(num)) {
          rowErrors.push(`${mapping.salesPriceField} must be numeric.`);
        } else if (num < 0) {
          rowErrors.push(`${mapping.salesPriceField} cannot be negative.`);
        }
      }

      if (total !== undefined && total !== '' && total !== null) {
        const num = Number(total);
        if (isNaN(num)) {
          rowErrors.push(`${mapping.totalField} must be numeric.`);
        } else if (num < 0) {
          rowErrors.push(`${mapping.totalField} cannot be negative.`);
        }
      }

      if (quantityDestination !== undefined && quantityDestination !== '' && quantityDestination !== null) {
        const num = Number(quantityDestination);
        if (isNaN(num)) {
          rowErrors.push(`${mapping.quantityDestinationField} must be numeric.`);
        }
      }

      const identifier = code || sku;
      if (identifier && String(identifier).trim() !== '') {
        const idStr = String(identifier).trim();
        if (skuMap.has(idStr)) {
          skuMap.get(idStr)!.push(rowNumber);
        } else {
          skuMap.set(idStr, [rowNumber]);
        }
      }

      if (rowErrors.length > 0) {
        invalidRows.push({ ...row, _errors: rowErrors });
        errors.push({ rowNumber, sku: identifier ? String(identifier) : undefined, errors: rowErrors });
      } else {
        validRows.push(row);
      }
    });

    const duplicates: Array<{ sku: string; rows: number[] }> = [];
    skuMap.forEach((rws, s) => {
      if (rws.length > 1) {
        duplicates.push({ sku: s, rows: rws });
      }
    });

    return {
      valid: invalidRows.length === 0,
      validRows,
      invalidRows,
      errors,
      duplicates,
      totalRows: rows.length,
      validCount: validRows.length,
      invalidCount: invalidRows.length,
    };
  }
}

export interface StockReceiptMappingValidationFields {
  skuField?: string;
  codeField?: string;
  nameField?: string;
  descriptionField?: string;
  barcodeField?: string;
  purchasePriceField?: string;
  salesPriceField?: string;
  quantityArrivedField?: string;
  warehouseField?: string;
  quantityDestinationField?: string;
  totalField?: string;
  defaultStoreId?: number;
}

export const excelValidator = new ExcelValidator();
