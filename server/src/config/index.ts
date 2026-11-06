import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

/** Comma-separated list of allowed frontend origins (local + Cloudflare Worker URL). */
function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const clientOrigins = parseOrigins(process.env.CLIENT_URL ?? 'http://localhost:5173');

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '5000', 10),
  clientUrl: clientOrigins[0] ?? 'http://localhost:5173',
  clientOrigins,
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/barangay-dispatch'),
  jwt: {
    accessSecret: required('JWT_SECRET', 'dev-access-secret-change-in-production-min32'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-in-production-min32'),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  mapProvider: process.env.MAP_PROVIDER ?? 'mapbox',
  gpsStaleMinutes: parseInt(process.env.GPS_STALE_MINUTES ?? '2', 10),
  uploadMaxMb: parseInt(process.env.UPLOAD_MAX_MB ?? '10', 10),
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  appVersion: process.env.VITE_APP_VERSION ?? '1.0.0',
};
