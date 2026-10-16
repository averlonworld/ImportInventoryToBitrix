import { useState, useMemo } from 'react';
import { ImportPreview } from '../types';

interface DataPreviewProps {
  preview: ImportPreview;
}

export default function DataPreview({ preview }: DataPreviewProps) {
  const [pageSize, setPageSize] = useState<number | 'ALL'>(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter rows based on search query
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return preview.rows;
    const q = searchQuery.toLowerCase().trim();
    return preview.rows.filter(row =>
      Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
    );
  }, [preview.rows, searchQuery]);

  // Recalculate pagination
  const totalFiltered = filteredRows.length;
  const effectivePageSize = pageSize === 'ALL' ? totalFiltered || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / effectivePageSize));
  const validPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = (validPage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, totalFiltered);
  const displayRows = filteredRows.slice(startIndex, endIndex);

  // Generate page numbers for pagination bar
  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [];
    if (validPage <= 4) {
      pages.push(1, 2, 3, 4, 5, '...', totalPages);
    } else if (validPage >= totalPages - 3) {
      pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, '...', validPage - 1, validPage, validPage + 1, '...', totalPages);
    }
    return pages;
  }, [validPage, totalPages]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
      {/* Top Header & Metadata */}
      <div className="border-b border-gray-200 px-4 py-3 bg-gray-50/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">File Preview</h3>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
            {preview.totalRows.toLocaleString()} Total Rows
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
          <span>File: <strong className="text-gray-900 font-medium">{preview.fileName}</strong></span>
          <span>Columns: <strong className="text-gray-900 font-medium">{preview.columnCount}</strong></span>
          <span>Sheet: <strong className="text-gray-900 font-medium">{preview.worksheetName || 'Sheet1'}</strong></span>
        </div>
      </div>

      {/* Search and Page Size Filter Bar */}
      <div className="px-4 py-2.5 bg-white border-b border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Search filter */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search rows (code, description, price)..."
            className="w-full pl-8 pr-7 py-1.5 rounded-md border border-gray-300 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          <svg className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setCurrentPage(1); }}
              className="absolute right-2 top-2 text-gray-400 hover:text-gray-600 text-xs font-bold"
            >
              ✕
            </button>
          )}
        </div>

        {/* Page size selector */}
        <div className="flex items-center gap-2">
          <label className="text-gray-600 font-medium">Rows per page:</label>
          <select
            value={pageSize}
            onChange={(e) => {
              const val = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value);
              setPageSize(val);
              setCurrentPage(1);
            }}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value="ALL">All ({preview.totalRows})</option>
          </select>
        </div>
      </div>

      {/* Table with horizontal scroll */}
      <div className="overflow-x-auto max-h-[520px]">
        <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
          <thead className="bg-gray-100/90 sticky top-0 z-10 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2.5 font-semibold text-gray-600 uppercase tracking-wider w-12 bg-gray-100">
                #
              </th>
              {preview.headers.map((header, idx) => (
                <th
                  key={idx}
                  className="px-3 py-2.5 font-semibold text-gray-700 uppercase tracking-wider whitespace-nowrap bg-gray-100"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={preview.headers.length + 1} className="py-8 text-center text-gray-500">
                  {searchQuery ? `No rows matching "${searchQuery}"` : 'No data rows available'}
                </td>
              </tr>
            ) : (
              displayRows.map((row, rowIdx) => {
                const rowNumber = row._rowNumber || startIndex + rowIdx + 1;
                return (
                  <tr key={rowIdx} className="hover:bg-blue-50/50 transition-colors">
                    <td className="px-3 py-2 text-xs font-mono text-gray-400 font-medium">
                      {rowNumber}
                    </td>
                    {preview.headers.map((header, colIdx) => {
                      const val = row[header];
                      return (
                        <td key={colIdx} className="px-3 py-2 whitespace-nowrap text-gray-800">
                          {val !== undefined && val !== null ? String(val) : ''}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom Pagination Bar */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="text-gray-600">
          Showing <span className="font-semibold text-gray-900">{totalFiltered === 0 ? 0 : startIndex + 1}</span> to{' '}
          <span className="font-semibold text-gray-900">{endIndex}</span> of{' '}
          <span className="font-semibold text-gray-900">{totalFiltered.toLocaleString()}</span> rows
          {searchQuery && (
            <span className="text-gray-400 ml-1">
              (filtered from {preview.totalRows.toLocaleString()} total)
            </span>
          )}
        </div>

        {pageSize !== 'ALL' && totalPages > 1 && (
          <div className="flex items-center gap-1">
            {/* First Page */}
            <button
              onClick={() => setCurrentPage(1)}
              disabled={validPage === 1}
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              title="First Page"
            >
              « First
            </button>

            {/* Prev Page */}
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={validPage === 1}
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              title="Previous Page"
            >
              ‹ Prev
            </button>

            {/* Page number buttons */}
            <div className="hidden sm:flex items-center gap-1">
              {pageNumbers.map((p, idx) => {
                if (typeof p === 'string') {
                  return <span key={idx} className="px-1 text-gray-400">...</span>;
                }
                const isActive = p === validPage;
                return (
                  <button
                    key={idx}
                    onClick={() => setCurrentPage(p)}
                    className={`min-w-[28px] h-7 px-1.5 rounded text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            {/* Next Page */}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={validPage === totalPages}
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              title="Next Page"
            >
              Next ›
            </button>

            {/* Last Page */}
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={validPage === totalPages}
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              title="Last Page"
            >
              Last »
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
