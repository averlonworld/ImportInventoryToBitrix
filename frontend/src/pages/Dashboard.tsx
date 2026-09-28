import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDashboardStats } from '../services/dashboard.api';
import type { DashboardStats } from '../types';
import StatusBadge from '../components/StatusBadge';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await getDashboardStats();
        if (res.success && res.data) {
          setStats(res.data);
        } else {
          setError(res.message || 'Failed to load dashboard');
        }
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) {
    return <div className="flex items-center gap-2 text-gray-600"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div> Loading dashboard...</div>;
  }

  if (error) {
    return <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>;
  }

  const bitrixStatus = stats?.bitrixConnection;

  const cards = [
    { label: 'Total Imports', value: stats?.totalImports ?? 0, icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', color: 'blue' },
    { label: 'Total Records', value: stats?.totalRecords ?? 0, icon: 'M4 6h16M4 12h16M4 18h16', color: 'indigo' },
    { label: 'Successful', value: stats?.successfulRecords ?? 0, icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'green' },
    { label: 'Failed', value: stats?.failedRecords ?? 0, icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'red' },
    { label: 'Skipped', value: stats?.skippedRecords ?? 0, icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636', color: 'gray' },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    gray: 'bg-gray-100 text-gray-700',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        {/* <div className="flex gap-2">
          <Link to="/inventory/stock-receipt" className="btn-primary text-sm flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            Stock Receipt Import
          </Link>
          <Link to="/inventory/import" className="btn-secondary text-sm">Product Import</Link>
        </div> */}
      </div>

      {/* Statistics cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="card flex flex-col items-center text-center">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${colorMap[card.color]}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
              </svg>
            </div>
            <div className="text-2xl font-bold text-gray-900">{card.value.toLocaleString()}</div>
            <div className="text-xs text-gray-500 mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Bitrix connection status */}
      <div className="card">
        <h2 className="text-lg font-medium mb-3">Bitrix Connection</h2>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              bitrixStatus?.status === 'CONNECTED' ? 'bg-green-500' :
              bitrixStatus?.status === 'FAILED' ? 'bg-red-500' : 'bg-gray-400'
            }`} />
            <StatusBadge status={bitrixStatus?.status || 'UNKNOWN'} />
            <span className="text-sm text-gray-600">
              {bitrixStatus?.configured ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <Link to="/settings/bitrix" className="btn-secondary text-sm">
            {bitrixStatus?.configured ? 'Edit Configuration' : 'Configure Now'}
          </Link>
        </div>
        {bitrixStatus?.lastTestedAt && (
          <p className="text-xs text-gray-500 mt-2">
            Last tested: {new Date(bitrixStatus.lastTestedAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* Recent imports */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Recent Imports</h2>
          <Link to="/imports" className="text-sm text-blue-600 hover:text-blue-700">View all</Link>
        </div>
        {stats?.recentImports?.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No imports yet</p>
            <Link to="/inventory/import" className="text-blue-600 hover:text-blue-700 text-sm mt-2 inline-block">Start your first import</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">File</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Success</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Failed</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {stats?.recentImports?.map((imp) => (
                  <tr key={imp.id} onClick={() => navigate(`/imports/${imp.id}`)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-3 py-2 text-sm text-gray-500 font-mono">{imp.id.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-sm font-medium">{imp.fileName}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{new Date(imp.createdAt).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-sm text-right">{imp.totalRows}</td>
                    <td className="px-3 py-2 text-sm text-right text-green-600">{imp.successfulRows}</td>
                    <td className="px-3 py-2 text-sm text-right text-red-600">{imp.failedRows}</td>
                    <td className="px-3 py-2"><StatusBadge status={imp.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
