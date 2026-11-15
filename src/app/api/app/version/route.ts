import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Public endpoint untuk cek update aplikasi mobile
 * GET /api/app/version?platform=android&version=1.2.0&build=12
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get("platform")?.toUpperCase();
    const clientVersion = searchParams.get("version");
    const clientBuildStr = searchParams.get("build");

    // Validasi input
    if (!platform || !["ANDROID", "IOS"].includes(platform)) {
      return NextResponse.json(
        { message: "Platform harus ANDROID atau IOS" },
        { status: 400 }
      );
    }

    // Ambil versi terbaru aktif untuk platform
    const latestVersion = await prisma.appVersion.findFirst({
      where: {
        platform: platform as "ANDROID" | "IOS",
        isActive: true,
      },
      orderBy: { buildNumber: "desc" },
    });

    // Jika tidak ada versi sama sekali
    if (!latestVersion) {
      return NextResponse.json(
        {
          latestVersion: null,
          latestBuildNumber: null,
          minSupportedVersion: null,
          mandatory: false,
          updateAvailable: false,
          downloadUrl: null,
          releaseNotes: null,
          releasedAt: null,
        },
        { status: 200 }
      );
    }

    // Tentukan apakah update tersedia berdasarkan build number atau version
    let updateAvailable = false;
    if (clientBuildStr) {
      const clientBuild = parseInt(clientBuildStr, 10);
      if (!isNaN(clientBuild)) {
        updateAvailable = clientBuild < latestVersion.buildNumber;
      }
    } else if (clientVersion) {
      // Fallback: bandingkan semver version
      updateAvailable = compareSemver(clientVersion, latestVersion.version) < 0;
    }

    // Tentukan apakah wajib (mandatory)
    let isMandatory = latestVersion.mandatory;
    if (clientVersion && !isMandatory) {
      // Jika versi klien lebih rendah dari minSupportedVersion, maka wajib
      if (compareSemver(clientVersion, latestVersion.minSupportedVersion) < 0) {
        isMandatory = true;
      }
    }

    return NextResponse.json({
      latestVersion: latestVersion.version,
      latestBuildNumber: latestVersion.buildNumber,
      minSupportedVersion: latestVersion.minSupportedVersion,
      mandatory: isMandatory,
      updateAvailable,
      downloadUrl: latestVersion.downloadUrl,
      releaseNotes: latestVersion.releaseNotes,
      releasedAt: latestVersion.releasedAt.toISOString(),
    });
  } catch (err) {
    console.error("get app version error:", err);
    return NextResponse.json(
      { message: "Terjadi kesalahan pada server" },
      { status: 500 }
    );
  }
}

/**
 * Simple semver comparison: returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 * Handles pre-release versions by stripping suffix after "-"
 */
function compareSemver(v1: string, v2: string): number {
  // Strip pre-release suffix (e.g., "1.2.0-beta.1" -> "1.2.0")
  const cleanV1 = v1.split("-")[0];
  const cleanV2 = v2.split("-")[0];

  const parts1 = cleanV1.split(".").map(Number);
  const parts2 = cleanV2.split(".").map(Number);
  const maxLen = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 < num2) return -1;
    if (num1 > num2) return 1;
  }
  return 0;
}
