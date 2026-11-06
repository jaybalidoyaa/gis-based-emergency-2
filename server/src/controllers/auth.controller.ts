import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuthRequest } from '../middleware/index.js';
import { User, Role, Citizen, Responder } from '../models/index.js';
import { ROLES, ROLE_PERMISSIONS } from '../constants/index.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import type { RoleName } from '../constants/index.js';

const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  contactNumber: z.string().min(7),
  password: z.string().min(8),
  address: z.string().optional(),
  emergencyContact: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function buildTokenUser(userId: string) {
  const user = await User.findById(userId).populate('roleId');
  if (!user || user.status !== 'active') return null;

  const role = user.roleId as unknown as { name: string };
  const roleName = role.name as RoleName;
  const permissions = ROLE_PERMISSIONS[roleName] ?? [];

  return {
    user,
    payload: {
      userId: user._id.toString(),
      email: user.email,
      role: roleName,
      permissions,
    },
  };
}

export async function register(req: AuthRequest, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0]?.message });
    return;
  }

  const { fullName, email, contactNumber, password, address, emergencyContact } = parsed.data;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(409).json({ success: false, message: 'Email already registered' });
    return;
  }

  const citizenRole = await Role.findOne({ name: ROLES.CITIZEN });
  if (!citizenRole) {
    res.status(500).json({ success: false, message: 'Citizen role not configured' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    roleId: citizenRole._id,
    fullName,
    email: email.toLowerCase(),
    contactNumber,
    passwordHash,
    status: 'active',
  });

  await Citizen.create({
    userId: user._id,
    address,
    emergencyContact,
  });

  const tokenData = await buildTokenUser(user._id.toString());
  if (!tokenData) {
    res.status(500).json({ success: false, message: 'Failed to create session' });
    return;
  }

  const accessToken = signAccessToken(tokenData.payload);
  const refreshToken = signRefreshToken({ userId: user._id.toString() });
  user.refreshToken = refreshToken;
  await user.save();

  res.status(201).json({
    success: true,
    data: {
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: tokenData.payload.role,
        contactNumber: user.contactNumber,
      },
      accessToken,
      refreshToken,
    },
  });
}

export async function login(req: AuthRequest, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Invalid credentials' });
    return;
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email: email.toLowerCase() }).populate('roleId');
  if (!user) {
    res.status(401).json({ success: false, message: 'Invalid email or password' });
    return;
  }

  if (user.status === 'inactive') {
    res.status(403).json({ success: false, message: 'Account is deactivated' });
    return;
  }

  if (user.status === 'pending') {
    res.status(403).json({ success: false, message: 'Account pending admin verification' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ success: false, message: 'Invalid email or password' });
    return;
  }

  const role = user.roleId as unknown as { name: string };
  const roleName = role.name as RoleName;
  const permissions = ROLE_PERMISSIONS[roleName] ?? [];

  const payload = {
    userId: user._id.toString(),
    email: user.email,
    role: roleName,
    permissions,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken({ userId: user._id.toString() });
  user.refreshToken = refreshToken;
  user.lastLoginAt = new Date();
  await user.save();

  res.json({
    success: true,
    data: {
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: roleName,
        contactNumber: user.contactNumber,
      },
      accessToken,
      refreshToken,
    },
  });
}

export async function refresh(req: AuthRequest, res: Response): Promise<void> {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ success: false, message: 'Refresh token required' });
    return;
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.userId);
    if (!user || user.refreshToken !== refreshToken || user.status !== 'active') {
      res.status(401).json({ success: false, message: 'Invalid refresh token' });
      return;
    }

    const tokenData = await buildTokenUser(user._id.toString());
    if (!tokenData) {
      res.status(401).json({ success: false, message: 'Invalid refresh token' });
      return;
    }

    const accessToken = signAccessToken(tokenData.payload);
    const newRefreshToken = signRefreshToken({ userId: user._id.toString() });
    user.refreshToken = newRefreshToken;
    await user.save();

    res.json({
      success: true,
      data: { accessToken, refreshToken: newRefreshToken },
    });
  } catch {
    res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
}

export async function logout(req: AuthRequest, res: Response): Promise<void> {
  if (req.user) {
    await User.findByIdAndUpdate(req.user.userId, { $unset: { refreshToken: 1 } });
  }
  res.json({ success: true, message: 'Logged out' });
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.userId).populate('roleId').lean();
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const role = user.roleId as unknown as { name: string };
  let profile: Record<string, unknown> = {};

  if (role.name === ROLES.CITIZEN) {
    profile = (await Citizen.findOne({ userId: user._id }).lean()) ?? {};
  } else if (role.name === ROLES.EMERGENCY_RESPONDER) {
    profile = (await Responder.findOne({ userId: user._id }).populate('departmentId').lean()) ?? {};
  }

  res.json({
    success: true,
    data: {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      contactNumber: user.contactNumber,
      role: role.name,
      status: user.status,
      profile,
    },
  });
}
