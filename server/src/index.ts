import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config/index.js';
import {
  authRouter,
  dashboardRouter,
  incidentsRouter,
  sosRouter,
  respondersRouter,
  mapRouter,
  transportsRouter,
  personnelRouter,
  attendanceRouter,
  shiftsRouter,
  resourcesRouter,
  notificationsRouter,
  reportsRouter,
  settingsRouter,
  chatRouter,
} from './routes/index.js';
import { errorHandler } from './middleware/index.js';
import { verifyAccessToken } from './utils/jwt.js';
import { setIO } from './sockets/index.js';

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: config.clientOrigins,
    credentials: true,
  },
});

setIO(io);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || config.clientOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ success: true, status: 'ok', version: config.appVersion });
});

app.get('/api/config', (_req, res) => {
  res.json({
    success: true,
    data: {
      mapboxToken: process.env.MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN || '',
      mapStyle: 'mapbox://styles/jayb21/cmutco0ed001201r76iq33qps',
    },
  });
});

app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/sos', sosRouter);
app.use('/api/responders', respondersRouter);
app.use('/api/map', mapRouter);
app.use('/api/transports', transportsRouter);
app.use('/api/personnel', personnelRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/shifts', shiftsRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/chat', chatRouter);

app.use(errorHandler);

io.use((socket, next) => {
  const token = socket.handshake.auth.token as string | undefined;
  if (!token) return next(new Error('Authentication required'));
  try {
    const user = verifyAccessToken(token);
    socket.data.user = user;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  socket.join(`user:${user.userId}`);
  if (['CENTRAL_DISPATCHER', 'DEPARTMENT_DISPATCHER', 'SYSTEM_ADMINISTRATOR'].includes(user.role)) {
    socket.join('dispatch');
  }

  socket.on('incident:join', (incidentId: string) => {
    socket.join(`incident:${incidentId}`);
  });

  socket.on('incident:leave', (incidentId: string) => {
    socket.leave(`incident:${incidentId}`);
  });

  socket.on('disconnect', () => {});
});

async function start() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected');

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Server running on port ${config.port}`);
    console.log(`Allowed origins: ${config.clientOrigins.join(', ')}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { io };
