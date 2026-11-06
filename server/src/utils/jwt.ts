import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config/index.js';
import { Permission, RoleName } from '../constants/index.js';

export interface TokenPayload {
  userId: string;
  email: string;
  role: RoleName;
  permissions: Permission[];
}

export function signAccessToken(payload: TokenPayload): string {
  const options: SignOptions = {
    expiresIn: config.jwt.accessExpiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, config.jwt.accessSecret, options);
}

export function signRefreshToken(payload: Pick<TokenPayload, 'userId'>): string {
  const options: SignOptions = {
    expiresIn: config.jwt.refreshExpiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, config.jwt.refreshSecret, options);
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwt.accessSecret) as TokenPayload;
}

export function verifyRefreshToken(token: string): Pick<TokenPayload, 'userId'> {
  return jwt.verify(token, config.jwt.refreshSecret) as Pick<TokenPayload, 'userId'>;
}
