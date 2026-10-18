import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { MulterError } from 'multer';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { uploadsDir, v1 } from './routes/v1.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/uploads', express.static(uploadsDir, { index: false, dotfiles: 'deny' }));
  app.use('/api/v1', v1);

  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Rota não encontrada')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof MulterError) {
      return res.status(400).json({ error: { code: err.code, message: 'Ficheiro inválido ou demasiado grande' } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'JSON inválido' } });
    }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Registo duplicado' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Erro interno do servidor' } });
  });

  return app;
}
