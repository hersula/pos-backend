import bcrypt from "bcryptjs";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { NextRequest } from "next/server";

const ACCESS_SECRET: Secret = process.env.JWT_ACCESS_SECRET || "dev-access-secret";
const REFRESH_SECRET: Secret = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || "15m";
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || "30d";

// ---------- Password ----------
export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function comparePassword(plain: string, hashed: string) {
  return bcrypt.compare(plain, hashed);
}

// ---------- JWT Payload types ----------
export type TenantUserPayload = {
  type: "tenant_user";
  userId: string;
  tenantId: string;
  role: "OWNER" | "MANAGER" | "KASIR" | "GUDANG" | "AKUNTAN";
};

export type AdminPayload = {
  type: "admin";
  adminId: string;
  role: "SUPER_ADMIN" | "ADMIN_SUPPORT";
};

export type JwtPayload = TenantUserPayload | AdminPayload;

// ---------- Sign ----------
export function signAccessToken(payload: JwtPayload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES } as SignOptions);
}

export function signRefreshToken(payload: JwtPayload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES } as SignOptions);
}

// ---------- Verify ----------
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, ACCESS_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, REFRESH_SECRET) as JwtPayload;
}

// ---------- Helper: ambil & verifikasi user tenant dari header Authorization ----------
export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export function getTenantUserFromRequest(req: NextRequest): TenantUserPayload {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Token tidak ditemukan");
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = verifyAccessToken(token);
    if (payload.type !== "tenant_user") {
      throw new AuthError("Token tidak valid untuk resource ini", 403);
    }
    return payload;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("Token tidak valid atau kadaluarsa");
  }
}

// ---------- Role-based access control ----------
export function requireRole(user: TenantUserPayload, allowedRoles: TenantUserPayload["role"][]) {
  if (!allowedRoles.includes(user.role)) {
    throw new AuthError(
      `Role "${user.role}" tidak memiliki akses untuk aksi ini. Dibutuhkan salah satu dari: ${allowedRoles.join(", ")}`,
      403
    );
  }
}

export function getAdminFromRequest(req: NextRequest): AdminPayload {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Token admin tidak ditemukan");
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = verifyAccessToken(token);
    if (payload.type !== "admin") {
      throw new AuthError("Token tidak valid untuk resource admin", 403);
    }
    return payload;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("Token tidak valid atau kadaluarsa");
  }
}
