import api from './api';
import type { User, LicenseInfo, ApiResponse } from '../types';

export interface AuthLoginResponse {
  user: User;
  token: string;
  license?: LicenseInfo;
}

export async function login(email: string, password?: string): Promise<ApiResponse<AuthLoginResponse>> {
  const payload: { email: string; password?: string } = { email };
  if (password && password.trim()) {
    payload.password = password;
  }
  const res = await api.post('/auth/login', payload);
  return res.data;
}

export async function licenticLogin(email: string, productId?: string): Promise<ApiResponse<AuthLoginResponse>> {
  const res = await api.post('/auth/licentic-login', { email, productId });
  return res.data;
}

export async function verifyLicense(email: string, productId?: string): Promise<ApiResponse<LicenseInfo>> {
  const res = await api.post('/auth/verify-license', { email, productId });
  return res.data;
}

export async function logout(): Promise<ApiResponse> {
  const res = await api.post('/auth/logout');
  return res.data;
}

export async function getMe(): Promise<ApiResponse<User>> {
  const res = await api.get('/auth/me');
  return res.data;
}