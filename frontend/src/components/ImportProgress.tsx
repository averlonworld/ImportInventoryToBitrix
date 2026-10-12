import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import StatusBadge from './StatusBadge';
import { estimateTotalDuration, estimateRemainingTime, formatElapsedDuration } from '../utils/timeEstimate';

interface ImportProgressProps {
  importId: string;
  onComplete?: () => void;
}

export default function ImportProgress({ importId, onComplete }: ImportProgressProps) {
  const [progress, setProgress] = useState<any>(null);
  const [error, setError] = useState('');
  const [hasCompleted, setHasCompleted] = useState(false);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await api.get(`/imports/${importId}`);
      if (res.data.success) {
        setProgress(res.data.data);
        if (!hasCompleted && ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(res.data.data.status)) {
          setHasCompleted(true);
          onComplete?.();
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to fetch progress');
    }
  }, [importId, onComplete, hasCompleted]);

  useEffect(() => {
    fetchProgress();
    const interval = setInterval(fetchProgress, 3000);
    return () => clearInterval(interval);
  }, [fetchProgress]);

  if (error && !progress) {
    return <div className="text-red-600">{error}</div>;
  }

  if (!progress) {
    return <div className="flex items-center gap-2"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div> Loading...</div>;
  }

  const total = progress.totalRows || 0;
  const processed = progress.processedRows || 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  const isDone = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(progress.status);

  return (
    <div className="bg-white rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Import Progress</h3>
        <StatusBadge status={progress.status} />
      </div>

      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-600">Processed</span>
          <span className="font-medium">{processed} / {total}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className={`h-2.5 rounded-full transition-all duration-500 ${
              isDone && progress.failedRows > 0 ? 'bg-orange-500' : 'bg-blue-600'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-sm mt-1">
          <span className="text-xs text-gray-500 font-medium">
            {!isDone && progress.status === 'PENDING' && (
              <span>Est. Total Time: <strong>{estimateTotalDuration(total)}</strong></span>
            )}
            {!isDone && progress.status === 'PROCESSING' && (
              <span className="flex items-center gap-1.5 text-blue-700 font-medium">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Est. Time: <strong>{estimateRemainingTime(total, processed, progress.startedAt).text}</strong>
                {estimateRemainingTime(total, processed, progress.startedAt).speedText && (
                  <span className="text-gray-400 font-normal">({estimateRemainingTime(total, processed, progress.startedAt).speedText})</span>
                )}
              </span>
            )}
            {isDone && (
              <span className="text-gray-600">
                Duration: <strong>{formatElapsedDuration(progress.startedAt, progress.completedAt)}</strong>
              </span>
            )}
          </span>
          <span className="font-semibold text-gray-700">{pct}%</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 text-center">
        <div className="bg-green-50 rounded-lg p-3">
          <div className="text-2xl font-bold text-green-700">{progress.successfulRows || 0}</div>
          <div className="text-xs text-green-600">Successful</div>
        </div>
        <div className="bg-red-50 rounded-lg p-3">
          <div className="text-2xl font-bold text-red-700">{progress.failedRows || 0}</div>
          <div className="text-xs text-red-600">Failed</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-2xl font-bold text-gray-700">{progress.skippedRows || 0}</div>
          <div className="text-xs text-gray-600">Skipped</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-3">
          <div className="text-2xl font-bold text-blue-700">{total}</div>
          <div className="text-xs text-blue-600">Total</div>
        </div>
      </div>

      {isDone && (
        <div className="flex justify-end">
          <a
            href={`/imports/${importId}`}
            className="btn-primary text-sm"
          >
            View Details
          </a>
        </div>
      )}
    </div>
  );
}
