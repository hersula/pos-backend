"use client";

const TOKEN_KEY = "pos_admin_token";
const ADMIN_KEY = "pos_admin_profile";

export type AdminProfile = { id: string; name: string; email: string; role: string };

export function saveAdminSession(accessToken: string, admin: AdminProfile) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
}

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getAdminProfile(): AdminProfile | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(ADMIN_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearAdminSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
}

export class AdminApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function adminFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new AdminApiError(body?.message ?? "Terjadi kesalahan pada server", res.status);
  }

  return body as T;
}
