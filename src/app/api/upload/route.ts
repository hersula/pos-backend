import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { UPLOAD_ROOT } from "@/lib/uploads";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    // formData() melempar error kalau request tidak punya body multipart yang valid
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
      return NextResponse.json({ message: "File gambar tidak ditemukan" }, { status: 400 });
    }

    if (!ALLOWED[file.type]) {
      return NextResponse.json(
        { message: "Format gambar harus JPG, PNG, atau WEBP" },
        { status: 400 },
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ message: "Ukuran gambar maksimal 5 MB" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Disimpan per tenant supaya tidak campur antar toko.
    // CATATAN: file TIDAK ditaruh di public/ karena `next start` hanya menyajikan
    // isi public/ yang sudah ada saat `next build` — file baru hasil upload 404.
    // Karena itu file disajikan lewat route GET /api/uploads/[...path].
    const relDir = `products/${user.tenantId}`;
    const uploadDir = path.join(UPLOAD_ROOT, "products", user.tenantId);
    await mkdir(uploadDir, { recursive: true });

    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = ALLOWED[file.type];
    const filename = `product-${uniqueSuffix}${ext}`;
    await writeFile(path.join(uploadDir, filename), buffer);

    const fileUrl = `/api/uploads/${relDir}/${filename}`;
    return NextResponse.json({ message: "Upload berhasil", data: { url: fileUrl } }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("upload error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
