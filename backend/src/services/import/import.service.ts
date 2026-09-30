import { BitrixClient } from '../bitrix/BitrixClient';
import { BitrixCatalogService, BitrixProductService } from '../bitrix/BitrixCatalogService';
import { logger } from '../../utils/logger';

export interface ImportRowData {
  sku: string;
  name: string;
  quantity?: number;
  price?: number;
  barcode?: string;
  [key: string]: any;
}

export type ImportResultStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'PARTIAL_FAILURE';

export interface ImportResult {
  status: ImportResultStatus;
  bitrixProductId?: string;
  errorMessage?: string;
  bitrixError?: string;
}

export class ImportService {
  async processRecord(
    rowData: ImportRowData,
    mapping: { skuField: string; nameField: string; quantityField?: string; priceField?: string; barcodeField?: string; },
    importMode: string,
    clientOrUserId?: BitrixClient | string
  ): Promise<ImportResult> {
    const sku = (rowData.sku || '').trim();
    const name = (rowData.name || '').trim();
    const quantity = rowData.quantity;
    const price = rowData.price;
    const barcode = rowData.barcode ? String(rowData.barcode).trim() : undefined;

    if (!sku) {
      return { status: 'SKIPPED', errorMessage: 'Missing SKU' };
    }
    if (!name) {
      return { status: 'SKIPPED', errorMessage: 'Missing product name' };
    }

    try {
      const client = clientOrUserId instanceof BitrixClient
        ? clientOrUserId
        : await BitrixClient.fromDbConfiguration(clientOrUserId);
      const catalogService = new BitrixCatalogService(client);
      const context = await catalogService.getCatalogContext();
      const productService = new BitrixProductService(client, context);

      // Check if product exists by SKU (product code) or Barcode
      let existingProduct = await productService.findProductBySku(sku);
      if (!existingProduct && barcode) {
        existingProduct = await productService.findProductByBarcode(barcode);
      }
      if (!existingProduct && name) {
        existingProduct = await productService.findProductByName(name);
      }

      if (importMode === 'CREATE_ONLY' && existingProduct) {
        return { status: 'SKIPPED', errorMessage: 'Product already exists (Create Only mode)' };
      }

      if (importMode === 'UPDATE_ONLY' && !existingProduct) {
        return { status: 'SKIPPED', errorMessage: 'Product does not exist (Update Only mode)' };
      }

      let productId: number;
      let partialMessages: string[] = [];

      if (existingProduct) {
        const updateFields: any = {};
        if (existingProduct.name !== name) updateFields.name = name;
        if (barcode && existingProduct.barcode !== barcode) updateFields.barcode = barcode;

        if (Object.keys(updateFields).length > 0) {
          const updated = await productService.updateProduct(existingProduct.id, updateFields);
          if (!updated) {
            partialMessages.push('Product details could not be updated');
          }
        }
        productId = existingProduct.id;
      } else {
        productId = await productService.createProduct(name, sku, barcode);
      }

      if (!productId) {
        return { status: 'FAILED', errorMessage: 'Failed to get Bitrix product ID' };
      }

      // Price is managed via catalog.price.* methods
      if (price !== undefined && price !== null && price > 0) {
        const priceOk = await productService.setPrice(productId, Number(price));
        if (!priceOk) {
          partialMessages.push('Product price could not be set');
        }
      }

      // Stock quantity is attempted; on portals where Bitrix REST cannot write it,
      // this is a platform limitation, not a data error — log it once, keep SUCCESS.
      if (quantity !== undefined && quantity !== null && quantity >= 0) {
        const qty = await productService.setQuantity(productId, Number(quantity));
        if (!qty.supported && qty.firstProbe) {
          logger.warn(
            `Stock quantity is not writable via Bitrix REST on this portal (product ${productId}); quantities will be skipped silently for this portal`
          );
        }
      }

      if (partialMessages.length === 0) {
        return {
          status: 'SUCCESS',
          bitrixProductId: String(productId),
        };
      }

      return {
        status: 'PARTIAL_FAILURE',
        bitrixProductId: String(productId),
        errorMessage: partialMessages.join('; '),
        bitrixError: 'Bitrix REST limitation: some fields could not be written',
      };
    } catch (error: any) {
      logger.error({ err: error }, `Import record failed for SKU ${sku}`);
      return {
        status: 'FAILED',
        errorMessage: error.message || 'Unknown error',
        bitrixError: 'Bitrix API error',
      };
    }
  }
}

export const importService = new ImportService();