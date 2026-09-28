import { Router } from 'express';
import { importController } from '../controllers/import.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { uploadMiddleware } from '../middleware/upload.middleware';

const router = Router();

router.use(authMiddleware);

router.post('/upload', uploadMiddleware.single('file'), importController.upload);
router.post('/preview', importController.preview);
router.post('/', importController.createImportJob);
router.get('/template', importController.getTemplate);
router.get('/daily-schedule', importController.getDailySchedule);
router.post('/daily-schedule', importController.updateDailySchedule);
router.post('/daily-trigger', importController.triggerDailyImport);
router.get('/', importController.listImports);
router.get('/:id', importController.getImport);
router.get('/:id/records', importController.getImportRecords);
router.post('/:id/records/:recordId/retry', importController.retrySingleRecord);
router.get('/:id/errors', importController.getErrors);
router.get('/:id/error-report', importController.getErrorReport);
router.post('/:id/retry', importController.retryFailedRecords);

export default router;
