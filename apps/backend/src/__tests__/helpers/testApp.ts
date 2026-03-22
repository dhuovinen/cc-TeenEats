/**
 * Creates a standalone Express app + Socket.io server for integration tests.
 * Does NOT call httpServer.listen() — Supertest handles binding.
 */
import http from 'http';
import express from 'express';
import cors from 'cors';
import { initSocket } from '../../socket';
import authRouter from '../../routes/auth';
import authV2Router from '../../routes/authV2';
import driversRouter from '../../routes/drivers';
import deliveriesRouter from '../../routes/deliveries';
import settingsRouter from '../../routes/settings';
import restaurantsRouter from '../../routes/restaurants';
import ordersRouter from '../../routes/orders';
import complianceRouter from '../../routes/compliance';
import scoringRouter from '../../routes/scoring';

export function buildApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRouter);
  app.use('/auth/v2', authV2Router);
  app.use('/drivers', driversRouter);
  app.use('/deliveries', deliveriesRouter);
  app.use('/settings', settingsRouter);
  app.use('/restaurants', restaurantsRouter);
  app.use('/orders', ordersRouter);
  app.use('/compliance', complianceRouter);
  app.use('/scoring', scoringRouter);

  const httpServer = http.createServer(app);
  initSocket(httpServer);

  return { app, httpServer };
}
