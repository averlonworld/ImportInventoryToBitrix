import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getImports } from '../services/import.api';
import type { ImportJob } from '../types';
import StatusBadge from '../components/StatusBadge';

const FILTERS = ['ALL', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'PROCESSING', 'PENDING'];

export default function ImportHistory() {
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const navigate = useNavigate();

  const fetchImports = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getImports({ status: filter, page, limit: 20 });
      if (res.success) {
        setImports(res.data || []);
        setTotalPages(res.totalPages || 1);
        setTotal(res.total || 0);
      } else {
        setError(res.message || 'Failed to load imports');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load imports');
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    fetchImports();
  }, [fetchImports]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Import History</h1>
        <span className="text-sm text-gray-500">{total} total imports</span>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(1); }}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-600"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div> Loading...</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>
      ) : imports.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">
          <p className="text-lg mb-2">No imports found</p>
          <p className="text-sm">Upload an Excel file to start importing inventory</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date & Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">File Name</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-blue-600 uppercase">New Created</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-indigo-600 uppercase">Updated</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-green-600 uppercase">Success</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-red-600 uppercase">Failed</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-amber-600 uppercase">Duplicates</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {imports.map((imp) => (
                  <tr key={imp.id} onClick={() => navigate(`/imports/${imp.id}`)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{new Date(imp.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm font-medium truncate max-w-xs">{imp.fileName}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold">{imp.totalRows}</td>
                    <td className="px-4 py-3 text-sm text-right text-blue-600 font-medium">{imp.createdProductsCount ?? 0}</td>
                    <td className="px-4 py-3 text-sm text-right text-indigo-600 font-medium">{imp.updatedProductsCount ?? 0}</td>
                    <td className="px-4 py-3 text-sm text-right text-green-600 font-semibold">{imp.successfulRows}</td>
                    <td className="px-4 py-3 text-sm text-right text-red-600 font-semibold">{imp.failedRows}</td>
                    <td className="px-4 py-3 text-sm text-right text-amber-600 font-medium">{imp.duplicateRows ?? 0}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-[120px]">{imp.createdBy?.email || 'admin'}</td>
                    <td className="px-4 py-3"><StatusBadge status={imp.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary text-sm"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-secondary text-sm"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
