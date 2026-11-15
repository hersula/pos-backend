import path from "path";
import { UPLOAD_ROOT } from "@/lib/uploads";

/// Direktori penyimpanan file APK rilis aplikasi mobile.
///
/// Sama seperti upload gambar, sengaja DI LUAR `public/` (file baru di public/
/// setelah `next build` akan 404). File disajikan lewat route
/// `GET /api/app/download/[file]`. Bisa dipindah via env RELEASE_DIR.
export const RELEASE_ROOT =
  process.env.RELEASE_DIR && process.env.RELEASE_DIR.trim() !== ""
    ? path.resolve(process.env.RELEASE_DIR)
    : path.join(path.dirname(UPLOAD_ROOT), "releases");

export const APK_CONTENT_TYPE = "application/vnd.android.package-archive";

export const MAX_APK_SIZE = 300 * 1024 * 1024; // 300 MB

/// Nama file hanya boleh huruf/angka/titik/strip/garis bawah dan berakhiran .apk.
const SAFE_NAME = /^[A-Za-z0-9._-]+\.apk$/;

/// Ubah nama file dari URL menjadi path absolut di dalam [RELEASE_ROOT].
/// Null kalau nama tidak valid atau keluar dari RELEASE_ROOT.
export function safeReleasePath(name: string): string | null {
  if (!name || !SAFE_NAME.test(name) || name.startsWith(".")) return null;

  const resolved = path.resolve(RELEASE_ROOT, name);
  if (path.dirname(resolved) !== path.resolve(RELEASE_ROOT)) return null;

  return resolved;
}

/// Bersihkan potongan nama (mis. versi "1.0.1") supaya aman dipakai di nama file.
export function sanitizeNamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9.-]/g, "").slice(0, 32);
}
