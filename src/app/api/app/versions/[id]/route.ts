import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

const updateVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Format versi harus semver (e.g. 1.0.0)").optional(),
  minSupportedVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "Format minSupportedVersion harus semver").optional(),
  mandatory: z.boolean().optional(),
  downloadUrl: z.string().url("downloadUrl harus URL valid").optional(),
  releaseNotes: z.string().optional(),
  isActive: z.boolean().optional(),
  releasedAt: z.string().datetime().optional(),
});

/**
 * PATCH /api/app/versions/[id] - Update versi aplikasi (admin only)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);

    const { id } = params;

    // Cek apakah versi ada
    const appVersion = await prisma.appVersion.findUnique({ where: { id } });
    if (!appVersion) {
      return NextResponse.json(
        { message: "Versi aplikasi tidak ditemukan" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = updateVersionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const updated = await prisma.appVersion.update({
      where: { id },
      data: {
        ...(parsed.data.version && { version: parsed.data.version }),
        ...(parsed.data.minSupportedVersion && { minSupportedVersion: parsed.data.minSupportedVersion }),
        ...(parsed.data.mandatory !== undefined && { mandatory: parsed.data.mandatory }),
        ...(parsed.data.downloadUrl && { downloadUrl: parsed.data.downloadUrl }),
        ...(parsed.data.releaseNotes !== undefined && { releaseNotes: parsed.data.releaseNotes || null }),
        ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
        ...(parsed.data.releasedAt && { releasedAt: new Date(parsed.data.releasedAt) }),
      },
    });

    return NextResponse.json(
      { message: "Versi aplikasi berhasil diperbarui", data: updated },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("update app version error:", err);
    return NextResponse.json(
      { message: "Terjadi kesalahan pada server" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/app/versions/[id] - Soft delete versi aplikasi (admin only)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);

    const { id } = params;

    // Cek apakah versi ada
    const appVersion = await prisma.appVersion.findUnique({ where: { id } });
    if (!appVersion) {
      return NextResponse.json(
        { message: "Versi aplikasi tidak ditemukan" },
        { status: 404 }
      );
    }

    // Soft delete: set isActive to false
    const deleted = await prisma.appVersion.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json(
      { message: "Versi aplikasi berhasil dihapus", data: deleted },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("delete app version error:", err);
    return NextResponse.json(
      { message: "Terjadi kesalahan pada server" },
      { status: 500 }
    );
  }
}
