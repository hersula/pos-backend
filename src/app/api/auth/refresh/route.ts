import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken, signAccessToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { refreshToken } = await req.json();
    if (!refreshToken) {
      return NextResponse.json({ message: "refreshToken wajib diisi" }, { status: 400 });
    }

    const payload = verifyRefreshToken(refreshToken);
    const { iat, exp, ...cleanPayload } = payload as any;
    const accessToken = signAccessToken(cleanPayload);

    return NextResponse.json({ accessToken });
  } catch (err) {
    return NextResponse.json({ message: "Refresh token tidak valid atau kadaluarsa" }, { status: 401 });
  }
}
