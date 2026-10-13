import axios, { AxiosError } from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 60000,
});

// Attach Authorization Bearer token from localStorage for cross-site iframe compatibility
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const response = error.response;
    const isAuthCheck = error.config?.url?.includes('/auth/me');

    // If 401 occurs on an authenticated route (not initial session check), clear token and redirect
    if (response?.status === 401 && !isAuthCheck && window.location.pathname !== '/login') {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
