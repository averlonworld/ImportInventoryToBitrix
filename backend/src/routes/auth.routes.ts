import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { authLimiter } from '../middleware/rateLimit.middleware';
import { validate } from '../middleware/validation.middleware';
import { z } from 'zod';

const router = Router();

// Universal login: email required, password optional (Licentic if omitted)
const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().optional(),
    productId: z.string().optional(),
  }),
});

// Explicit Licentic verification / login schema
const licenticSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format'),
    productId: z.string().optional(),
  }),
});

// Authentication endpoints
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/licentic-login', authLimiter, validate(licenticSchema), authController.licenticLogin);
router.post('/verify-license', authLimiter, validate(licenticSchema), authController.verifyLicense);
router.post('/logout', authMiddleware, authController.logout);
router.get('/me', authMiddleware, authController.me);

export default router;
