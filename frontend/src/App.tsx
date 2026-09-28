import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import InventoryImport from './pages/InventoryImport';
import StockReceiptImport from './pages/StockReceiptImport';
import InvoiceImport from './pages/InvoiceImport';
import ImportHistory from './pages/ImportHistory';
import ImportDetails from './pages/ImportDetails';
import BitrixSettings from './pages/BitrixSettings';
import DebugConsole from './pages/DebugConsole';
import ErrorHandling from './pages/ErrorHandling';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="flex items-center justify-center h-screen text-xl">Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="inventory/stock-receipt" element={<StockReceiptImport />} />
        <Route path="inventory/import" element={<InventoryImport />} />
        <Route path="invoices/import" element={<InvoiceImport />} />
        <Route path="imports" element={<ImportHistory />} />
        <Route path="imports/:id" element={<ImportDetails />} />
        <Route path="error-handling" element={<ErrorHandling />} />
        <Route path="settings/bitrix" element={<BitrixSettings />} />
        <Route path="debug" element={<DebugConsole />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}