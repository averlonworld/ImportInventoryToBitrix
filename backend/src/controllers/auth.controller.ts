import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { authService } from '../services/auth/auth.service';
import { licenticService } from '../services/auth/licentic.service';
import { AppError } from '../middleware/error.middleware';
import { env } from '../config/env';
import { debugLog } from '../services/debug/debugLog.service';

export class AuthController {
  /**
   * Universal Login:
   * - If password is provided: validates credentials or falls back to Licentic.
   * - If password is not provided: performs direct Licentic active license verification.
   */
  async login(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !String(email).trim()) {
        throw new AppError('Email address is required', 400);
      }

      const { user, token, license } = await authService.login(email, password);
      debugLog.info('AUTH', `Login successful for ${user.email} (${license ? `Licentic: ${license.planName}` : 'Standard'})`);

      const cookieOptions: Record<string, unknown> = {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      };
      if (env.COOKIE_DOMAIN) cookieOptions.domain = env.COOKIE_DOMAIN;

      res.cookie('token', token, cookieOptions);

      res.json({
        success: true,
        data: { user, token, license },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Explicit Licentic License Login:
   * Verifies email against Licentic active licenses for product ID (6a23c644247319b4b7bf7006)
   * and logs the user in upon successful validation.
   */
  async licenticLogin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !String(email).trim()) {
        throw new AppError('Email address is required', 400);
      }

      const { user, token, license } = await authService.login(email, password);
      debugLog.info('AUTH', `Licentic license login successful for ${user.email} (Plan: ${license?.planName})`);

      const cookieOptions: Record<string, unknown> = {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      };
      if (env.COOKIE_DOMAIN) cookieOptions.domain = env.COOKIE_DOMAIN;

      res.cookie('token', token, cookieOptions);

      res.json({
        success: true,
        data: { user, token, license },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * License verification status inquiry:
   * Checks license details in Licentic without establishing a session.
   */
  async verifyLicense(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, productId } = req.body;
      if (!email || !String(email).trim()) {
        throw new AppError('Email address is required', 400);
      }

      const result = await licenticService.verifyLicense(email, productId);
      res.json({
        success: result.valid,
        message: result.message,
        data: result.license,
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const cookieOptions: Record<string, unknown> = {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
    };
    if (env.COOKIE_DOMAIN) cookieOptions.domain = env.COOKIE_DOMAIN;

    res.clearCookie('token', cookieOptions);
    res.json({ success: true, message: 'Logged out successfully' });
  }

  async me(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await authService.getMe(req.user!.id);
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
