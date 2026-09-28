import { Response, NextFunction } from 'express';
import { BitrixClient } from '../services/bitrix/BitrixClient';
import { BitrixCatalogService, BitrixProductService, BitrixInventoryService } from '../services/bitrix/BitrixCatalogService';
import { BitrixInvoiceService } from '../services/bitrix/BitrixInvoiceService';
import { BitrixStockReceiptService, STOCK_RECEIPT_CORE_FIELDS } from '../services/bitrix/BitrixStockReceiptService';
import { AuthenticatedRequest } from '../types';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';

export class BitrixController {
  async getCatalogs(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const client = await BitrixClient.fromDbConfiguration();
      const service = new BitrixCatalogService(client);
      const catalogs = await service.getCatalogs();
      res.json({ success: true, data: catalogs });
    } catch (error) {
      next(error);
    }
  }

  async getProductFields(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const client = await BitrixClient.fromDbConfiguration();
      const service = new BitrixCatalogService(client);
      const fields = await service.getProductFields();
      res.json({ success: true, data: fields });
    } catch (error) {
      next(error);
    }
  }

  async getInventoryFields(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const client = await BitrixClient.fromDbConfiguration();
      const service = new BitrixCatalogService(client);
      const fields = await service.getInventoryFields();
      res.json({ success: true, data: fields });
    } catch (error) {
      next(error);
    }
  }

  async getStores(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const client = await BitrixClient.fromDbConfiguration();
      const service = new BitrixCatalogService(client);
      const stores = await service.getStores();
      res.json({ success: true, data: stores });
    } catch (error) {
      next(error);
    }
  }

  async getEndpointInfo(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const client = await BitrixClient.fromDbConfiguration();
      const test = await client.testConnection(client['instance']?.defaults?.baseURL || '');
      res.json({ success: true, data: { reachable: test } });
    } catch (error) {
      next(error);
    }
  }

  async getInvoiceFields(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({
        success: true,
        data: {
          fields: BitrixInvoiceService.getFields(),
          statuses: BitrixInvoiceService.getStatusOptions(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getStockReceiptFields(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      try {
        const client = await BitrixClient.fromDbConfiguration();
        const service = new BitrixStockReceiptService(client);
        const discovery = await service.getDiscoveryFields();
        res.json({
          success: true,
          data: discovery,
        });
      } catch (err: any) {
        logger.info({ msg: err.message }, 'Returning default stock receipt fields (Bitrix offline or unconfigured)');
        res.json({
          success: true,
          data: {
            stockReceiptFields: STOCK_RECEIPT_CORE_FIELDS,
            catalogFields: [],
            stores: [],
            currency: 'USD',
            configured: false,
          },
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async getQuotationProducts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const client = await BitrixClient.fromDbConfiguration();
      const quotationService = new (await import('../services/bitrix/BitrixQuotationService')).BitrixQuotationService(client);
      const search = req.query.search ? String(req.query.search) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 25;
      const products = await quotationService.getProductsForQuotation(search, limit);
      res.json({ success: true, data: products });
    } catch (error) {
      next(error);
    }
  }

  async applyQuotationPricing(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { entityId, entityType = 'quote', customerType } = req.body;
      if (!entityId) {
        throw new AppError('entityId is required', 400);
      }
      const client = await BitrixClient.fromDbConfiguration();
      const quotationService = new (await import('../services/bitrix/BitrixQuotationService')).BitrixQuotationService(client);
      const result = await quotationService.applyTierPricingToEntity(
        Number(entityId),
        entityType === 'deal' ? 'deal' : 'quote',
        customerType
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async handleQuotationWebhook(req: any, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = (req.body?.event || req.query?.event || '').toUpperCase();
      const fields = req.body?.data?.FIELDS || req.body?.FIELDS || req.query?.FIELDS || {};
      const id = fields.ID || req.body?.data?.ID || req.query?.ID;

      logger.info({ event, id }, 'Received Bitrix CRM Quotation webhook');

      if (id && (event.includes('QUOTE') || event.includes('DEAL'))) {
        const entityType = event.includes('DEAL') ? 'deal' : 'quote';
        try {
          const client = await BitrixClient.fromDbConfiguration();
          const quotationService = new (await import('../services/bitrix/BitrixQuotationService')).BitrixQuotationService(client);
          await quotationService.applyTierPricingToEntity(Number(id), entityType);
        } catch (err: any) {
          logger.warn({ err: err?.message, id, event }, 'Failed to process CRM webhook pricing tier');
        }
      }

      res.json({ success: true, message: 'Webhook received' });
    } catch (error) {
      next(error);
    }
  }

  async getQuotationConfig(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const host = req.get('host') || 'localhost:5000';
      const protocol = req.protocol || 'http';
      const webhookUrl = `${protocol}://${host}/api/bitrix/quote-pricing/webhook`;

      res.json({
        success: true,
        data: {
          webhookUrl,
          supportedEvents: ['ONCRMQUOTEADD', 'ONCRMQUOTEUPDATE', 'ONCRMDEALADD', 'ONCRMDEALUPDATE'],
          pricingRules: [
            {
              customerType: 'Dealer Customer',
              targetPrice: 'DEALER PRICE (Price Type ID: 4)',
              requiredFields: ['Product Code', 'Part Number', 'Description', 'Dealer Price'],
            },
            {
              customerType: 'End User Customer',
              targetPrice: 'END USER PRICE (Price Type ID: 6)',
              requiredFields: ['Quantity', 'Part Number', 'Description', 'End User Price'],
            },
          ],
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const bitrixController = new BitrixController();
