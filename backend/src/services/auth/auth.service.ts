import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middleware/error.middleware';
import { AuthUser, LicenseInfo } from '../../types';
import { licenticService } from './licentic.service';
import { logger } from '../../utils/logger';
import { debugLog } from '../debug/debugLog.service';

export interface LoginResult {
  user: AuthUser;
  token: string;
  license?: LicenseInfo;
}

export class AuthService {
  /**
   * Primary authentication via Licentic License Manager.
   * Verifies that the given email holds an active, non-expired license for the specified product.
   * Automatically provisions or retrieves the user record in PostgreSQL and issues a signed JWT session.
   */
  async loginWithLicentic(email: string, productId?: string): Promise<LoginResult> {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) {
      throw new AppError('Email is required for license login', 400);
    }

    const verification = await licenticService.verifyLicense(cleanEmail, productId);
    if (!verification.valid || !verification.license) {
      throw new AppError(verification.message || 'Licentic license verification failed', 401);
    }

    // Upsert or retrieve user in database
    let user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 10);
      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          passwordHash,
          role: 'ADMIN',
          isActive: true,
        },
      });
      logger.info({ email: cleanEmail }, 'Provisioned new system user from Licentic license');
      debugLog.info('AUTH', `Provisioned new system user via Licentic license: ${cleanEmail}`);
    } else if (!user.isActive) {
      throw new AppError('Your account has been deactivated. Please contact support.', 403);
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      license: verification.license,
    };

    const token = jwt.sign(authUser, env.JWT_SECRET, {
      expiresIn: '24h',
    });

    return { user: authUser, token, license: verification.license };
  }

  /**
   * Unified login method supporting both Licentic license authentication
   * and password credentials.
   * If a user holds a valid Licentic license, their password is authenticated or saved.
   */
  async login(email: string, password?: string): Promise<LoginResult> {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) {
      throw new AppError('Email address is required', 400);
    }
    if (!password || !password.trim()) {
      throw new AppError('Password is required', 400);
    }

    // 1. Check if user is the local system administrator configured in .env
    if (cleanEmail === env.ADMIN_EMAIL.toLowerCase()) {
      const adminUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
      if (adminUser && adminUser.isActive) {
        const matches = await bcrypt.compare(password, adminUser.passwordHash);
        if (matches) {
          const authUser: AuthUser = {
            id: adminUser.id,
            email: adminUser.email,
            role: adminUser.role,
          };
          const token = jwt.sign(authUser, env.JWT_SECRET, { expiresIn: '24h' });
          return { user: authUser, token };
        }
      }
    }

    // 2. Authenticate credentials directly with Licentic
    const authResult = await licenticService.authenticateUser(cleanEmail, password);
    if (!authResult.success) {
      throw new AppError(authResult.message || 'Invalid email or password', 401);
    }

    // 3. Verify user holds an active, non-expired license for this product in Licentic
    const licCheck = await licenticService.verifyLicense(cleanEmail);
    if (!licCheck.valid || !licCheck.license) {
      throw new AppError(licCheck.message || 'No active Licentic license found for this product', 403);
    }

    // 4. Provision or sync user in local PostgreSQL database
    const passwordHash = await bcrypt.hash(password, 10);
    let user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          passwordHash,
          role: 'ADMIN',
          isActive: true,
        },
      });
      logger.info({ email: cleanEmail }, 'Provisioned new system user from Licentic');
      debugLog.info('AUTH', `Provisioned new user after Licentic authentication: ${cleanEmail}`);
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, isActive: true },
      });
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      license: licCheck.license,
    };

    const token = jwt.sign(authUser, env.JWT_SECRET, { expiresIn: '24h' });
    return { user: authUser, token, license: licCheck.license };
  }

  async getMe(userId: string): Promise<AuthUser> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new AppError('User not found', 404);
    }

    // Enrich with active license details if available
    let license: LicenseInfo | undefined;
    try {
      const licCheck = await licenticService.verifyLicense(user.email);
      if (licCheck.valid && licCheck.license) {
        license = licCheck.license;
      }
    } catch {
      // Non-blocking
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      license,
    };
  }
}

export const authService = new AuthService();
