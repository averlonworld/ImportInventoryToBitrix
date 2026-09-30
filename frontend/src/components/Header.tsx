import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function Header() {
  const { user, license, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
      toast.success('Logged out successfully');
    } catch {
      toast.error('Logout failed');
    }
  };

  const activeLicense = license || user?.license;

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-gray-900">Bitrix24 Inventory Middleware</h1>
        {activeLicense && (
          <div
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
            title={`License Key: ${activeLicense.licenseKey}\nExpires: ${activeLicense.endDate ? new Date(activeLicense.endDate).toLocaleDateString() : 'Active'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Licentic: {activeLicense.planName}</span>
            {activeLicense.daysRemaining !== undefined && (
              <span className="text-emerald-600 font-normal">({activeLicense.daysRemaining}d left)</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="text-sm text-gray-700 flex items-center gap-2">
          <span className="font-medium text-gray-900">{user?.email}</span>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded font-mono">
            {user?.role}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-600 hover:text-red-600 font-medium transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
