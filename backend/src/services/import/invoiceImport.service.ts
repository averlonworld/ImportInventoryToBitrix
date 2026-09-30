import { BitrixClient } from '../bitrix/BitrixClient';
import { BitrixInvoiceService } from '../bitrix/BitrixInvoiceService';
import { logger } from '../../utils/logger';

export interface InvoiceRowData {
  accountNumber: string;
  orderTopic?: string;
  client?: string;
  amount?: number;
  currency?: string;
  status?: string;
  billDate?: string;
  dueDate?: string;
  comment?: string;
  [key: string]: any;
}

export type InvoiceResultStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'PARTIAL_FAILURE';

export interface InvoiceResult {
  status: InvoiceResultStatus;
  bitrixInvoiceId?: string;
  errorMessage?: string;
  bitrixError?: string;
}

export class InvoiceImportService {
  async processInvoiceRecord(
    rowData: InvoiceRowData,
    mapping: {
      accountNumberField: string;
      orderTopicField?: string;
      clientField?: string;
      amountField?: string;
      currencyField?: string;
      statusField?: string;
      billDateField?: string;
      dueDateField?: string;
      commentField?: string;
    },
    importMode: string,
    clientOrUserId?: BitrixClient | string
  ): Promise<InvoiceResult> {
    const accountNumber = rowData.accountNumber;

    if (!accountNumber) {
      return { status: 'SKIPPED', errorMessage: 'Missing invoice number' };
    }

    try {
      const client = clientOrUserId instanceof BitrixClient
        ? clientOrUserId
        : await BitrixClient.fromDbConfiguration(clientOrUserId);
      const invoiceService = new BitrixInvoiceService(client);

      const { fields, unsupported } = BitrixInvoiceService.normalizeFields({
        ACCOUNT_NUMBER: accountNumber,
        ORDER_TOPIC: rowData.orderTopic,
        CLIENT: rowData.client,
        PRICE: rowData.amount,
        CURRENCY: rowData.currency,
        STATUS_ID: rowData.status,
        DATE_BILL: rowData.billDate,
        DATE_PAY_BEFORE: rowData.dueDate,
        COMMENT: rowData.comment,
      });

      const existing = await invoiceService.findInvoiceByNumber(accountNumber);

      if (importMode === 'CREATE_ONLY' && existing) {
        return { status: 'SKIPPED', errorMessage: 'Invoice already exists (Create Only mode)' };
      }

      if (importMode === 'UPDATE_ONLY' && !existing) {
        return { status: 'SKIPPED', errorMessage: 'Invoice does not exist (Update Only mode)' };
      }

      let invoiceId: number;

      if (existing) {
        const updateFields: any = {};
        const existingId = existing.ID || existing.id;

        if (fields.ORDER_TOPIC && existing.ORDER_TOPIC !== fields.ORDER_TOPIC) updateFields.ORDER_TOPIC = fields.ORDER_TOPIC;
        if (fields.STATUS_ID && existing.STATUS_ID !== fields.STATUS_ID) updateFields.STATUS_ID = fields.STATUS_ID;
        if (fields.PRICE !== undefined && Number(existing.PRICE) !== Number(fields.PRICE)) updateFields.PRICE = fields.PRICE;
        if (fields.CURRENCY && existing.CURRENCY !== fields.CURRENCY) updateFields.CURRENCY = fields.CURRENCY;
        if (fields.DATE_BILL && existing.DATE_BILL !== fields.DATE_BILL) updateFields.DATE_BILL = fields.DATE_BILL;
        if (fields.DATE_PAY_BEFORE && existing.DATE_PAY_BEFORE !== fields.DATE_PAY_BEFORE) updateFields.DATE_PAY_BEFORE = fields.DATE_PAY_BEFORE;
        if (fields.COMMENT && existing.COMMENT !== fields.COMMENT) updateFields.COMMENT = fields.COMMENT;

        if (Object.keys(updateFields).length === 0) {
          return { status: 'SUCCESS', bitrixInvoiceId: String(existingId) };
        }

        const updated = await invoiceService.updateInvoice(Number(existingId), updateFields);
        if (!updated) {
          return {
            status: 'PARTIAL_FAILURE',
            bitrixInvoiceId: String(existingId),
            errorMessage: 'Invoice exists but could not be updated via Bitrix REST',
            bitrixError: 'Bitrix API error during crm.invoice.update',
          };
        }

        const notes = unsupported.length > 0 ? `Skipped unsupported values: ${unsupported.join('; ')}` : undefined;
        return {
          status: 'SUCCESS',
          bitrixInvoiceId: String(existingId),
          ...(notes ? { errorMessage: notes } : {}),
        };
      }

      const created = await invoiceService.createInvoice(fields);
      invoiceId = created;
      return { status: 'SUCCESS', bitrixInvoiceId: String(invoiceId) };
    } catch (error: any) {
      logger.error({ err: error }, `Invoice import record failed for ${accountNumber}`);

      const message = error && error.message ? error.message : 'Unknown error';
      const accessDenied = /access denied/i.test(message) || /permission/i.test(message);

      return {
        status: 'FAILED',
        errorMessage: accessDenied
          ? 'Bitrix webhook does not have permission to create invoices. Grant "Invoices" access to the webhook user in Bitrix24 settings.'
          : message,
        bitrixError: accessDenied ? 'crm.invoice.add: Access denied' : 'Bitrix API error',
      };
    }
  }
}

export const invoiceImportService = new InvoiceImportService();