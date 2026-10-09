import path from "path";

/// Direktori root penyimpanan file upload.
///
/// Sengaja DI LUAR `public/` karena `next start` hanya menyajikan isi `public/`
/// yang sudah ada pada saat `next build`; file baru yang ditulis saat runtime
/// akan menghasilkan 404. File di sini disajikan lewat route
/// `GET /api/uploads/[...path]`.
///
/// Bisa dipindah (mis. ke disk lain / volume terpisah) via env UPLOAD_DIR.
export const UPLOAD_ROOT =
  process.env.UPLOAD_DIR && process.env.UPLOAD_DIR.trim() !== ""
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), "storage", "uploads");

export const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/// Ubah segmen path dari URL menjadi path absolut di dalam [UPLOAD_ROOT].
/// Mengembalikan null kalau hasilnya keluar dari UPLOAD_ROOT (path traversal)
/// atau ekstensinya tidak diizinkan.
export function safeUploadPath(segments: string[]): string | null {
  if (segments.length === 0) return null;

  // Tolak segmen berbahaya sebelum join
  if (segments.some((s) => !s || s === "." || s === ".." || s.includes("\0") || s.includes("/") || s.includes("\\"))) {
    return null;
  }

  const ext = path.extname(segments[segments.length - 1]).toLowerCase();
  if (!CONTENT_TYPES[ext]) return null;

  const resolved = path.resolve(UPLOAD_ROOT, ...segments);
  const root = path.resolve(UPLOAD_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;

  return resolved;
}
