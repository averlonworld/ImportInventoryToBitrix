import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import FileUploader from '../components/FileUploader';
import DataPreview from '../components/DataPreview';
import ImportProgress from '../components/ImportProgress';
import ConfirmDialog from '../components/ConfirmDialog';
import { previewFile, createImport } from '../services/import.api';
import { getStockReceiptFields } from '../services/bitrix.api';
import type { ImportPreview, StockReceiptDiscovery, BitrixStore } from '../types';
import { estimateTotalDuration } from '../utils/timeEstimate';

// Steps: Upload -> Preview -> Confirm -> Import -> Result
const STEPS = ['Upload', 'Preview', 'Confirm', 'Import', 'Result'];

interface UploadedFile {
  fileId: string;
  fileName: string;
  fileSize: number;
  filePath: string;
}

interface StockReceiptMapping {
  productNameField?: string;
  skuField?: string;
  barcodeField?: string;
  quantityArrivedField?: string;
  purchasePriceField?: string;
  salesPriceField?: string;
  warehouseField?: string;
  quantityDestinationField?: string;
  totalField?: string;
}

// Auto-detect columns specifically for Stock Receipts
function detectStockReceiptColumns(headers: string[]): StockReceiptMapping {
  const result: StockReceiptMapping = {};
  const clean = (s: string) => s.trim().toLowerCase();

  // 1. SKU: CODE, SKU, PART NUMBER, PART NO, ITEM CODE
  for (const h of headers) {
    const c = clean(h);
    if (['code', 'sku', 'product code', 'item code', 'product sku'].includes(c)) {
      result.skuField = h;
      break;
    }
  }
  if (!result.skuField) {
    for (const h of headers) {
      const c = clean(h);
      if (c.includes('sku') || c.includes('code') || c.includes('part number') || c.includes('part no')) {
        result.skuField = h;
        break;
      }
    }
  }

  // 2. Product Name: DESCRIPTION, PRODUCT NAME, NAME, TITLE, ITEM NAME, PRODUCT
  for (const h of headers) {
    const c = clean(h);
    if (['description', 'product name', 'name', 'product', 'title', 'item description'].includes(c)) {
      result.productNameField = h;
      break;
    }
  }
  if (!result.productNameField) {
    for (const h of headers) {
      const c = clean(h);
      if (c.includes('desc') || c.includes('name') || c.includes('title') || c.includes('product')) {
        result.productNameField = h;
        break;
      }
    }
  }

  // 3. Barcode: BARCODE, BAR CODE, EAN, UPC, GTIN, PART NUMBER (if not sku)
  for (const h of headers) {
    const c = clean(h);
    if (['barcode', 'bar code', 'ean', 'upc', 'gtin'].includes(c)) {
      result.barcodeField = h;
      break;
    }
  }
  if (!result.barcodeField) {
    for (const h of headers) {
      const c = clean(h);
      if ((c.includes('part number') || c.includes('part no')) && h !== result.skuField) {
        result.barcodeField = h;
        break;
      }
    }
  }

  // 4. Quantity Arrived: QTY IN STOCK, QUANTITY ARRIVED, QTY ARRIVED, QUANTITY, QTY, AMOUNT, STOCK
  for (const h of headers) {
    const c = clean(h);
    if (['qty in stock', 'quantity arrived', 'qty arrived', 'arrived qty', 'quantity', 'qty', 'amount', 'stock qty'].includes(c)) {
      result.quantityArrivedField = h;
      break;
    }
  }
  if (!result.quantityArrivedField) {
    for (const h of headers) {
      const c = clean(h);
      if (c.includes('qty') || c.includes('quantity') || c.includes('stock')) {
        result.quantityArrivedField = h;
        break;
      }
    }
  }

  // 5. Purchase Price (Cost): COST, COST , PURCHASE PRICE, COST PRICE, BUY PRICE
  for (const h of headers) {
    const c = clean(h);
    if (['cost', 'cost ', 'purchase price', 'cost price', 'buying price', 'unit cost'].includes(c)) {
      result.purchasePriceField = h;
      break;
    }
  }
  if (!result.purchasePriceField) {
    for (const h of headers) {
      const c = clean(h);
      if (c.includes('cost') || c.includes('purchase')) {
        result.purchasePriceField = h;
        break;
      }
    }
  }

  // 6. Sales Price: END USER PRICE, DEALER PRICE, SALES PRICE, SELLING PRICE, PRICE
  for (const h of headers) {
    const c = clean(h);
    if (['end user price', 'dealer price', 'sales price', 'selling price', 'price', 'base price'].includes(c)) {
      result.salesPriceField = h;
      break;
    }
  }
  if (!result.salesPriceField) {
    for (const h of headers) {
      const c = clean(h);
      if (c.includes('price') || c.includes('rate') || c.includes('mrp')) {
        result.salesPriceField = h;
        break;
      }
    }
  }

  // 7. Warehouse: WAREHOUSE, STORE, LOCATION, WH
  for (const h of headers) {
    const c = clean(h);
    if (['warehouse', 'store', 'location', 'wh', 'store to'].includes(c)) {
      result.warehouseField = h;
      break;
    }
  }

  // 8. Quantity at Destination: QTY ON ORDER, QUANTITY AT DESTINATION, DESTINATION QTY
  for (const h of headers) {
    const c = clean(h);
    if (['qty on order', 'quantity at destination', 'destination qty', 'current stock'].includes(c)) {
      result.quantityDestinationField = h;
      break;
    }
  }

  // 9. Total: TOTAL, TOTAL COST, TOTAL PRICE, AMOUNT
  for (const h of headers) {
    const c = clean(h);
    if (['total', 'total cost', 'total amount', 'total price'].includes(c)) {
      result.totalField = h;
      break;
    }
  }

  return result;
}

export default function StockReceiptImport() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  
  const [discovery, setDiscovery] = useState<StockReceiptDiscovery | null>(null);
  const [mapping, setMapping] = useState<StockReceiptMapping>({});
  const [showMappingAdjust, setShowMappingAdjust] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<number | ''>('');
  
  const [importMode, setImportMode] = useState<'CREATE_UPDATE' | 'CREATE_ONLY' | 'UPDATE_ONLY'>('CREATE_UPDATE');
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creatingImport, setCreatingImport] = useState(false);

  // Fetch Bitrix warehouses & fields
  const fetchBitrixFields = useCallback(async () => {
    try {
      const res = await getStockReceiptFields();
      if (res.success && res.data) {
        setDiscovery(res.data);
        if (res.data.stores && res.data.stores.length > 0) {
          setSelectedStoreId(res.data.stores[0].id);
        }
      }
    } catch {
      // Graceful fallback
    }
  }, []);

  useEffect(() => {
    fetchBitrixFields();
  }, [fetchBitrixFields]);

  // Step 0 -> Step 1: Upload and auto-preview
  const handleUploaded = useCallback(async (data: UploadedFile) => {
    setUploadedFile(data);
    setPreviewLoading(true);
    setCurrentStep(1); // Move to Preview
    try {
      const res = await previewFile(data.filePath, data.fileName);
      if (res.success && res.data) {
        setPreview(res.data);
        const auto = detectStockReceiptColumns(res.data.headers);
        setMapping(auto);
        toast.success('Spreadsheet analyzed! Columns automatically mapped.');
      } else {
        toast.error(res.message || 'Failed to preview file');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to preview file');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Step 1 -> Step 2: Proceed to Confirm
  const handleProceedToConfirm = () => {
    if (!mapping.productNameField && !mapping.skuField) {
      toast.error('Please ensure at least Product Name or SKU is mapped');
      setShowMappingAdjust(true);
      return;
    }
    if (!mapping.quantityArrivedField) {
      toast.error('Please ensure Quantity Arrived is mapped');
      setShowMappingAdjust(true);
      return;
    }
    setCurrentStep(2); // Move to Confirm
  };

  // Step 2 -> Step 3 & 4: Start Import & Live Result
  const handleStartImport = async () => {
    if (!uploadedFile) return;
    setConfirmOpen(false);
    setCurrentStep(3); // Queuing import
    setCreatingImport(true);

    try {
      const res = await createImport({
        filePath: uploadedFile.filePath,
        fileName: uploadedFile.fileName,
        fileSize: uploadedFile.fileSize,
        type: 'STOCK_RECEIPTS',
        mapping: {
          skuField: mapping.skuField,
          nameField: mapping.productNameField,
          barcodeField: mapping.barcodeField,
          purchasePriceField: mapping.purchasePriceField,
          salesPriceField: mapping.salesPriceField,
          quantityArrivedField: mapping.quantityArrivedField,
          warehouseField: mapping.warehouseField,
          quantityDestinationField: mapping.quantityDestinationField,
          totalField: mapping.totalField,
          defaultStoreId: selectedStoreId ? Number(selectedStoreId) : undefined,
        },
        importMode,
      });

      if (res.success && res.data) {
        setImportJobId(res.data.id);
        setCurrentStep(4); // Move to Result
        toast.success('Stock Receipt import started!');
      } else {
        toast.error(res.message || 'Failed to start stock receipt import');
        setCurrentStep(2);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to start import');
      setCurrentStep(2);
    } finally {
      setCreatingImport(false);
    }
  };

  const mappedSummary = useMemo(() => [
    { label: 'Product Name', val: mapping.productNameField, required: true },
    { label: 'SKU / Code', val: mapping.skuField, required: false },
    { label: 'Barcode', val: mapping.barcodeField, required: false },
    { label: 'Quantity Arrived', val: mapping.quantityArrivedField, required: true },
    { label: 'Purchase Price (Cost)', val: mapping.purchasePriceField, required: false },
    { label: 'Sales Price (Selling)', val: mapping.salesPriceField, required: false },
    { label: 'Warehouse Column', val: mapping.warehouseField, required: false },
    { label: 'Quantity at Destination', val: mapping.quantityDestinationField, required: false },
    { label: 'Total Valuation', val: mapping.totalField, required: false },
  ], [mapping]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Receipt + Product Catalog Import</h1>
          <p className="text-sm text-gray-500 mt-1">
            Automatic column mapping: Upload &rarr; Preview &rarr; Confirm &rarr; Import &rarr; Result
          </p>
        </div>
      </div>

      {/* 5-Step Stepper: Upload -> Preview -> Confirm -> Import -> Result */}
      <div className="flex items-center gap-2 justify-between bg-white rounded-lg p-4 border border-gray-200">
        {STEPS.map((step, idx) => (
          <div key={step} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                idx === currentStep
                  ? 'bg-blue-600 text-white'
                  : idx < currentStep
                  ? 'bg-green-100 text-green-700 font-bold'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {idx < currentStep ? '✓' : idx + 1}
            </div>
            <span
              className={`text-sm ${
                idx === currentStep ? 'font-semibold text-gray-900' : 'text-gray-500'
              }`}
            >
              {step}
            </span>
            {idx < STEPS.length - 1 && <span className="text-gray-300 ml-1">›</span>}
          </div>
        ))}
      </div>

      {/* STEP 0: Upload */}
      {currentStep === 0 && (
        <div className="card space-y-4">
          <h2 className="text-lg font-medium">Step 1: Upload Stock Receipt File</h2>
          <p className="text-sm text-gray-500">
            Select an Excel (.xlsx, .xls) or CSV file containing arrival stock items. Columns such as Product Name,
            SKU/Part Number, Quantity, Purchase Price, and Sales Price are automatically matched to Bitrix fields.
          </p>
          <FileUploader onUploaded={handleUploaded} />
        </div>
      )}

      {/* STEP 1: Preview & Auto-Mapped Fields */}
      {currentStep === 1 && uploadedFile && (
        <div className="space-y-6">
          {previewLoading ? (
            <div className="card text-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3"></div>
              <p className="text-gray-600 font-medium">Analyzing stock receipt & automatically matching fields...</p>
            </div>
          ) : preview ? (
            <>
              {/* Auto-Mapping Overview */}
              <div className="card border-blue-100 bg-blue-50/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold">✓</span>
                    <h3 className="font-semibold text-gray-900">Columns Automatically Matched</h3>
                  </div>
                  <button
                    onClick={() => setShowMappingAdjust(!showMappingAdjust)}
                    className="text-xs font-medium text-blue-600 hover:text-blue-800 underline"
                  >
                    {showMappingAdjust ? 'Hide manual adjustments' : 'Need to adjust any column?'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {mappedSummary.map((item) => (
                    <div key={item.label} className="bg-white p-3 rounded-md border border-gray-200 flex flex-col justify-between">
                      <span className="text-xs font-medium text-gray-500">
                        {item.label} {item.required && <span className="text-red-500">*</span>}
                      </span>
                      <div className="mt-1 flex items-center justify-between">
                        <span className={`text-sm font-semibold truncate ${item.val ? 'text-blue-900' : 'text-gray-400 italic'}`}>
                          {item.val || 'Not detected'}
                        </span>
                        {item.val && (
                          <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-medium ml-2 shrink-0">
                            Auto-matched
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Optional Manual Adjustments Accordion */}
                {showMappingAdjust && (
                  <div className="mt-4 pt-4 border-t border-blue-200/60 bg-white p-4 rounded-lg space-y-3">
                    <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Manual Column Override</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Product Name Column *</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.productNameField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, productNameField: e.target.value }))}
                        >
                          <option value="">-- Select Column --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">SKU / Code Column</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.skuField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, skuField: e.target.value }))}
                        >
                          <option value="">-- Select Column --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Quantity Arrived Column *</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.quantityArrivedField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, quantityArrivedField: e.target.value }))}
                        >
                          <option value="">-- Select Column --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Purchase Price (Cost)</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.purchasePriceField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, purchasePriceField: e.target.value }))}
                        >
                          <option value="">-- None / Skip --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Sales Price (Catalog Base Price)</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.salesPriceField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, salesPriceField: e.target.value }))}
                        >
                          <option value="">-- None / Skip --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Barcode Column</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.barcodeField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, barcodeField: e.target.value }))}
                        >
                          <option value="">-- None / Skip --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Warehouse Column</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.warehouseField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, warehouseField: e.target.value }))}
                        >
                          <option value="">-- None / Use Default --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Quantity at Destination</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.quantityDestinationField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, quantityDestinationField: e.target.value }))}
                        >
                          <option value="">-- None / Skip --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Total Column</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.totalField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, totalField: e.target.value }))}
                        >
                          <option value="">-- None / Skip --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Data Preview */}
              <div className="card space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-700">
                      File Data Preview ({preview.totalRows.toLocaleString()} total rows)
                    </h3>
                    <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Est. time: {estimateTotalDuration(preview.totalRows)}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                    All {preview.totalRows.toLocaleString()} rows loaded
                  </span>
                </div>
                <DataPreview preview={preview} />
              </div>

              {/* Actions */}
              <div className="flex justify-between items-center pt-2">
                <button
                  onClick={() => {
                    setUploadedFile(null);
                    setPreview(null);
                    setCurrentStep(0);
                  }}
                  className="btn-secondary"
                >
                  &larr; Upload Different File
                </button>
                <button
                  onClick={handleProceedToConfirm}
                  className="btn-primary"
                >
                  Continue to Confirm &rarr;
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* STEP 2: Confirm */}
      {currentStep === 2 && preview && (
        <div className="space-y-6">
          <div className="card space-y-5">
            <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-3">
              Step 3: Confirm Stock Receipt & Catalog Synchronization
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Product Catalog Sync Mode */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Product Catalog Synchronization Mode
                </label>
                <select
                  className="input-field"
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as any)}
                >
                  <option value="CREATE_UPDATE">Create + Update (Recommended: creates missing products, updates existing)</option>
                  <option value="CREATE_ONLY">Create Only (Skip existing catalog products)</option>
                  <option value="UPDATE_ONLY">Update Only (Only update existing catalog products)</option>
                </select>
              </div>

              {/* Destination Warehouse */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Destination Warehouse / Store
                </label>
                <select
                  className="input-field"
                  value={selectedStoreId}
                  onChange={(e) => setSelectedStoreId(e.target.value ? Number(e.target.value) : '')}
                >
                  {discovery?.stores && discovery.stores.length > 0 ? (
                    discovery.stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} (ID #{s.id})
                      </option>
                    ))
                  ) : (
                    <option value="">Default Warehouse (Store #1)</option>
                  )}
                </select>
              </div>
            </div>

            {/* Overview Card */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-200">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Import Overview</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                <div>
                  <span className="text-xs text-gray-500 block">File Name</span>
                  <span className="font-semibold text-gray-900 truncate block">{preview.fileName}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Total Items</span>
                  <span className="font-semibold text-gray-900">{preview.totalRows.toLocaleString()} rows</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Product Column</span>
                  <span className="font-semibold text-blue-700">{mapping.productNameField || 'None'}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Quantity Arrived Column</span>
                  <span className="font-semibold text-blue-700">{mapping.quantityArrivedField || 'None'}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Est. Duration</span>
                  <span className="font-semibold text-emerald-700 block flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 text-emerald-600 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {estimateTotalDuration(preview.totalRows)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <strong>Bitrix24 Inventory Operations:</strong>
              <ul className="list-disc ml-4 mt-1 space-y-1">
                <li>Products will be matched and created/updated in the Product Catalog with Sales Price & Barcode.</li>
                <li>A Bitrix24 Inventory Stock Receipt (Arrival Document) will be created with each line item's arrival quantity and purchase cost.</li>
                <li>The arrival document will be conducted to credit inventory directly to the destination warehouse.</li>
              </ul>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button onClick={() => setCurrentStep(1)} className="btn-secondary">
                &larr; Back to Preview
              </button>
              <button onClick={() => setConfirmOpen(true)} className="btn-primary">
                Confirm & Start Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: Import in Progress */}
      {currentStep === 3 && (
        <div className="card text-center py-16 space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <h3 className="text-lg font-medium text-gray-900">Queuing Stock Receipt Import...</h3>
          <p className="text-sm text-gray-500">Creating arrival document and preparing background worker.</p>
        </div>
      )}

      {/* STEP 4: Live Progress & Result */}
      {currentStep === 4 && importJobId && (
        <div className="card space-y-6">
          <ImportProgress importId={importJobId} />
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={() => navigate(`/imports/${importJobId}`)}
              className="btn-primary"
            >
              View Full Import Details & Error Log
            </button>
            <button
              onClick={() => {
                setUploadedFile(null);
                setPreview(null);
                setImportJobId(null);
                setCurrentStep(0);
              }}
              className="btn-secondary"
            >
              Import Another Stock File
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm Stock Receipt & Catalog Import"
        message={`Are you ready to import ${preview?.totalRows?.toLocaleString() || 0} rows from "${uploadedFile?.fileName}" into Bitrix24? Estimated processing time: ${estimateTotalDuration(preview?.totalRows || 0)}.`}
        confirmLabel={creatingImport ? 'Starting...' : 'Start Import'}
        onConfirm={handleStartImport}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
