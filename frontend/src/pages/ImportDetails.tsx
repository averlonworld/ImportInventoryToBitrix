import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getImport, getImportRecords, downloadErrorReport, retryFailed, retrySingleRecord } from '../services/import.api';
import type { ImportJob, ImportRecord, ImportRecordsSummary } from '../types';
import StatusBadge from '../components/StatusBadge';
import ImportProgress from '../components/ImportProgress';
import { estimateTotalDuration, estimateRemainingTime, formatElapsedDuration } from '../utils/timeEstimate';

type RecordTab = 'ALL' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

const formatCurrency = (val: any) => {
  if (val === null || val === undefined || val === '') return '-';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num);
};

export default function ImportDetails() {
  const { id } = useParams<{ id: string }>();
  const [importJob, setImportJob] = useState<ImportJob | null>(null);
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [summary, setSummary] = useState<ImportRecordsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [retryingRecordId, setRetryingRecordId] = useState<string | null>(null);

  // Table filters & pagination
  const [activeTab, setActiveTab] = useState<RecordTab>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalFiltered, setTotalFiltered] = useState(0);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadImport = useCallback(async () => {
    if (!id) return;
    try {
      const res = await getImport(id);
      if (res.success && res.data) setImportJob(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load import');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchRecords = useCallback(async (showSpinner = false) => {
    if (!id) return;
    if (showSpinner) setLoadingRecords(true);
    try {
      const res = await getImportRecords(id, {
        page,
        limit,
        status: activeTab,
        search: debouncedSearch,
      });
      if (res.success && res.data) {
        setRecords(res.data.records || []);
        setSummary(res.data.summary || null);
        setTotalPages(res.data.pagination?.totalPages || 1);
        setTotalFiltered(res.data.pagination?.total || 0);
      }
    } catch {
      // Non-fatal
    } finally {
      if (showSpinner) setLoadingRecords(false);
    }
  }, [id, page, limit, activeTab, debouncedSearch]);

  useEffect(() => {
    loadImport();
  }, [loadImport]);

  useEffect(() => {
    fetchRecords(true);
  }, [fetchRecords]);

  const handleTabChange = (tab: RecordTab) => {
    setActiveTab(tab);
    setPage(1);
  };

  const handleDownloadErrors = async () => {
    if (!id) return;
    try {
      const blob = await downloadErrorReport(id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import_errors_${id.slice(0, 8)}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Error report downloaded');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to download error report');
    }
  };

  const handleRetry = async () => {
    if (!id) return;
    setRetrying(true);
    try {
      const res = await retryFailed(id);
      if (res.success) {
        toast.success(`Retrying ${res.data?.retriedCount || 0} failed record(s)`);
        await loadImport();
        await fetchRecords(true);
      } else {
        toast.error(res.message || 'Retry failed');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const handleRetrySingle = async (recordId: string) => {
    if (!id || retryingRecordId) return;
    setRetryingRecordId(recordId);
    try {
      const res = await retrySingleRecord(id, recordId);
      if (res.success) {
        toast.success('Record retried successfully');
        await loadImport();
        await fetchRecords(false);
      } else {
        toast.error(res.message || 'Retry failed');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Retry failed');
    } finally {
      setRetryingRecordId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-600">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
        Loading import details...
      </div>
    );
  }

  if (error || !importJob) {
    return <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error || 'Import not found'}</div>;
  }

  const duration = importJob.startedAt && importJob.completedAt
    ? Math.round((new Date(importJob.completedAt).getTime() - new Date(importJob.startedAt).getTime()) / 1000)
    : null;

  const failedCount = summary?.failed ?? importJob.failedRows;
  const successCount = summary?.successful ?? importJob.successfulRows;
  const skippedCount = summary?.skipped ?? importJob.skippedRows;
  const totalCount = summary?.totalRecords ?? importJob.totalRows;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Import Details</h1>
          <p className="text-sm text-gray-500">ID: <span className="font-mono">{importJob.id}</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/error-handling?jobId=${importJob.id}`}
            className="btn-secondary text-sm flex items-center gap-1.5 border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-100/60"
          >
            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Live Monitor & Error Handling
          </Link>
          <button
            onClick={handleDownloadErrors}
            className="btn-secondary text-sm"
            disabled={failedCount === 0}
          >
            Download Error Report
          </button>
          <button
            onClick={handleRetry}
            className="btn-primary text-sm"
            disabled={retrying || failedCount === 0}
          >
            {retrying ? 'Retrying...' : failedCount > 0 ? `Retry Failed Records (${failedCount})` : 'Retry Failed Records'}
          </button>
        </div>
      </div>

      {/* Warning Banner if there are failed records */}
      {failedCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 text-amber-900">
          <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <div className="font-semibold text-sm">
              Notice: {failedCount} Record{failedCount > 1 ? 's' : ''} Encountered Errors
            </div>
            <div className="text-xs text-amber-800 mt-1">
              Some records failed validation or could not be conducted into Bitrix inventory. You can switch to the "Failed" tab below to inspect the exact errors and where they occurred.
            </div>
          </div>
          <button
            onClick={() => handleTabChange('FAILED')}
            className="text-xs font-semibold px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded border border-amber-300 transition-colors"
          >
            Inspect Failed ({failedCount})
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="text-xs text-gray-500">File</div>
          <div className="text-sm font-medium mt-1 break-all">{importJob.fileName}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">Import Mode</div>
          <div className="text-sm font-medium mt-1">{importJob.importMode.replace(/_/g, ' ')}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">Type</div>
          <div className="text-sm font-medium mt-1">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
              importJob.type === 'INVOICES'
                ? 'bg-purple-100 text-purple-700'
                : importJob.type === 'STOCK_RECEIPTS'
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {importJob.type === 'INVOICES' ? 'Invoices' : importJob.type === 'STOCK_RECEIPTS' ? 'Stock Receipt' : 'Products'}
            </span>
          </div>
        </div>
        {importJob.bitrixDocumentId && (
          <div className="card">
            <div className="text-xs text-gray-500">Bitrix Document ID</div>
            <div className="text-sm font-medium mt-1 text-indigo-600 font-mono">
              #{importJob.bitrixDocumentId}
            </div>
          </div>
        )}
        <div className="card">
          <div className="text-xs text-gray-500">Status</div>
          <div className="mt-1"><StatusBadge status={importJob.status} /></div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">Uploaded</div>
          <div className="text-sm font-medium mt-1">
            {importJob.createdAt ? new Date(importJob.createdAt).toLocaleString() : '-'}
          </div>
        </div>
      </div>

      {/* Live Progress for active jobs */}
      {['PENDING', 'PROCESSING'].includes(importJob.status) && (
        <div className="card">
          <ImportProgress importId={importJob.id} onComplete={() => { loadImport(); fetchRecords(true); }} />
        </div>
      )}

      {/* Statistics */}
      <div className="card">
        <h3 className="text-lg font-medium mb-4">Statistics</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold">{importJob.totalRows}</div>
            <div className="text-xs text-gray-500">Total</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{importJob.createdProductsCount ?? 0}</div>
            <div className="text-xs text-gray-500">New Created</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-indigo-600">{importJob.updatedProductsCount ?? 0}</div>
            <div className="text-xs text-gray-500">Updated</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{importJob.successfulRows}</div>
            <div className="text-xs text-gray-500">Successful</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{importJob.failedRows}</div>
            <div className="text-xs text-gray-500">Failed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-600">{importJob.duplicateRows ?? 0}</div>
            <div className="text-xs text-gray-500">Duplicates</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-500">{importJob.skippedRows}</div>
            <div className="text-xs text-gray-500">Skipped</div>
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-gray-900 truncate">
              {duration !== null
                ? formatElapsedDuration(importJob.startedAt, importJob.completedAt)
                : importJob.status === 'PROCESSING'
                ? estimateRemainingTime(importJob.totalRows, importJob.processedRows, importJob.startedAt).text
                : estimateTotalDuration(importJob.totalRows)}
            </div>
            <div className="text-xs text-gray-500">
              {duration !== null ? 'Duration' : 'Est. Time'}
            </div>
          </div>
        </div>
      </div>

      {/* Comprehensive Import Records Explorer */}
      <div className="card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Import Records</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Review all records processed during this run, including successful creations, updates, and specific failure details.
            </p>
          </div>

          {/* Search box */}
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search SKU, name, or error..."
              className="w-full text-xs px-3 py-2 pl-8 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            <svg
              className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex border-b border-gray-200 gap-1 overflow-x-auto">
          <button
            onClick={() => handleTabChange('ALL')}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'ALL'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            All Records
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-600 font-semibold">
              {totalCount}
            </span>
          </button>

          <button
            onClick={() => handleTabChange('SUCCESS')}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'SUCCESS'
                ? 'border-green-600 text-green-700 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Successful
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-green-100 text-green-800 font-semibold">
              {successCount}
            </span>
          </button>

          <button
            onClick={() => handleTabChange('FAILED')}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'FAILED'
                ? 'border-red-600 text-red-700 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Failed
            <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-semibold ${
              failedCount > 0 ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'
            }`}>
              {failedCount}
            </span>
          </button>

          <button
            onClick={() => handleTabChange('SKIPPED')}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'SKIPPED'
                ? 'border-gray-600 text-gray-800 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Skipped
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-600 font-semibold">
              {skippedCount}
            </span>
          </button>
        </div>

        {/* Records Table */}
        {loadingRecords ? (
          <div className="py-12 flex justify-center items-center text-gray-500 gap-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            Loading records...
          </div>
        ) : records.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-sm">
            {debouncedSearch
              ? `No records found matching "${debouncedSearch}"`
              : activeTab === 'FAILED'
              ? 'No failed records in this import'
              : 'No records found'}
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Row</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">
                    {importJob.type === 'INVOICES' ? 'Invoice #' : 'SKU / Code'}
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">
                    {importJob.type === 'INVOICES' ? 'Subject' : 'Product Name'}
                  </th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600 uppercase">Action</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase">Stock / Qty</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase">Cost / Price</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600 uppercase">Status</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Result / Error Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {records.map((rec) => {
                  const isFailed = rec.status === 'FAILED' || rec.status === 'PARTIAL_FAILURE';
                  const isSuccess = rec.status === 'SUCCESS';
                  return (
                    <tr key={rec.id} className={isFailed ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-gray-50'}>
                      <td className="px-3 py-2 text-xs text-gray-500 font-mono">{rec.rowNumber}</td>
                      <td className="px-3 py-2 text-xs font-mono font-medium text-gray-900">
                        {rec.sku || rec.partNumber || '-'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700 max-w-xs truncate" title={rec.productName || rec.description || ''}>
                        {rec.productName || rec.description || '-'}
                      </td>
                      <td className="px-3 py-2 text-xs text-center whitespace-nowrap">
                        {rec.actionTaken === 'CREATED' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-800">
                            Created
                          </span>
                        ) : rec.actionTaken === 'UPDATED' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-100 text-indigo-800">
                            Updated
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-right text-gray-900 font-medium">
                        <div>{rec.quantityArrived ?? rec.qtyInStock ?? '-'}</div>
                        {rec.qtyOnOrder !== undefined && rec.qtyOnOrder !== null && (
                          <div className="text-[11px] text-gray-500 font-normal">On Order: {rec.qtyOnOrder}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-right whitespace-nowrap">
                        {rec.cost !== undefined && (
                          <div className="text-gray-900 font-medium">{formatCurrency(rec.cost)}</div>
                        )}
                        {rec.salesPrice !== undefined && (
                          <div className="text-[11px] text-gray-500">Sell: {formatCurrency(rec.salesPrice)}</div>
                        )}
                        {rec.cost === undefined && rec.salesPrice === undefined && (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <StatusBadge status={rec.status} />
                      </td>
                      <td className="px-3 py-2 text-xs max-w-md">
                        {isFailed ? (
                          <div className="space-y-1">
                            <div className="text-red-700 font-medium break-words">
                              {rec.errorMessage || rec.bitrixError || 'Record failed during processing'}
                            </div>
                            <div className="flex items-center gap-2 pt-0.5">
                              {rec.errorType && (
                                <span className="inline-block px-1.5 py-0.2 rounded text-[10px] font-semibold bg-red-100 text-red-800">
                                  {rec.errorType.replace(/_/g, ' ')}
                                </span>
                              )}
                              <button
                                onClick={() => handleRetrySingle(rec.id)}
                                disabled={retryingRecordId === rec.id}
                                className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                              >
                                {retryingRecordId === rec.id ? (
                                  <>
                                    <svg className="animate-spin h-3 w-3 text-indigo-600" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                    </svg>
                                    <span>Retrying...</span>
                                  </>
                                ) : (
                                  <span>↻ Retry this record</span>
                                )}
                              </button>
                            </div>
                          </div>
                        ) : isSuccess ? (
                          <div className="text-emerald-700 font-medium flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span>Bitrix Product #{rec.bitrixProductId || '-'}</span>
                            {rec.bitrixDocumentId && (
                              <span className="text-gray-500 text-[11px] font-normal">
                                (Doc #{rec.bitrixDocumentId})
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-gray-500 italic">
                            {rec.errorMessage || 'Skipped'}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer */}
        {totalFiltered > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-gray-200">
            <div className="text-xs text-gray-500">
              Showing <span className="font-medium">{(page - 1) * limit + 1}</span> to{' '}
              <span className="font-medium">{Math.min(page * limit, totalFiltered)}</span> of{' '}
              <span className="font-medium">{totalFiltered}</span> records
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-xs text-gray-600">
                <span>Rows:</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-2 py-1 text-xs border border-gray-300 rounded bg-white"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-2.5 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="px-2 text-xs text-gray-700">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-2.5 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
