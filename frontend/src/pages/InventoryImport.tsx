import { useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import FileUploader from '../components/FileUploader';
import DataPreview from '../components/DataPreview';
import ImportProgress from '../components/ImportProgress';
import ConfirmDialog from '../components/ConfirmDialog';
import { previewFile, createImport, downloadTemplate } from '../services/import.api';
import type { ImportPreview } from '../types';

// Steps requested: Upload -> Preview -> Confirm -> Import -> Result (Map Columns removed)
const STEPS = ['Upload', 'Preview', 'Confirm', 'Import', 'Result'];

interface UploadedFile {
  fileId: string;
  fileName: string;
  fileSize: number;
  filePath: string;
}

interface AutoMapping {
  codeField?: string;           // Requirement 2 & 12: CODE (Unique product identifier)
  partNumberField?: string;     // Requirement 12: PART NUMBER (Product Title / Name)
  descriptionField?: string;    // Requirement 3 & 12: DESCRIPTION (Product Description - Mandatory)
  qtyInStockField?: string;     // Requirement 4 & 6: QTY IN STOCK (Inventory Quantity)
  qtyOnOrderField?: string;     // Requirement 4, 5 & 6: QTY ON ORDER (Quantity on order)
  costField?: string;           // Requirement 4, 6 & 7: COST (Purchasing price)
  dealerPriceField?: string;    // Requirement 4, 6, 7 & 11: DEALER PRICE (Dealer Price)
  endUserPriceField?: string;   // Requirement 4, 6, 7 & 11: END USER PRICE (End User Price)
  barcodeField?: string;
  // Legacy / fallback aliases
  skuField?: string;
  nameField?: string;
  quantityField?: string;
  priceField?: string;
}

// Automatically matches Excel headers to Bitrix product catalog and inventory fields
function detectInventoryColumns(headers: string[]): AutoMapping {
  const result: AutoMapping = {};
  const clean = (s: string) => s.trim().toLowerCase();

  // 1. CODE: CODE, ITEM CODE, PRODUCT CODE, SKU
  for (const h of headers) {
    const c = clean(h);
    if (['code', 'item code', 'product code', 'item_code', 'sku'].includes(c)) {
      result.codeField = h;
      result.skuField = h;
      break;
    }
  }

  // 2. PART NUMBER: PART NUMBER, PART NO, PART_NO, PART_NUMBER, PARTNO, MODEL
  for (const h of headers) {
    const c = clean(h);
    if (['part number', 'part no', 'part_no', 'part_number', 'partno', 'part #', 'model', 'model no'].includes(c)) {
      result.partNumberField = h;
      result.nameField = h;
      break;
    }
  }

  // 3. DESCRIPTION: DESCRIPTION, PRODUCT DESCRIPTION, ITEM DESCRIPTION, DESC
  for (const h of headers) {
    const c = clean(h);
    if (['description', 'product description', 'item description', 'desc', 'product_description'].includes(c)) {
      result.descriptionField = h;
      break;
    }
  }

  // 4. QTY IN STOCK: QTY IN STOCK, QUANTITY IN STOCK, IN STOCK, QTY, QUANTITY, STOCK
  for (const h of headers) {
    const c = clean(h);
    if (['qty in stock', 'quantity in stock', 'in stock', 'qty', 'quantity', 'stock', 'available stock'].includes(c)) {
      result.qtyInStockField = h;
      result.quantityField = h;
      break;
    }
  }

  // 5. QTY ON ORDER: QTY ON ORDER, ON ORDER, ORDERED QTY, QTY_ON_ORDER
  for (const h of headers) {
    const c = clean(h);
    if (['qty on order', 'quantity on order', 'on order', 'ordered qty', 'qty_on_order', 'order qty'].includes(c)) {
      result.qtyOnOrderField = h;
      break;
    }
  }

  // 6. COST: COST, COST , PURCHASE PRICE, PURCHASING PRICE, BUY PRICE
  for (const h of headers) {
    const c = clean(h);
    if (['cost', 'cost ', 'purchase price', 'purchasing price', 'cost price', 'buy price'].includes(c)) {
      result.costField = h;
      break;
    }
  }

  // 7. DEALER PRICE: DEALER PRICE, DEALER_PRICE, DEALER, WHOLESALE PRICE
  for (const h of headers) {
    const c = clean(h);
    if (['dealer price', 'dealer_price', 'dealer', 'wholesale price'].includes(c)) {
      result.dealerPriceField = h;
      break;
    }
  }

  // 8. END USER PRICE: END USER PRICE, END_USER_PRICE, RETAIL PRICE, SELLING PRICE, PRICE, MRP
  for (const h of headers) {
    const c = clean(h);
    if (['end user price', 'end_user_price', 'retail price', 'selling price', 'mrp', 'price'].includes(c)) {
      result.endUserPriceField = h;
      result.priceField = h;
      break;
    }
  }

  // 9. BARCODE: BARCODE, BAR CODE, EAN, UPC, GTIN
  for (const h of headers) {
    const c = clean(h);
    if (['barcode', 'bar code', 'ean', 'upc', 'gtin', 'item barcode'].includes(c)) {
      result.barcodeField = h;
      break;
    }
  }

  return result;
}

export default function InventoryImport() {
  const [currentStep, setCurrentStep] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  
  // Auto-mapped columns state (with optional manual override)
  const [mapping, setMapping] = useState<AutoMapping>({});
  const [showMappingAdjust, setShowMappingAdjust] = useState(false);
  
  const [importMode, setImportMode] = useState('CREATE_UPDATE');
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creatingImport, setCreatingImport] = useState(false);
  const [documentTitle, setDocumentTitle] = useState('');

  // Step 0 -> Step 1: Upload and auto-preview
  const handleUploaded = useCallback(async (data: UploadedFile) => {
    setUploadedFile(data);
    const cleanName = data.fileName.replace(/\.[^/.]+$/, '').trim();
    setDocumentTitle(cleanName);
    setPreviewLoading(true);
    setCurrentStep(1); // Move to Preview
    try {
      const res = await previewFile(data.filePath, data.fileName);
      if (res.success && res.data) {
        setPreview(res.data);
        const auto = detectInventoryColumns(res.data.headers);
        setMapping(auto);
        toast.success(`Headers automatically analyzed and matched!`);
      } else {
        toast.error(res.message || 'Failed to preview file');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to preview file');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inventory_template.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Template downloaded');
    } catch {
      toast.error('Failed to download template');
    }
  };

  // Step 1 -> Step 2: Validate auto-mapped required columns before Confirm
  const handleProceedToConfirm = () => {
    if (!mapping.codeField && !mapping.skuField) {
      toast.error('CODE column is required.');
      setShowMappingAdjust(true);
      return;
    }
    if (!mapping.descriptionField && !mapping.nameField) {
      toast.error('DESCRIPTION column is mandatory (Requirement 3).');
      setShowMappingAdjust(true);
      return;
    }
    setCurrentStep(2); // Move to Confirm
  };

  // Step 2 -> Step 3 & 4: Start Import & Result
  const handleStartImport = async () => {
    if (!uploadedFile) return;
    setConfirmOpen(false);
    setCurrentStep(3); // Import in progress
    setCreatingImport(true);

    try {
      const finalDocTitle = documentTitle.trim() || uploadedFile.fileName.replace(/\.[^/.]+$/, '').trim();
      const res = await createImport({
        filePath: uploadedFile.filePath,
        fileName: uploadedFile.fileName,
        fileSize: uploadedFile.fileSize,
        type: 'STOCK_RECEIPTS',
        documentTitle: finalDocTitle,
        mapping: {
          codeField: mapping.codeField || mapping.skuField || '',
          skuField: mapping.skuField || mapping.codeField || '',
          partNumberField: mapping.partNumberField || mapping.nameField || '',
          nameField: mapping.nameField || mapping.partNumberField || '',
          descriptionField: mapping.descriptionField || '',
          costField: mapping.costField || '',
          purchasePriceField: mapping.costField || '',
          dealerPriceField: mapping.dealerPriceField || '',
          endUserPriceField: mapping.endUserPriceField || mapping.priceField || '',
          salesPriceField: mapping.endUserPriceField || mapping.priceField || '',
          qtyInStockField: mapping.qtyInStockField || mapping.quantityField || '',
          quantityArrivedField: mapping.qtyInStockField || mapping.quantityField || '',
          quantityField: mapping.qtyInStockField || mapping.quantityField || '',
          qtyOnOrderField: mapping.qtyOnOrderField || '',
          priceField: mapping.endUserPriceField || mapping.priceField || '',
          barcodeField: mapping.barcodeField,
          defaultStoreId: 62,
          documentTitle: finalDocTitle,
        },
        importMode,
      });

      if (res.success && res.data) {
        setImportJobId(res.data.id);
        setCurrentStep(4); // Move to Result
        toast.success('Import job queued successfully!');
      } else {
        toast.error(res.message || 'Failed to start import');
        setCurrentStep(2); // Return to confirm on error
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to start import');
      setCurrentStep(2);
    } finally {
      setCreatingImport(false);
    }
  };

  const mappedSummary = useMemo(() => [
    { label: 'CODE (Unique Identifier)', key: 'codeField', val: mapping.codeField || mapping.skuField, required: true },
    { label: 'PART NUMBER (Product Title)', key: 'partNumberField', val: mapping.partNumberField || mapping.nameField, required: true },
    { label: 'DESCRIPTION (Mandatory Description)', key: 'descriptionField', val: mapping.descriptionField, required: true },
    { label: 'QTY IN STOCK (Inventory Quantity)', key: 'qtyInStockField', val: mapping.qtyInStockField || mapping.quantityField, required: false },
    { label: 'QTY ON ORDER (Ordered Quantity)', key: 'qtyOnOrderField', val: mapping.qtyOnOrderField, required: false },
    { label: 'COST (Purchasing Price)', key: 'costField', val: mapping.costField, required: false },
    { label: 'DEALER PRICE (Dealer Price Type)', key: 'dealerPriceField', val: mapping.dealerPriceField, required: false },
    { label: 'END USER PRICE (End User Price Type)', key: 'endUserPriceField', val: mapping.endUserPriceField || mapping.priceField, required: false },
    { label: 'Barcode', key: 'barcodeField', val: mapping.barcodeField, required: false },
  ], [mapping]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Import</h1>
          <p className="text-sm text-gray-500">
            Automatic column mapping: Upload &rarr; Preview &rarr; Confirm &rarr; Import &rarr; Result
          </p>
        </div>
        <button onClick={handleDownloadTemplate} className="btn-secondary text-sm">
          Download Sample Template
        </button>
      </div>

      {/* 5-Step Stepper: Upload -> Preview -> Confirm -> Import -> Result */}
      <div className="flex items-center gap-2 justify-between bg-white rounded-lg p-4 border border-gray-200">
        {STEPS.map((step, idx) => (
          <div key={step} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              idx === currentStep
                ? 'bg-blue-600 text-white'
                : idx < currentStep
                  ? 'bg-green-100 text-green-700 font-bold'
                  : 'bg-gray-100 text-gray-400'
            }`}>
              {idx < currentStep ? '✓' : idx + 1}
            </div>
            <span className={`text-sm ${idx === currentStep ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
              {step}
            </span>
            {idx < STEPS.length - 1 && <span className="text-gray-300 ml-1">›</span>}
          </div>
        ))}
      </div>

      {/* STEP 0: Upload */}
      {currentStep === 0 && (
        <div className="card space-y-4">
          <h2 className="text-lg font-medium">Step 1: Upload Inventory File</h2>
          <p className="text-sm text-gray-500">
            Upload your Excel (.xlsx, .xls) or CSV spreadsheet. Columns will be automatically matched to Bitrix24 fields without manual mapping.
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
              <p className="text-gray-600 font-medium">Analyzing spreadsheet & automatically matching columns...</p>
            </div>
          ) : preview ? (
            <>
              {/* Bitrix24 Document Title Configuration Card */}
              <div className="card border-blue-200 bg-white space-y-2 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-bold text-gray-900">
                      Bitrix24 Stock Document Name
                    </label>
                    <p className="text-xs text-gray-500">
                      Specify the name that will appear on this Stock Receipt / Adjustment document in Bitrix24.
                    </p>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-medium border border-blue-200">
                    Editable
                  </span>
                </div>
                <input
                  type="text"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder="e.g. CRM-STOCKLIST or Daily Stock Arrival"
                  className="input-field text-sm font-medium text-gray-900 border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Auto-Mapping Card */}
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
                    <div key={item.key} className="bg-white p-3 rounded-md border border-gray-200 flex flex-col justify-between">
                      <span className="text-xs font-medium text-gray-500">
                        {item.label} {item.required && <span className="text-red-500">*</span>}
                      </span>
                      <div className="mt-1 flex items-center justify-between">
                        <span className={`text-sm font-semibold ${item.val ? 'text-blue-900' : 'text-gray-400 italic'}`}>
                          {item.val || 'Not detected'}
                        </span>
                        {item.val && (
                          <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-medium">
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                      <div>
                        <label className="block font-medium text-gray-700 mb-1">CODE (Unique Identifier) *</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.codeField || mapping.skuField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, codeField: e.target.value, skuField: e.target.value }))}
                        >
                          <option value="">-- Select Column --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">PART NUMBER (Product Title) *</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.partNumberField || mapping.nameField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, partNumberField: e.target.value, nameField: e.target.value }))}
                        >
                          <option value="">-- Select Column --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">DESCRIPTION (Mandatory) *</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.descriptionField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, descriptionField: e.target.value }))}
                        >
                          <option value="">-- Select Column --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">QTY IN STOCK</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.qtyInStockField || mapping.quantityField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, qtyInStockField: e.target.value, quantityField: e.target.value }))}
                        >
                          <option value="">-- None / Skip --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">QTY ON ORDER</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.qtyOnOrderField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, qtyOnOrderField: e.target.value }))}
                        >
                          <option value="">-- None / Skip --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">COST (Purchasing Price)</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.costField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, costField: e.target.value }))}
                        >
                          <option value="">-- None / Skip --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">DEALER PRICE</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.dealerPriceField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, dealerPriceField: e.target.value }))}
                        >
                          <option value="">-- None / Skip --</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-gray-700 mb-1">END USER PRICE</label>
                        <select
                          className="input-field text-xs py-1"
                          value={mapping.endUserPriceField || mapping.priceField || ''}
                          onChange={(e) => setMapping(prev => ({ ...prev, endUserPriceField: e.target.value, priceField: e.target.value }))}
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
                  <h3 className="text-sm font-semibold text-gray-700">
                    File Data Preview ({preview.totalRows} total rows)
                  </h3>
                  <span className="text-xs text-gray-500">Showing first {preview.rows.length} rows</span>
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
              Step 3: Confirm Import Settings
            </h2>

            {/* Mode selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Bitrix24 Catalog Synchronization Mode
              </label>
              <select
                className="input-field"
                value={importMode}
                onChange={(e) => setImportMode(e.target.value)}
              >
                <option value="CREATE_UPDATE">Create + Update (Recommended: creates missing products & updates existing)</option>
                <option value="CREATE_ONLY">Create Only (Only adds products that don't yet exist in Bitrix)</option>
                <option value="UPDATE_ONLY">Update Only (Only updates existing Bitrix products matching SKU)</option>
              </select>
            </div>

            {/* Bitrix24 Document Name Configuration in Step 2 */}
            <div className="bg-white rounded-lg p-4 space-y-2 border border-blue-200 shadow-sm">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-bold text-gray-900">
                  Bitrix24 Document Title / Name
                </label>
                <span className="text-[11px] px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-medium border border-blue-200">
                  Editable
                </span>
              </div>
              <input
                type="text"
                value={documentTitle}
                onChange={(e) => setDocumentTitle(e.target.value)}
                placeholder="e.g. CRM-STOCKLIST or Daily Stock Arrival"
                className="input-field text-sm font-medium text-gray-900 border-gray-300"
              />
              <p className="text-xs text-gray-500">
                This exact name will be assigned to the Stock Receipt / Adjustment document in Bitrix24.
              </p>
            </div>

            {/* Import Summary */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-200">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Import Overview</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                <div>
                  <span className="text-xs text-gray-500 block">File Name</span>
                  <span className="font-semibold text-gray-900 truncate block">{preview.fileName}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Document Title</span>
                  <span className="font-semibold text-blue-700 truncate block">{documentTitle || preview.fileName.replace(/\.[^/.]+$/, '')}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Total Items</span>
                  <span className="font-semibold text-gray-900">{preview.totalRows.toLocaleString()} rows</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Product Column</span>
                  <span className="font-semibold text-blue-700">{mapping.nameField || 'None'}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Code Column</span>
                  <span className="font-semibold text-blue-700">{mapping.skuField || 'None'}</span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
              <strong>Bitrix24 Synchronization:</strong> Products will be checked against the Bitrix24 product catalog by SKU and Name. Prices and stock quantities will be updated in Bitrix24 via BullMQ background workers with automatic rate limiting.
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
          <h3 className="text-lg font-medium text-gray-900">Queuing Import Job...</h3>
          <p className="text-sm text-gray-500">Creating records and preparing asynchronous background worker.</p>
        </div>
      )}

      {/* STEP 4: Live Progress & Result */}
      {currentStep === 4 && importJobId && (
        <div className="card space-y-6">
          <ImportProgress importId={importJobId} />
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <a
              href={`/imports/${importJobId}`}
              className="btn-primary"
            >
              View Full Import Details & Error Log
            </a>
            <button
              onClick={() => {
                setUploadedFile(null);
                setPreview(null);
                setImportJobId(null);
                setCurrentStep(0);
              }}
              className="btn-secondary"
            >
              Import Another File
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm Catalog & Inventory Import"
        message={`Are you ready to import ${preview?.totalRows || 0} product records from "${preview?.fileName}" into Bitrix24 in ${importMode.replace(/_/g, ' ').toLowerCase()} mode?`}
        confirmLabel={creatingImport ? 'Starting...' : 'Start Import'}
        onConfirm={handleStartImport}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
