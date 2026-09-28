import { Router } from 'express';
import { bitrixController } from '../controllers/bitrix.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Public webhook endpoint for Bitrix24 Outgoing Webhooks (ONCRMQUOTEADD / ONCRMDEALADD)
router.post('/quote-pricing/webhook', bitrixController.handleQuotationWebhook);

// Protected endpoints for portal users
router.use(authMiddleware);

router.get('/catalogs', bitrixController.getCatalogs);
router.get('/products/fields', bitrixController.getProductFields);
router.get('/inventory/fields', bitrixController.getInventoryFields);
router.get('/stores', bitrixController.getStores);
router.get('/invoice-fields', bitrixController.getInvoiceFields);
router.get('/stock-receipt-fields', bitrixController.getStockReceiptFields);

// Quotation & Customer-Tier Pricing routes
router.get('/quote-pricing/products', bitrixController.getQuotationProducts);
router.post('/quote-pricing/apply', bitrixController.applyQuotationPricing);
router.get('/quote-pricing/config', bitrixController.getQuotationConfig);

export default router;
