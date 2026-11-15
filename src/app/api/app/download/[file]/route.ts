import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { safeReleasePath, APK_CONTENT_TYPE } from "@/lib/releases";

/// Menyajikan file APK rilis dari direktori storage (di luar public/).
///
/// Publik tanpa token: dibuka lewat browser HP dari dialog update aplikasi.
/// File di-stream supaya APK besar tidak dimuat utuh ke memori.
export async function GET(_req: NextRequest, { params }: { params: { file: string } }) {
  const filePath = safeReleasePath(params.file);
  if (!filePath) {
    return NextResponse.json({ message: "File tidak ditemukan" }, { status: 404 });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return NextResponse.json({ message: "File tidak ditemukan" }, { status: 404 });
    }

    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": APK_CONTENT_TYPE,
        "Content-Length": String(info.size),
        "Content-Disposition": `attachment; filename="${params.file}"`,
        // Nama file unik & tidak pernah ditulis ulang -> aman di-cache lama
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ message: "File tidak ditemukan" }, { status: 404 });
  }
}
