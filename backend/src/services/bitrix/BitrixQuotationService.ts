import { BitrixClient } from './BitrixClient';
import { BitrixCatalogService } from './BitrixCatalogService';
import { logger } from '../../utils/logger';
import { debugLog } from '../debug/debugLog.service';

export type CustomerType = 'DEALER' | 'END_USER';

export interface QuotationProductItem {
  id: number;
  productCode: string;
  partNumber: string;
  description: string;
  dealerPrice: number;
  endUserPrice: number;
  cost?: number;
  qtyInStock?: number;
  qtyOnOrder?: number;
  currency: string;
}

export interface QuotePricingAdjustment {
  productId: number;
  productName: string;
  productCode: string;
  partNumber: string;
  description: string;
  originalPrice: number;
  appliedPrice: number;
  priceTypeUsed: 'DEALER_PRICE' | 'END_USER_PRICE';
  quantity: number;
  total: number;
}

export interface QuotePricingResult {
  success: boolean;
  entityId: number;
  entityType: 'quote' | 'deal';
  customerType: CustomerType;
  customerName?: string;
  adjustments: QuotePricingAdjustment[];
  totalAmount: number;
  message?: string;
}

export class BitrixQuotationService {
  private client: BitrixClient;

  constructor(client: BitrixClient) {
    this.client = client;
  }

  /**
   * Search and retrieve products from Bitrix24 Catalog with both Dealer and End User prices
   * so they can be selected directly in Quotation processes.
   */
  async getProductsForQuotation(query?: string, limit: number = 20): Promise<QuotationProductItem[]> {
    try {
      const catalogService = new BitrixCatalogService(this.client);
      const ctx = await catalogService.getCatalogContext();

      const filter: any = {};
      const trimmed = (query || '').trim();
      if (trimmed) {
        filter['%NAME'] = trimmed;
      }

      const crmRes = await this.client.callMethod('crm.product.list', {
        filter,
        select: ['ID', 'NAME', 'CODE', 'PRICE', 'DESCRIPTION', 'CURRENCY_ID'],
        order: { ID: 'DESC' },
        start: 0,
      });

      const list = Array.isArray(crmRes) ? crmRes : (crmRes && crmRes.result) || [];
      const sliced = list.slice(0, limit);

      const items: QuotationProductItem[] = [];

      for (const p of sliced) {
        const productId = Number(p.ID);

        // Fetch prices for this product
        let dealerPrice = Number(p.PRICE) || 0;
        let endUserPrice = Number(p.PRICE) || 0;
        let cost: number | undefined;

        try {
          const pricesRes = await this.client.callMethod('catalog.price.list', {
            filter: { productId },
          });
          const prices = (pricesRes && pricesRes.prices) || [];

          for (const pr of prices) {
            const groupId = Number(pr.catalogGroupId);
            const val = Number(pr.price);
            if (ctx.dealerPriceTypeId && groupId === ctx.dealerPriceTypeId) {
              dealerPrice = val;
            } else if (ctx.endUserPriceTypeId && groupId === ctx.endUserPriceTypeId) {
              endUserPrice = val;
            } else if (groupId === ctx.basePriceTypeId && !endUserPrice) {
              endUserPrice = val;
            }
          }
        } catch {
          // fallback to base price
        }

        // Fetch catalog stock & reserved
        let qtyInStock = 0;
        let qtyOnOrder = 0;
        try {
          const prodRes = await this.client.callMethod('catalog.product.get', { id: productId });
          const prodData = prodRes?.product || prodRes;
          if (prodData) {
            qtyInStock = Number(prodData.quantity || 0);
            qtyOnOrder = Number(prodData.quantityReserved || 0);
            if (prodData.purchasingPrice) cost = Number(prodData.purchasingPrice);
          }
        } catch {
          // fallback
        }

        items.push({
          id: productId,
          productCode: p.CODE || '',
          partNumber: p.NAME || '',
          description: p.DESCRIPTION || '',
          dealerPrice,
          endUserPrice,
          cost,
          qtyInStock,
          qtyOnOrder,
          currency: p.CURRENCY_ID || ctx.currency,
        });
      }

      return items;
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch quotation products');
      return [];
    }
  }

  /**
   * Determine customer type (Dealer vs End User) by inspecting the linked Company / Contact in Bitrix24
   */
  async resolveCustomerType(companyId?: number, contactId?: number): Promise<{ customerType: CustomerType; customerName: string }> {
    let customerType: CustomerType = 'END_USER';
    let customerName = 'Unknown Customer';

    // 1. Check Company first
    if (companyId && Number(companyId) > 0) {
      try {
        const compRes = await this.client.callMethod('crm.company.get', { id: Number(companyId) });
        const company = compRes?.company || compRes?.result || compRes;
        if (company) {
          customerName = company.TITLE || `Company #${companyId}`;
          const typeLower = (company.COMPANY_TYPE || '').toLowerCase();
          const commentsLower = (company.COMMENTS || '').toLowerCase();

          // Check if custom field UF_CRM_CUSTOMER_TYPE or COMPANY_TYPE contains "dealer"
          let customTypeVal = '';
          for (const [k, v] of Object.entries(company)) {
            if (k.toLowerCase().includes('customer_type') || k.toLowerCase().includes('client_type')) {
              customTypeVal = String(v || '').toLowerCase();
              break;
            }
          }

          if (
            typeLower.includes('dealer') ||
            typeLower.includes('distributor') ||
            typeLower.includes('wholesale') ||
            typeLower.includes('partner') ||
            customTypeVal.includes('dealer') ||
            commentsLower.includes('dealer')
          ) {
            customerType = 'DEALER';
          }
        }
      } catch (err: any) {
        logger.warn({ err: err?.message, companyId }, 'Failed to resolve company customer type');
      }
    }

    // 2. Check Contact if not already marked as Dealer
    if (customerType !== 'DEALER' && contactId && Number(contactId) > 0) {
      try {
        const contRes = await this.client.callMethod('crm.contact.get', { id: Number(contactId) });
        const contact = contRes?.contact || contRes?.result || contRes;
        if (contact) {
          if (customerName === 'Unknown Customer') {
            customerName = `${contact.NAME || ''} ${contact.LAST_NAME || ''}`.trim() || `Contact #${contactId}`;
          }
          const typeLower = (contact.TYPE_ID || '').toLowerCase();
          if (typeLower.includes('dealer') || typeLower.includes('wholesale') || typeLower.includes('partner')) {
            customerType = 'DEALER';
          }
        }
      } catch (err: any) {
        logger.warn({ err: err?.message, contactId }, 'Failed to resolve contact customer type');
      }
    }

    return { customerType, customerName };
  }

  /**
   * Applies Tiered Pricing (Dealer Price vs End User Price) to a Quote or Deal.
   * Requirement 10 & 11:
   *   Dealer Customer -> Dealer Price
   *   End User Customer -> End User Price
   */
  async applyTierPricingToEntity(
    entityId: number,
    entityType: 'quote' | 'deal' = 'quote',
    overrideCustomerType?: CustomerType
  ): Promise<QuotePricingResult> {
    const numId = Number(entityId);
    if (!numId || isNaN(numId)) {
      throw new Error(`Invalid ${entityType} ID: ${entityId}`);
    }

    debugLog.info('BITRIX', `Applying tiered pricing for ${entityType} ID ${numId}`);

    const catalogService = new BitrixCatalogService(this.client);
    const ctx = await catalogService.getCatalogContext();

    // 1. Fetch Entity details (Quote or Deal)
    const getMethod = entityType === 'quote' ? 'crm.quote.get' : 'crm.deal.get';
    const entityRes = await this.client.callMethod(getMethod, { id: numId });
    const entity = entityRes?.quote || entityRes?.deal || entityRes?.result || entityRes;

    if (!entity) {
      throw new Error(`${entityType.toUpperCase()} #${numId} not found in Bitrix24`);
    }

    const companyId = entity.COMPANY_ID ? Number(entity.COMPANY_ID) : undefined;
    const contactId = entity.CONTACT_ID ? Number(entity.CONTACT_ID) : undefined;

    // 2. Resolve Customer Type
    let customerType: CustomerType;
    let customerName: string;

    if (overrideCustomerType) {
      customerType = overrideCustomerType;
      customerName = `Manual Override (${overrideCustomerType})`;
    } else {
      const resolved = await this.resolveCustomerType(companyId, contactId);
      customerType = resolved.customerType;
      customerName = resolved.customerName;
    }

    // 3. Fetch Product Rows
    const rowsMethod = entityType === 'quote' ? 'crm.quote.productrows.get' : 'crm.deal.productrows.get';
    const rowsRes = await this.client.callMethod(rowsMethod, { id: numId });
    const rows = Array.isArray(rowsRes) ? rowsRes : (rowsRes && (rowsRes.productRows || rowsRes.result)) || [];

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        success: true,
        entityId: numId,
        entityType,
        customerType,
        customerName,
        adjustments: [],
        totalAmount: 0,
        message: 'No product rows attached to this quotation yet',
      };
    }

    // 4. Calculate adjusted product rows with corresponding price tier
    const adjustments: QuotePricingAdjustment[] = [];
    const newRows: any[] = [];
    let grandTotal = 0;

    for (const r of rows) {
      const productId = Number(r.PRODUCT_ID || r.productId);
      const originalPrice = Number(r.PRICE || r.price) || 0;
      const quantity = Number(r.QUANTITY || r.quantity) || 1;

      // Look up product metadata and prices from catalog
      let targetPrice = originalPrice;
      let productCode = '';
      let partNumber = r.PRODUCT_NAME || r.productName || '';
      let description = '';

      if (productId > 0) {
        try {
          const crmProdRes = await this.client.callMethod('crm.product.get', { id: productId });
          const prod = crmProdRes?.product || crmProdRes?.result || crmProdRes;
          if (prod) {
            productCode = prod.CODE || '';
            partNumber = prod.NAME || partNumber;
            description = prod.DESCRIPTION || '';
          }

          // Fetch prices
          const pricesRes = await this.client.callMethod('catalog.price.list', { filter: { productId } });
          const prices = (pricesRes && pricesRes.prices) || [];

          let dPrice: number | undefined;
          let ePrice: number | undefined;

          for (const pr of prices) {
            const gid = Number(pr.catalogGroupId);
            const val = Number(pr.price);
            if (ctx.dealerPriceTypeId && gid === ctx.dealerPriceTypeId) dPrice = val;
            if (ctx.endUserPriceTypeId && gid === ctx.endUserPriceTypeId) ePrice = val;
            if (gid === ctx.basePriceTypeId && ePrice === undefined) ePrice = val;
          }

          if (customerType === 'DEALER') {
            targetPrice = dPrice !== undefined ? dPrice : (Number(prod?.PRICE) || originalPrice);
          } else {
            targetPrice = ePrice !== undefined ? ePrice : (Number(prod?.PRICE) || originalPrice);
          }
        } catch (err: any) {
          logger.warn({ err: err?.message, productId }, 'Could not look up catalog price for product');
        }
      }

      const itemTotal = targetPrice * quantity;
      grandTotal += itemTotal;

      const priceTypeUsed = customerType === 'DEALER' ? 'DEALER_PRICE' : 'END_USER_PRICE';

      adjustments.push({
        productId,
        productName: partNumber,
        productCode,
        partNumber,
        description,
        originalPrice,
        appliedPrice: targetPrice,
        priceTypeUsed,
        quantity,
        total: itemTotal,
      });

      newRows.push({
        PRODUCT_ID: productId,
        PRODUCT_NAME: partNumber,
        PRICE: targetPrice,
        QUANTITY: quantity,
        DISCOUNT_SUM: 0,
      });
    }

    // 5. Update Product Rows on Quote/Deal
    const setRowsMethod = entityType === 'quote' ? 'crm.quote.productrows.set' : 'crm.deal.productrows.set';
    await this.client.callMethod(setRowsMethod, {
      id: numId,
      rows: newRows,
    });

    // 6. Update Entity Total
    const updateMethod = entityType === 'quote' ? 'crm.quote.update' : 'crm.deal.update';
    await this.client.callMethod(updateMethod, {
      id: numId,
      fields: {
        OPPORTUNITY: grandTotal,
      },
    });

    debugLog.info('BITRIX', `Updated ${entityType} ${numId} with ${customerType} pricing (${adjustments.length} items, total: ${grandTotal})`);

    return {
      success: true,
      entityId: numId,
      entityType,
      customerType,
      customerName,
      adjustments,
      totalAmount: grandTotal,
      message: `Successfully applied ${customerType === 'DEALER' ? 'Dealer Price' : 'End User Price'} to ${entityType} #${numId}`,
    };
  }
}
