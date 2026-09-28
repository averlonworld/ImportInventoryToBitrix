import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  getImports,
  getImportRecords,
  retrySingleRecord,
  retryFailed,
  downloadErrorReport,
} from '../services/import.api';
import type {
  ImportJob,
  ImportRecord,
  ImportRecordsSummary,
} from '../types';
import StatusBadge from '../components/StatusBadge';

export default function ErrorHandling() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialJobId = searchParams.get('jobId') || '';
  const initialStatus = searchParams.get('status') || 'ALL';

  // Import jobs list for the dropdown
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>(initialJobId);
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null);
  const [loadingJobs, setLoadingJobs] = useState<boolean>(true);

  // Records & summary
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [summary, setSummary] = useState<ImportRecordsSummary>({
    totalRecords: 0,
    processing: 0,
    successful: 0,
    created: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    retrying: 0,
    pending: 0,
    totalRetries: 0,
  });
  const [jobMeta, setJobMeta] = useState<any>(null);
  const [loadingRecords, setLoadingRecords] = useState<boolean>(false);

  // Filters & Pagination
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [errorTypeFilter, setErrorTypeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(50);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalFilteredRecords, setTotalFilteredRecords] = useState<number>(0);

  // Modal & Retry State
  const [selectedRecordForModal, setSelectedRecordForModal] = useState<ImportRecord | null>(null);
  const [retryingRecordId, setRetryingRecordId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState<boolean>(false);
  const [downloadingReport, setDownloadingReport] = useState<boolean>(false);

  // Real-time polling
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const pollingRef = useRef<any>(null);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 350);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Load available import jobs
  const fetchJobs = useCallback(async (selectFirstIfNone = true) => {
    try {
      setLoadingJobs(true);
      const res = await getImports({ limit: 50 });
      if (res.success && res.data) {
        setJobs(res.data);
        if (selectFirstIfNone) {
          if (initialJobId && res.data.some((j: ImportJob) => j.id === initialJobId)) {
            setSelectedJobId(initialJobId);
          } else if (res.data.length > 0) {
            // Find an active one or pick the most recent
            const active = res.data.find((j: ImportJob) => j.status === 'PROCESSING' || j.status === 'PENDING');
            setSelectedJobId(active ? active.id : res.data[0].id);
          }
        }
      }
    } catch (err: any) {
      toast.error('Failed to load import jobs list');
    } finally {
      setLoadingJobs(false);
    }
  }, [initialJobId]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Sync selected job object when selectedJobId changes
  useEffect(() => {
    if (!selectedJobId) return;
    const match = jobs.find((j) => j.id === selectedJobId);
    if (match) setSelectedJob(match);

    // Update query params
    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.set('jobId', selectedJobId);
      return updated;
    });
  }, [selectedJobId, jobs, setSearchParams]);

  // Fetch records & summary for current job
  const fetchRecords = useCallback(
    async (showLoading = false) => {
      if (!selectedJobId) return;
      if (showLoading) setLoadingRecords(true);

      try {
        const res = await getImportRecords(selectedJobId, {
          page,
          limit,
          status: statusFilter,
          search: debouncedSearch,
          errorType: errorTypeFilter,
        });

        if (res.success && res.data) {
          setRecords(res.data.records);
          setSummary(res.data.summary);
          setJobMeta(res.data.job);
          setTotalPages(res.data.pagination.totalPages || 1);
          setTotalFilteredRecords(res.data.pagination.total || 0);
          setLastRefreshedAt(new Date());

          // If modal is open, keep its record data up-to-date
          if (selectedRecordForModal) {
            const updated = res.data.records.find((r) => r.id === selectedRecordForModal.id);
            if (updated) setSelectedRecordForModal(updated);
          }
        }
      } catch (err: any) {
        // Silently handle polling errors, only toast on manual fetch
        if (showLoading) {
          toast.error(err.response?.data?.message || 'Failed to fetch import records');
        }
      } finally {
        if (showLoading) setLoadingRecords(false);
      }
    },
    [selectedJobId, page, limit, statusFilter, debouncedSearch, errorTypeFilter, selectedRecordForModal]
  );

  // Trigger records fetch on filter/job changes
  useEffect(() => {
    if (selectedJobId) {
      fetchRecords(true);
    }
  }, [selectedJobId, page, limit, statusFilter, debouncedSearch, errorTypeFilter]);

  // Real-time polling loop (runs every 2.5s if active or enabled)
  useEffect(() => {
    if (!autoRefresh || !selectedJobId) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }

    const isJobActive =
      jobMeta?.status === 'PROCESSING' ||
      jobMeta?.status === 'PENDING' ||
      summary.processing > 0 ||
      summary.retrying > 0;

    // Poll faster (2.5s) if active, or steady (6s) if completed
    const interval = isJobActive ? 2500 : 6000;

    pollingRef.current = setInterval(() => {
      fetchRecords(false);
    }, interval);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [autoRefresh, selectedJobId, jobMeta?.status, summary.processing, summary.retrying, fetchRecords]);

  // Single record retry
  const handleSingleRetry = async (record: ImportRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!selectedJobId) return;

    setRetryingRecordId(record.id);
    // Instant UI optimistic update
    setRecords((prev) =>
      prev.map((r) =>
        r.id === record.id
          ? { ...r, status: 'RETRYING', retryCount: (r.retryCount || 0) + 1, errorMessage: 'Processing retry...' }
          : r
      )
    );

    try {
      const res = await retrySingleRecord(selectedJobId, record.id);
      if (res.success && res.data) {
        const updated = res.data;
        if (updated.status === 'SUCCESS') {
          toast.success(`Row #${updated.rowNumber} retried successfully!`);
        } else {
          toast.error(`Row #${updated.rowNumber} failed: ${updated.errorMessage || 'Unknown error'}`);
        }
        await fetchRecords(false);
      } else {
        toast.error(res.message || 'Retry failed');
        await fetchRecords(false);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to retry record');
      await fetchRecords(false);
    } finally {
      setRetryingRecordId(null);
    }
  };

  // Retry all failed records
  const handleRetryAllFailed = async () => {
    if (!selectedJobId) return;
    setRetryingAll(true);
    try {
      const res = await retryFailed(selectedJobId);
      if (res.success) {
        toast.success(`Requeued ${res.data?.retriedCount ?? summary.failed} failed records for processing`);
        await fetchRecords(true);
        await fetchJobs(false);
      } else {
        toast.error(res.message || 'Failed to trigger retry for all records');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error retrying records');
    } finally {
      setRetryingAll(false);
    }
  };

  // Download Error Report Excel
  const handleDownloadErrorReport = async () => {
    if (!selectedJobId) return;
    setDownloadingReport(true);
    try {
      const blob = await downloadErrorReport(selectedJobId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `error_report_${jobMeta?.fileName || selectedJobId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Error report downloaded successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to download error report');
    } finally {
      setDownloadingReport(false);
    }
  };

  // Quick filter helper by clicking a summary card
  const handleCardFilterClick = (statusKey: string) => {
    setStatusFilter(statusKey);
    setPage(1);
    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.set('status', statusKey);
      return updated;
    });
  };

  // Format currency (INR)
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

  // Format quantities
  const formatQty = (val: any) => {
    if (val === null || val === undefined || val === '') return '-';
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return num.toLocaleString();
  };

  const isJobProcessing =
    jobMeta?.status === 'PROCESSING' ||
    summary.processing > 0 ||
    summary.retrying > 0;

  const totalCalculated = summary.totalRecords || (jobMeta?.totalRows ?? 0);
  const completedCount = summary.successful + summary.failed + summary.skipped;
  const progressPercent = totalCalculated > 0 ? Math.min(100, Math.round((completedCount / totalCalculated) * 100)) : 0;

  return (
    <div className="space-y-6">
      {/* 1. Header with Controls & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Error Handling & Import Monitoring</h1>
            {isJobProcessing && (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                Live Processing
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Real-time row-by-row visibility, live execution statuses, instant error diagnostics, and record retry.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Live Polling Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? 'Click to pause live updates' : 'Click to resume live updates'}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              autoRefresh
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                : 'bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'
              }`}
            />
            {autoRefresh ? 'Live Auto-Refresh ON' : 'Live Auto-Refresh Paused'}
          </button>

          {/* Manual Refresh Button */}
          <button
            onClick={() => fetchRecords(true)}
            disabled={loadingRecords}
            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3"
            title="Refresh now"
          >
            <svg
              className={`w-3.5 h-3.5 ${loadingRecords ? 'animate-spin text-blue-600' : 'text-gray-500'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>

          {/* Download Error Report */}
          <button
            onClick={handleDownloadErrorReport}
            disabled={downloadingReport || summary.failed === 0}
            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3 text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-40"
            title={summary.failed === 0 ? 'No failed records to export' : 'Download Excel report of failed rows'}
          >
            <svg className="w-3.5 h-3.5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {downloadingReport ? 'Downloading...' : 'Download Error Report'}
          </button>

          {/* Retry All Failed Button */}
          <button
            onClick={handleRetryAllFailed}
            disabled={retryingAll || summary.failed === 0}
            className="btn-danger text-xs flex items-center gap-1.5 py-1.5 px-3 shadow-xs disabled:opacity-40"
            title={summary.failed === 0 ? 'No failed records to retry' : 'Requeue all failed records for this import'}
          >
            <svg className={`w-3.5 h-3.5 ${retryingAll ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {retryingAll ? 'Retrying All...' : `Retry All Failed (${summary.failed})`}
          </button>
        </div>
      </div>

      {/* 2. Import Selection Dropdown & Metadata Bar */}
      <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          {/* Import Dropdown */}
          <div className="lg:col-span-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Select Import Job
            </label>
            <div className="relative">
              <select
                value={selectedJobId}
                onChange={(e) => {
                  setSelectedJobId(e.target.value);
                  setPage(1);
                }}
                disabled={loadingJobs}
                className="w-full bg-gray-50 hover:bg-gray-100/80 border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
                {loadingJobs && <option>Loading imports...</option>}
                {!loadingJobs && jobs.length === 0 && <option>No imports found</option>}
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.fileName} • {job.status} • {job.totalRows} rows • ({new Date(job.createdAt).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Selected Job Metadata */}
          {jobMeta && (
            <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50/80 rounded-lg p-3 border border-gray-100 text-xs">
              <div>
                <span className="text-gray-400 block font-medium">Import ID</span>
                <span className="font-mono text-gray-700 font-semibold truncate block" title={jobMeta.id}>
                  {jobMeta.id.slice(0, 12)}...
                </span>
              </div>
              <div>
                <span className="text-gray-400 block font-medium">Uploaded By</span>
                <span className="text-gray-700 font-medium truncate block">{jobMeta.createdBy || 'system'}</span>
              </div>
              <div>
                <span className="text-gray-400 block font-medium">Upload Date & Time</span>
                <span className="text-gray-700 font-medium block">
                  {jobMeta.createdAt ? new Date(jobMeta.createdAt).toLocaleString() : '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block font-medium">Overall Status</span>
                <div className="mt-0.5">
                  <StatusBadge status={jobMeta.status} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Real-Time Processing Progress Bar */}
      {isJobProcessing && (
        <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 border border-blue-200 rounded-xl p-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-ping" />
              <span className="text-sm font-bold text-blue-900">
                Processing {completedCount.toLocaleString()} / {totalCalculated.toLocaleString()} records
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-200/80 text-blue-800">
                {progressPercent}% Complete
              </span>
            </div>
            <div className="text-xs text-blue-800 font-medium">
              Total: {totalCalculated} | Success: {summary.successful} | Updated: {summary.updated} | Created: {summary.created} | Failed: {summary.failed} | Processing: {summary.processing}
            </div>
          </div>

          {/* Animated Progress Bar */}
          <div className="w-full bg-blue-200/60 rounded-full h-3 overflow-hidden flex">
            <div
              className="bg-emerald-500 h-full transition-all duration-500"
              style={{ width: `${totalCalculated > 0 ? (summary.successful / totalCalculated) * 100 : 0}%` }}
              title={`Successful: ${summary.successful}`}
            />
            <div
              className="bg-red-500 h-full transition-all duration-500"
              style={{ width: `${totalCalculated > 0 ? (summary.failed / totalCalculated) * 100 : 0}%` }}
              title={`Failed: ${summary.failed}`}
            />
            <div
              className="bg-blue-500 h-full transition-all duration-500 animate-pulse"
              style={{ width: `${totalCalculated > 0 ? (summary.processing / totalCalculated) * 100 : 0}%` }}
              title={`Processing: ${summary.processing}`}
            />
          </div>
        </div>
      )}

      {/* 4. Import Summary Cards (8 Counters required) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* Total Records */}
        <div
          onClick={() => handleCardFilterClick('ALL')}
          className={`cursor-pointer rounded-xl p-3 border transition-all ${
            statusFilter === 'ALL'
              ? 'bg-blue-50/70 border-blue-500 ring-2 ring-blue-400/30'
              : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Total Records</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{summary.totalRecords.toLocaleString()}</div>
          <div className="text-[10px] text-gray-400 mt-1">All file rows</div>
        </div>

        {/* Processing */}
        <div
          onClick={() => handleCardFilterClick('PROCESSING')}
          className={`cursor-pointer rounded-xl p-3 border transition-all ${
            statusFilter === 'PROCESSING'
              ? 'bg-blue-50/70 border-blue-500 ring-2 ring-blue-400/30'
              : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider flex items-center justify-between">
            Processing
            {summary.processing > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />}
          </div>
          <div className="text-2xl font-bold text-blue-600 mt-1">{summary.processing.toLocaleString()}</div>
          <div className="text-[10px] text-blue-400 mt-1">Active worker</div>
        </div>

        {/* Successful */}
        <div
          onClick={() => handleCardFilterClick('SUCCESS')}
          className={`cursor-pointer rounded-xl p-3 border transition-all ${
            statusFilter === 'SUCCESS'
              ? 'bg-green-50/70 border-green-500 ring-2 ring-green-400/30'
              : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold text-green-700 uppercase tracking-wider">Successful</div>
          <div className="text-2xl font-bold text-green-700 mt-1">{summary.successful.toLocaleString()}</div>
          <div className="text-[10px] text-green-500 mt-1">Synced to Bitrix</div>
        </div>

        {/* Updated */}
        <div
          onClick={() => handleCardFilterClick('UPDATED')}
          className={`cursor-pointer rounded-xl p-3 border transition-all ${
            statusFilter === 'UPDATED'
              ? 'bg-indigo-50/70 border-indigo-500 ring-2 ring-indigo-400/30'
              : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">Updated</div>
          <div className="text-2xl font-bold text-indigo-700 mt-1">{summary.updated.toLocaleString()}</div>
          <div className="text-[10px] text-indigo-400 mt-1">Existing records</div>
        </div>

        {/* Created */}
        <div
          onClick={() => handleCardFilterClick('CREATED')}
          className={`cursor-pointer rounded-xl p-3 border transition-all ${
            statusFilter === 'CREATED'
              ? 'bg-emerald-50/70 border-emerald-500 ring-2 ring-emerald-400/30'
              : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Created</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{summary.created.toLocaleString()}</div>
          <div className="text-[10px] text-emerald-500 mt-1">New Bitrix items</div>
        </div>

        {/* Failed */}
        <div
          onClick={() => handleCardFilterClick('FAILED')}
          className={`cursor-pointer rounded-xl p-3 border transition-all ${
            statusFilter === 'FAILED'
              ? 'bg-red-50/70 border-red-500 ring-2 ring-red-400/30'
              : summary.failed > 0
              ? 'bg-red-50/30 border-red-200 hover:border-red-400 hover:shadow-xs'
              : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold text-red-600 uppercase tracking-wider flex items-center justify-between">
            Failed
            {summary.failed > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />}
          </div>
          <div className="text-2xl font-bold text-red-600 mt-1">{summary.failed.toLocaleString()}</div>
          <div className="text-[10px] text-red-400 mt-1">Needs attention</div>
        </div>

        {/* Skipped */}
        <div
          onClick={() => handleCardFilterClick('SKIPPED')}
          className={`cursor-pointer rounded-xl p-3 border transition-all ${
            statusFilter === 'SKIPPED'
              ? 'bg-gray-100 border-gray-500 ring-2 ring-gray-400/30'
              : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Skipped</div>
          <div className="text-2xl font-bold text-gray-600 mt-1">{summary.skipped.toLocaleString()}</div>
          <div className="text-[10px] text-gray-400 mt-1">Intentionally omitted</div>
        </div>

        {/* Retrying */}
        <div
          onClick={() => handleCardFilterClick('RETRYING')}
          className={`cursor-pointer rounded-xl p-3 border transition-all ${
            statusFilter === 'RETRYING'
              ? 'bg-amber-50/70 border-amber-500 ring-2 ring-amber-400/30'
              : summary.retrying > 0
              ? 'bg-amber-50/30 border-amber-200 hover:border-amber-400 hover:shadow-xs'
              : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider flex items-center justify-between">
            Retrying
            {summary.retrying > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />}
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{summary.retrying.toLocaleString()}</div>
          <div className="text-[10px] text-amber-500 mt-1">{summary.totalRetries} retry attempts</div>
        </div>
      </div>

      {/* 5. Final Result Summary (when completed) */}
      {jobMeta && jobMeta.status === 'COMPLETED' && (
        <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-bold text-emerald-900">Import Processing Completed</h4>
              <p className="text-xs text-emerald-700">
                Finished processing {summary.totalRecords} records in {jobMeta.duration ?? 0}s.
                {summary.failed > 0
                  ? ` ${summary.failed} record(s) failed and can be retried or exported.`
                  : ' All records processed with zero failures!'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="px-2.5 py-1 bg-white border border-emerald-200 rounded-md text-emerald-800">
              Created: <strong>{summary.created}</strong>
            </span>
            <span className="px-2.5 py-1 bg-white border border-emerald-200 rounded-md text-indigo-800">
              Updated: <strong>{summary.updated}</strong>
            </span>
            <span className="px-2.5 py-1 bg-white border border-emerald-200 rounded-md text-gray-700">
              Duration: <strong>{jobMeta.duration ?? 0}s</strong>
            </span>
          </div>
        </div>
      )}

      {/* 6. Filters & Search Toolbar */}
      <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
          {/* Search Box */}
          <div className="lg:col-span-5 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by CODE, Part #, Description, or Error reason..."
              className="w-full pl-9 pr-8 py-2 text-xs bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="lg:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 text-xs bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            >
              <option value="ALL">All Statuses ({summary.totalRecords})</option>
              <option value="FAILED">Failed ({summary.failed})</option>
              <option value="RETRYING">Retrying ({summary.retrying})</option>
              <option value="PROCESSING">Processing ({summary.processing})</option>
              <option value="CREATED">Created ({summary.created})</option>
              <option value="UPDATED">Updated ({summary.updated})</option>
              <option value="SUCCESS">Success ({summary.successful})</option>
              <option value="SKIPPED">Skipped ({summary.skipped})</option>
              <option value="PENDING">Pending ({summary.pending})</option>
            </select>
          </div>

          {/* Error Type Filter */}
          <div className="lg:col-span-2">
            <select
              value={errorTypeFilter}
              onChange={(e) => {
                setErrorTypeFilter(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 text-xs bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            >
              <option value="ALL">All Error Types</option>
              <option value="VALIDATION_ERROR">Validation Errors</option>
              <option value="BITRIX_API_ERROR">Bitrix API Errors</option>
              <option value="RATE_LIMIT_ERROR">Rate Limits (429)</option>
              <option value="AUTH_ERROR">Auth / Token Errors</option>
              <option value="NETWORK_ERROR">Network / Timeouts</option>
              <option value="DUPLICATE_ERROR">Duplicate Products</option>
              <option value="PROCESSING_ERROR">General Processing Errors</option>
            </select>
          </div>

          {/* Limit / Page Size & Count info */}
          <div className="lg:col-span-2 flex items-center justify-end gap-2 text-xs text-gray-500">
            <span>Show:</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="py-1 px-2 text-xs bg-gray-50 border border-gray-300 rounded-md focus:outline-none"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="font-semibold text-gray-700">({totalFilteredRecords} rows)</span>
          </div>
        </div>
      </div>

      {/* 7. Live Record Table */}
      <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
            <thead className="bg-gray-50/90 text-gray-600 font-semibold tracking-wider uppercase">
              <tr>
                <th className="px-3 py-3 w-12 text-center">Row</th>
                <th className="px-3 py-3 font-bold text-gray-900">CODE</th>
                <th className="px-3 py-3">PART NUMBER</th>
                <th className="px-4 py-3 min-w-[200px]">DESCRIPTION</th>
                <th className="px-3 py-3 text-right">QTY STOCK</th>
                <th className="px-3 py-3 text-right">QTY ORDER</th>
                <th className="px-3 py-3 text-right">COST</th>
                <th className="px-3 py-3 text-right">DEALER PRICE</th>
                <th className="px-3 py-3 text-right">END USER PRICE</th>
                <th className="px-3 py-3 text-center">STATUS</th>
                <th className="px-4 py-3 min-w-[220px]">ERROR REASON</th>
                <th className="px-3 py-3 text-center">UPDATED</th>
                <th className="px-2 py-3 text-center">RETRIES</th>
                <th className="px-3 py-3 text-center sticky right-0 bg-gray-50/95 shadow-xs">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loadingRecords && records.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                      <span className="font-medium">Loading live import records...</span>
                    </div>
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="font-medium text-gray-700">No records found</span>
                      <span className="text-xs text-gray-400">
                        Try changing the status filter or search query.
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                records.map((rec) => {
                  const isFailed = rec.status === 'FAILED' || rec.status === 'PARTIAL_FAILURE';
                  const isRetrying = rec.status === 'RETRYING' || retryingRecordId === rec.id;
                  const isProcessing = rec.status === 'PROCESSING';
                  const isSuccess = rec.status === 'SUCCESS';

                  // Row background highlighting per user specification
                  let rowBg = 'hover:bg-gray-50/80';
                  let borderLeft = 'border-l-4 border-l-transparent';

                  if (isFailed) {
                    rowBg = 'bg-red-50/40 hover:bg-red-50/80';
                    borderLeft = 'border-l-4 border-l-red-500';
                  } else if (isRetrying) {
                    rowBg = 'bg-amber-50/40 hover:bg-amber-50/80';
                    borderLeft = 'border-l-4 border-l-amber-500';
                  } else if (isProcessing) {
                    rowBg = 'bg-blue-50/30 hover:bg-blue-50/70';
                    borderLeft = 'border-l-4 border-l-blue-500';
                  } else if (isSuccess) {
                    borderLeft = 'border-l-4 border-l-emerald-500';
                  }

                  // Determine display error
                  const displayError = rec.errorMessage || rec.bitrixError;

                  return (
                    <tr
                      key={rec.id}
                      onClick={() => setSelectedRecordForModal(rec)}
                      className={`cursor-pointer transition-colors ${rowBg} ${borderLeft}`}
                    >
                      {/* Row # */}
                      <td className="px-3 py-2.5 text-center font-mono text-gray-500 font-semibold">
                        {rec.rowNumber}
                      </td>

                      {/* CODE (SKU) */}
                      <td className="px-3 py-2.5 font-mono font-bold text-gray-900 whitespace-nowrap">
                        {rec.sku || '-'}
                      </td>

                      {/* PART NUMBER */}
                      <td className="px-3 py-2.5 font-medium text-gray-700 whitespace-nowrap">
                        {rec.partNumber || '-'}
                      </td>

                      {/* DESCRIPTION */}
                      <td className="px-4 py-2.5 text-gray-800 max-w-xs">
                        <div className="line-clamp-2" title={rec.description || rec.productName || ''}>
                          {rec.description || rec.productName || '-'}
                        </div>
                      </td>

                      {/* QTY IN STOCK */}
                      <td className="px-3 py-2.5 text-right font-mono font-medium text-gray-900">
                        {formatQty(rec.qtyInStock ?? rec.quantityArrived)}
                      </td>

                      {/* QTY ON ORDER */}
                      <td className="px-3 py-2.5 text-right font-mono text-gray-600">
                        {formatQty(rec.qtyOnOrder)}
                      </td>

                      {/* COST */}
                      <td className="px-3 py-2.5 text-right font-mono text-gray-700">
                        {formatCurrency(rec.cost ?? rec.purchasePrice)}
                      </td>

                      {/* DEALER PRICE */}
                      <td className="px-3 py-2.5 text-right font-mono font-medium text-blue-700">
                        {formatCurrency(rec.dealerPrice)}
                      </td>

                      {/* END USER PRICE */}
                      <td className="px-3 py-2.5 text-right font-mono font-medium text-emerald-700">
                        {formatCurrency(rec.endUserPrice ?? rec.salesPrice)}
                      </td>

                      {/* Processing Status Badge */}
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <StatusBadge
                          status={
                            isRetrying
                              ? 'RETRYING'
                              : rec.status === 'SUCCESS' && rec.actionTaken
                              ? rec.actionTaken
                              : rec.status
                          }
                        />
                      </td>

                      {/* Instant Error Reason */}
                      <td className="px-4 py-2.5 text-xs max-w-sm">
                        {displayError ? (
                          <div className="flex items-start gap-1.5 text-red-600 font-medium">
                            <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span className="line-clamp-2" title={displayError}>
                              {displayError}
                            </span>
                          </div>
                        ) : rec.status === 'SUCCESS' ? (
                          <span className="text-emerald-600 flex items-center gap-1 font-medium">
                            <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            {rec.actionTaken === 'CREATED' ? 'Created in Bitrix24' : 'Updated in Bitrix24'}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>

                      {/* Last Updated Timestamp */}
                      <td className="px-3 py-2.5 text-center text-gray-500 whitespace-nowrap font-mono text-[11px]">
                        {rec.updatedAt ? new Date(rec.updatedAt).toLocaleTimeString() : '-'}
                      </td>

                      {/* Retry Count */}
                      <td className="px-2 py-2.5 text-center font-mono">
                        {(rec.retryCount || 0) > 0 ? (
                          <span className="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold text-[10px]">
                            {rec.retryCount}
                          </span>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>

                      {/* Action buttons (Retry & View Details) */}
                      <td
                        className="px-3 py-2.5 text-center sticky right-0 bg-white/95 shadow-xs whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Single Record Retry Button */}
                          <button
                            onClick={(e) => handleSingleRetry(rec, e)}
                            disabled={isRetrying || (!isFailed && rec.status !== 'RETRYING')}
                            className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
                              isFailed
                                ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30'
                            }`}
                            title={isFailed ? 'Retry processing this record now' : 'Retry'}
                          >
                            <svg
                              className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin text-amber-600' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>

                          {/* View Details Modal Trigger */}
                          <button
                            onClick={() => setSelectedRecordForModal(rec)}
                            className="p-1.5 rounded-md text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="View full record & debug details"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="bg-gray-50/80 px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600">
          <div>
            Showing <span className="font-semibold">{records.length > 0 ? (page - 1) * limit + 1 : 0}</span> to{' '}
            <span className="font-semibold">{Math.min(page * limit, totalFilteredRecords)}</span> of{' '}
            <span className="font-semibold">{totalFilteredRecords}</span> filtered rows
            {lastRefreshedAt && (
              <span className="ml-2 text-gray-400">
                (Last updated: {lastRefreshedAt.toLocaleTimeString()})
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded border border-gray-300 bg-white font-medium hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="px-2 font-medium text-gray-700">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded border border-gray-300 bg-white font-medium hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* 8. Error & Record Details Modal / Drawer */}
      {selectedRecordForModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50/80">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-gray-200 text-gray-800 font-mono font-bold rounded text-xs">
                  Row #{selectedRecordForModal.rowNumber}
                </span>
                <div>
                  <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                    {selectedRecordForModal.sku || 'No SKU'}
                    <span className="text-xs font-normal text-gray-500">
                      {selectedRecordForModal.partNumber ? `(${selectedRecordForModal.partNumber})` : ''}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500 truncate max-w-md">
                    {selectedRecordForModal.description || selectedRecordForModal.productName || 'No Description'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusBadge status={selectedRecordForModal.status} />
                <button
                  onClick={() => setSelectedRecordForModal(null)}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto text-xs">
              {/* Error Reason Banner (if failed) */}
              {(selectedRecordForModal.errorMessage || selectedRecordForModal.bitrixError) && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-red-800 font-bold">
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Error Diagnostic Reason
                    </div>
                    {selectedRecordForModal.errorType && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-red-200 text-red-800 uppercase">
                        {selectedRecordForModal.errorType}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-medium text-red-900 bg-white/70 p-3 rounded-lg border border-red-200 font-mono break-words">
                    {selectedRecordForModal.errorMessage || selectedRecordForModal.bitrixError}
                  </div>
                  {selectedRecordForModal.bitrixError && selectedRecordForModal.errorMessage !== selectedRecordForModal.bitrixError && (
                    <div className="text-xs text-red-700 bg-white/50 p-2.5 rounded-lg border border-red-100 font-mono break-words">
                      <span className="font-semibold block mb-1">Bitrix24 API Raw Output:</span>
                      {selectedRecordForModal.bitrixError}
                    </div>
                  )}
                </div>
              )}

              {/* Excel Row Key-Values Grid */}
              <div>
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Excel Row Values
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <div className="bg-white p-2 rounded-lg border border-gray-100">
                    <span className="text-gray-400 block text-[10px] uppercase font-semibold">CODE</span>
                    <span className="font-mono font-bold text-gray-800">{selectedRecordForModal.sku || '-'}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-gray-100">
                    <span className="text-gray-400 block text-[10px] uppercase font-semibold">PART NUMBER</span>
                    <span className="font-medium text-gray-800">{selectedRecordForModal.partNumber || '-'}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-gray-100">
                    <span className="text-gray-400 block text-[10px] uppercase font-semibold">QTY IN STOCK</span>
                    <span className="font-mono font-bold text-gray-900">{formatQty(selectedRecordForModal.qtyInStock ?? selectedRecordForModal.quantityArrived)}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-gray-100">
                    <span className="text-gray-400 block text-[10px] uppercase font-semibold">QTY ON ORDER</span>
                    <span className="font-mono text-gray-800">{formatQty(selectedRecordForModal.qtyOnOrder)}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-gray-100">
                    <span className="text-gray-400 block text-[10px] uppercase font-semibold">COST</span>
                    <span className="font-mono text-gray-800">{formatCurrency(selectedRecordForModal.cost ?? selectedRecordForModal.purchasePrice)}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-gray-100">
                    <span className="text-gray-400 block text-[10px] uppercase font-semibold">DEALER PRICE</span>
                    <span className="font-mono font-bold text-blue-700">{formatCurrency(selectedRecordForModal.dealerPrice)}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-gray-100">
                    <span className="text-gray-400 block text-[10px] uppercase font-semibold">END USER PRICE</span>
                    <span className="font-mono font-bold text-emerald-700">{formatCurrency(selectedRecordForModal.endUserPrice ?? selectedRecordForModal.salesPrice)}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-gray-100">
                    <span className="text-gray-400 block text-[10px] uppercase font-semibold">RETRY COUNT</span>
                    <span className="font-mono text-amber-800 font-bold">{selectedRecordForModal.retryCount || 0}</span>
                  </div>
                </div>
              </div>

              {/* Complete Raw Excel JSON (if available) */}
              {selectedRecordForModal.rawData && (
                <div>
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                    Complete Raw Uploaded Excel Row Data
                  </h4>
                  <pre className="bg-gray-900 text-gray-100 p-3 rounded-xl overflow-x-auto text-[11px] font-mono leading-relaxed max-h-48">
                    {JSON.stringify(selectedRecordForModal.rawData, null, 2)}
                  </pre>
                </div>
              )}

              {/* Bitrix24 Diagnostic & Tracking Metadata */}
              <div>
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  System & Bitrix24 Tracking
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <div>
                    <span className="text-gray-400 block text-[10px] uppercase font-medium">Bitrix Product ID</span>
                    <span className="font-mono font-bold text-blue-600">
                      {selectedRecordForModal.bitrixProductId ? `#${selectedRecordForModal.bitrixProductId}` : 'Not Linked'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[10px] uppercase font-medium">Action Taken</span>
                    <span className="font-medium text-gray-800">{selectedRecordForModal.actionTaken || 'None'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[10px] uppercase font-medium">Last Processed</span>
                    <span className="text-gray-700">
                      {selectedRecordForModal.updatedAt ? new Date(selectedRecordForModal.updatedAt).toLocaleString() : '-'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-t border-gray-200">
              <span className="text-xs text-gray-400 font-mono">
                Record ID: {selectedRecordForModal.id}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedRecordForModal(null)}
                  className="btn-secondary text-xs py-2 px-4"
                >
                  Close
                </button>

                <button
                  onClick={() => handleSingleRetry(selectedRecordForModal)}
                  disabled={retryingRecordId === selectedRecordForModal.id}
                  className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5"
                >
                  <svg
                    className={`w-3.5 h-3.5 ${retryingRecordId === selectedRecordForModal.id ? 'animate-spin' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {retryingRecordId === selectedRecordForModal.id ? 'Retrying Record...' : 'Retry Record Now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
