import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

const createVersionSchema = z.object({
  platform: z.enum(["ANDROID", "IOS"]).default("ANDROID"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Format versi harus semver (e.g. 1.0.0)"),
  buildNumber: z.number().int().positive("Build number harus positif"),
  minSupportedVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "Format minSupportedVersion harus semver"),
  mandatory: z.boolean().default(false),
  downloadUrl: z.string().url("downloadUrl harus URL valid"),
  releaseNotes: z.string().optional(),
  isActive: z.boolean().default(true),
  releasedAt: z.string().datetime().optional(),
});

/**
 * GET /api/app/versions - List versi aplikasi (admin only)
 */
export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);

    const versions = await prisma.appVersion.findMany({
      orderBy: [{ platform: "asc" }, { buildNumber: "desc" }],
    });

    return NextResponse.json({ data: versions });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("list app versions error:", err);
    return NextResponse.json(
      { message: "Terjadi kesalahan pada server" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/app/versions - Buat versi aplikasi baru (admin only)
 */
export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);

    const body = await req.json();
    const parsed = createVersionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { platform, buildNumber } = parsed.data;

    // Cek unique constraint
    const existing = await prisma.appVersion.findUnique({
      where: { platform_buildNumber: { platform: platform as "ANDROID" | "IOS", buildNumber } },
    });

    if (existing) {
      return NextResponse.json(
        { message: `Build number ${buildNumber} untuk platform ${platform} sudah ada` },
        { status: 409 }
      );
    }

    const appVersion = await prisma.appVersion.create({
      data: {
        platform: parsed.data.platform as "ANDROID" | "IOS",
        version: parsed.data.version,
        buildNumber: parsed.data.buildNumber,
        minSupportedVersion: parsed.data.minSupportedVersion,
        mandatory: parsed.data.mandatory,
        downloadUrl: parsed.data.downloadUrl,
        releaseNotes: parsed.data.releaseNotes,
        isActive: parsed.data.isActive,
        releasedAt: parsed.data.releasedAt ? new Date(parsed.data.releasedAt) : new Date(),
      },
    });

    return NextResponse.json(
      { message: "Versi aplikasi berhasil dibuat", data: appVersion },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("create app version error:", err);
    return NextResponse.json(
      { message: "Terjadi kesalahan pada server" },
      { status: 500 }
    );
  }
}
