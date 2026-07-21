import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    version: "1.0.0",
    build: 1,
    forceUpdate: false,
    apk: "https://pos-backend.sicerdiq.my.id/download/app-release.apk",
    notes: [
      "Rilis pertama aplikasi POS",
      "Perbaikan printer Bluetooth",
      "Optimasi performa"
    ]
  });
}