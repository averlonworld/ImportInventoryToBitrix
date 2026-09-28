interface StatusBadgeProps {
  status: string;
}

const statusStyles: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  PROCESSING: 'bg-blue-100 text-blue-800 border border-blue-200',
  SUCCESS: 'bg-green-100 text-green-800 border border-green-200',
  CREATED: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  UPDATED: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  FAILED: 'bg-red-100 text-red-800 border border-red-200',
  SKIPPED: 'bg-gray-100 text-gray-600 border border-gray-200',
  RETRYING: 'bg-amber-100 text-amber-800 border border-amber-200',
  PARTIAL_FAILURE: 'bg-orange-100 text-orange-800 border border-orange-200',
  COMPLETED: 'bg-green-100 text-green-800 border border-green-200',
  COMPLETED_WITH_ERRORS: 'bg-orange-100 text-orange-800 border border-orange-200',
  CONNECTED: 'bg-green-100 text-green-800 border border-green-200',
  UNKNOWN: 'bg-gray-100 text-gray-600 border border-gray-200',
  DEFAULT: 'bg-gray-100 text-gray-700 border border-gray-200',
};

export default function StatusBadge({ status, showIcon = true }: StatusBadgeProps & { showIcon?: boolean }) {
  const normalized = (status || '').toUpperCase();
  const style = statusStyles[normalized] || statusStyles.DEFAULT;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium shadow-xs ${style}`}>
      {showIcon && (normalized === 'PROCESSING' || normalized === 'RETRYING') && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping" />
      )}
      {showIcon && normalized === 'SUCCESS' && (
        <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
      )}
      {showIcon && normalized === 'FAILED' && (
        <svg className="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
      )}
      {status ? status.replace(/_/g, ' ') : '-'}
    </span>
  );
}
