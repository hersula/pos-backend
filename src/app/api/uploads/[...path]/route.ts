import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import { safeUploadPath, CONTENT_TYPES } from "@/lib/uploads";

/// Menyajikan file hasil upload dari direktori storage (di luar public/).
///
/// Sengaja TIDAK memerlukan token: `Image.network` di Flutter tidak mengirim
/// header Authorization. Keamanan bergantung pada nama file yang tidak bisa
/// ditebak (timestamp + random) — cukup untuk gambar produk, jangan dipakai
/// untuk dokumen sensitif.
export async function GET(_req: NextRequest, { params }: { params: { path: string[] } }) {
  const filePath = safeUploadPath(params.path ?? []);
  if (!filePath) {
    return NextResponse.json({ message: "File tidak ditemukan" }, { status: 404 });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return NextResponse.json({ message: "File tidak ditemukan" }, { status: 404 });
    }

    const buffer = await readFile(filePath);
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(info.size),
        // Nama file unik & tidak pernah ditulis ulang -> aman di-cache lama
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ message: "File tidak ditemukan" }, { status: 404 });
  }
}
