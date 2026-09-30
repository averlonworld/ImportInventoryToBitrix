import axios, { AxiosError } from 'axios';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { debugLog } from '../debug/debugLog.service';
import { LicenseInfo } from '../../types';

export interface LicenticVerifyResult {
  valid: boolean;
  message: string;
  license?: LicenseInfo;
}

export class LicenticService {
  private apiBase: string;
  private defaultProductId: string;

  constructor() {
    this.apiBase = env.LICENTIC_API_BASE.replace(/\/+$/, '');
    this.defaultProductId = env.LICENTIC_PRODUCT_ID;
  }

  /**
   * Authenticates user credentials (email & password) directly against Licentic's auth endpoint.
   */
  async authenticateUser(email: string, password: string): Promise<{ success: boolean; message: string; data?: any }> {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail || !password) {
      return { success: false, message: 'Email and password are required' };
    }

    const licenticBase = this.apiBase.replace(/\/external\/?$/, '');
    const loginUrl = `${licenticBase}/auth/login`;

    try {
      logger.info({ email: cleanEmail }, 'Authenticating credentials with Licentic');
      debugLog.debug('LICENTIC', `Verifying credentials with Licentic for ${cleanEmail}`);

      const response = await axios.post(
        loginUrl,
        { email: cleanEmail, password },
        {
          timeout: 12000,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Bitrix24-Inventory-Middleware/1.0',
          },
        }
      );

      if (response.data && response.data.success) {
        debugLog.info('LICENTIC', `Licentic credential verification succeeded for ${cleanEmail}`);
        return { success: true, message: 'Authentication successful', data: response.data };
      }

      return {
        success: false,
        message: response.data?.message || 'Invalid credentials in Licentic',
      };
    } catch (err: any) {
      const axiosError = err as AxiosError<any>;
      const responseData = axiosError.response?.data;
      const message = responseData?.message || (axiosError.response?.status === 401 ? 'Invalid email or password' : 'Authentication failed with Licentic');

      debugLog.warn('LICENTIC', `Licentic credential verification failed for ${cleanEmail}: ${message}`);
      return { success: false, message };
    }
  }

  /**
   * Verifies if an email has an active, valid license for the specified product ID in Licentic.
   * Note: The email is automatically trimmed and converted to lowercase because the Licentic API
   * is strictly case-sensitive.
   */
  async verifyLicense(email: string, productId?: string): Promise<LicenticVerifyResult> {
    const cleanEmail = (email || '').toLowerCase().trim();
    const targetProductId = (productId || this.defaultProductId).trim();

    if (!cleanEmail) {
      return { valid: false, message: 'Email address is required' };
    }

    if (!targetProductId) {
      return { valid: false, message: 'Product ID is required for license verification' };
    }

    const url = `${this.apiBase}/actve-license/${encodeURIComponent(cleanEmail)}?productId=${encodeURIComponent(targetProductId)}`;

    try {
      logger.info({ email: cleanEmail, productId: targetProductId }, 'Checking Licentic license status');
      debugLog.debug('LICENTIC', `Verifying license for ${cleanEmail} (Product: ${targetProductId})`);

      const response = await axios.get(url, {
        timeout: 12000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Bitrix24-Inventory-Middleware/1.0',
        },
      });

      const data = response.data;

      if (!data || typeof data !== 'object') {
        logger.warn({ data }, 'Unexpected response structure from Licentic API');
        return { valid: false, message: 'Unexpected response from license server' };
      }

      if (!data.success) {
        const errorMsg = data.message || 'License verification failed';
        logger.warn({ email: cleanEmail, errorMsg }, 'Licentic reported license not active or not found');
        debugLog.warn('LICENTIC', `License verification failed for ${cleanEmail}: ${errorMsg}`);
        return { valid: false, message: errorMsg };
      }

      const activeLicense = data.activeLicense;
      if (!activeLicense) {
        return { valid: false, message: 'No active license record found for this product' };
      }

      // Check status
      const status = String(activeLicense.status || '').toLowerCase();
      if (status !== 'active') {
        const statusMsg = `License is currently ${status || 'inactive'}. Please contact administrator.`;
        debugLog.warn('LICENTIC', `License for ${cleanEmail} is not active (status: ${status})`);
        return { valid: false, message: statusMsg };
      }

      // Check expiry
      const expiryInfo = data.expiryInfo || activeLicense.expiryInfo;
      const isExpired = !!expiryInfo?.isExpired ||
        (activeLicense.endDate && new Date(activeLicense.endDate).getTime() < Date.now());

      if (isExpired) {
        const expiredMsg = expiryInfo?.message || 'Your license for this product has expired';
        debugLog.warn('LICENTIC', `License for ${cleanEmail} has expired: ${expiredMsg}`);
        return { valid: false, message: expiredMsg };
      }

      const licenseInfo: LicenseInfo = {
        licenseKey: activeLicense.licenseKey || 'UNKNOWN-KEY',
        status: 'active',
        planName: activeLicense.licenseTypeId?.name || 'Standard License',
        productName: activeLicense.productId?.name || 'Bitrix24 Inventory Middleware',
        productId: activeLicense.productId?._id || targetProductId,
        startDate: activeLicense.startDate,
        endDate: activeLicense.endDate,
        daysRemaining: expiryInfo?.daysRemaining,
        isExpired: false,
        expiryMessage: expiryInfo?.message || undefined,
        features: activeLicense.licenseTypeId?.features || {},
      };

      logger.info({ email: cleanEmail, plan: licenseInfo.planName, key: licenseInfo.licenseKey }, 'Licentic license successfully verified');
      debugLog.info('LICENTIC', `License active and valid for ${cleanEmail} (${licenseInfo.planName})`);

      return {
        valid: true,
        message: 'License verified successfully',
        license: licenseInfo,
      };
    } catch (err: any) {
      const axiosError = err as AxiosError<any>;
      const responseData = axiosError.response?.data;
      const responseMsg = responseData?.message;

      logger.error({ err: err?.message, email: cleanEmail, status: axiosError.response?.status }, 'Error communicating with Licentic API');
      debugLog.error('LICENTIC', `Licentic API call failed for ${cleanEmail}: ${responseMsg || err.message}`);

      if (responseMsg) {
        return { valid: false, message: responseMsg };
      }

      if (axiosError.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        return { valid: false, message: 'License server request timed out. Please try again.' };
      }

      return {
        valid: false,
        message: 'Unable to reach Licentic license server. Please verify your internet connection or try again.',
      };
    }
  }
}

export const licenticService = new LicenticService();
