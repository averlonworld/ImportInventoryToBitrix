import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getMe, login as loginApi, licenticLogin as licenticLoginApi, logout as logoutApi } from '../services/auth.api';
import type { User, LicenseInfo } from '../types';

interface AuthContextType {
  user: User | null;
  license: LicenseInfo | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password?: string) => Promise<void>;
  loginWithLicentic: (email: string, productId?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await getMe();
        if (res.success && res.data) {
          setUser(res.data);
          if (res.data.license) {
            setLicense(res.data.license);
          }
        }
      } catch {
        setUser(null);
        setLicense(null);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  const login = async (email: string, password?: string) => {
    const res = await loginApi(email, password);
    if (res.success && res.data) {
      setUser(res.data.user);
      if (res.data.license) {
        setLicense(res.data.license);
      } else if (res.data.user.license) {
        setLicense(res.data.user.license);
      }
    } else {
      throw new Error(res.message || 'Login failed');
    }
  };

  const loginWithLicentic = async (email: string, productId?: string) => {
    const res = await licenticLoginApi(email, productId);
    if (res.success && res.data) {
      setUser(res.data.user);
      if (res.data.license) {
        setLicense(res.data.license);
      } else if (res.data.user.license) {
        setLicense(res.data.user.license);
      }
    } else {
      throw new Error(res.message || 'Licentic login failed');
    }
  };

  const logout = async () => {
    try {
      await logoutApi();
    } finally {
      setUser(null);
      setLicense(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        license,
        isAuthenticated: !!user,
        loading,
        login,
        loginWithLicentic,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}