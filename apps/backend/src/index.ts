import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import express from 'express';
import cors from 'cors';
import { checkDbConnection } from './db';
import { initSocket } from './socket';
import authRouter from './routes/auth';
import authV2Router from './routes/authV2';
import driversRouter from './routes/drivers';
import deliveriesRouter from './routes/deliveries';
import settingsRouter from './routes/settings';

const app = express();

app.use(cors({
  origin: process.env.DISPATCHER_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

// Health check — no auth required
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use('/auth', authRouter);
app.use('/auth/v2', authV2Router);
app.use('/drivers', driversRouter);
app.use('/deliveries', deliveriesRouter);
app.use('/settings', settingsRouter);

const httpServer = http.createServer(app);
initSocket(httpServer);

const PORT = parseInt(process.env.PORT ?? '4000', 10);

async function start() {
  const dbOk = await checkDbConnection();
  if (!dbOk) {
    console.error('Could not connect to database. Check DATABASE_URL in .env');
    process.exit(1);
  }
  httpServer.listen(PORT, () => {
    console.log(`TeenEats backend listening on http://localhost:${PORT}`);
  });
}

start();
