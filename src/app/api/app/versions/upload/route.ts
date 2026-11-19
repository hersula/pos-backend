import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getAdminFromRequest, AuthError } from "@/lib/auth";
import { RELEASE_ROOT, MAX_APK_SIZE, sanitizeNamePart } from "@/lib/releases";

/**
 * POST /api/app/versions/upload - Upload file APK rilis (Super Admin)
 * multipart/form-data: file (wajib, .apk), version & build (opsional, untuk nama file)
 * Respons 201: { data: { path, fileName, size } } — `path` relatif, gabungkan dengan origin
 * server untuk dipakai sebagai downloadUrl.
 */
export async function POST(req: NextRequest) {
  try {
    const admin = getAdminFromRequest(req);
    if (admin.role !== "SUPER_ADMIN") {
      return NextResponse.json({ message: "Hanya Super Admin yang boleh mengunggah APK" }, { status: 403 });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { message: "Request harus berupa multipart/form-data dengan field 'file'" },
        { status: 400 },
      );
    }

    const file = formData.get("file") as File | null;
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ message: "File APK tidak ditemukan" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".apk")) {
      return NextResponse.json({ message: "File harus berekstensi .apk" }, { status: 400 });
    }

    if (file.size > MAX_APK_SIZE) {
      return NextResponse.json({ message: "Ukuran APK maksimal 300 MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // APK adalah arsip ZIP: 4 byte pertama harus "PK\x03\x04"
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
      return NextResponse.json({ message: "File bukan APK yang valid" }, { status: 400 });
    }

    // Build debug Flutter membawa kernel_blob.bin (JIT). APK debug ditandatangani debug key,
    // jadi tidak bisa menimpa aplikasi release yang sudah terpasang di HP.
    if (buffer.includes("flutter_assets/kernel_blob.bin")) {
      return NextResponse.json(
        { message: "Ini APK debug. Unggah hasil `flutter build apk --release`." },
        { status: 400 },
      );
    }

    const version = sanitizeNamePart(String(formData.get("version") ?? ""));
    const build = sanitizeNamePart(String(formData.get("build") ?? ""));
    const label = [version, build && `b${build}`].filter(Boolean).join("-");
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const fileName = `qpos-${label ? `${label}-` : ""}${uniqueSuffix}.apk`;

    await mkdir(RELEASE_ROOT, { recursive: true });
    await writeFile(path.join(RELEASE_ROOT, fileName), buffer);

    return NextResponse.json(
      {
        message: "Upload APK berhasil",
        data: { path: `/api/app/download/${fileName}`, fileName, size: buffer.length },
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("upload apk error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
