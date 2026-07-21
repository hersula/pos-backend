import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken"; // atau sesuaikan dengan library JWT yang Anda pakai

export async function POST(request: NextRequest) {
  try {
    // Verifikasi admin token dari cookies
    const cookieStore = cookies();
    const adminToken = cookieStore.get("admin_token")?.value; // Sesuaikan dengan nama cookie Anda
    
    if (!adminToken) {
      return NextResponse.json(
        { error: "Unauthorized - No token provided" },
        { status: 401 }
      );
    }

    // Verifikasi JWT token
    try {
      const decoded = jwt.verify(
        adminToken, 
        process.env.JWT_SECRET || "your-secret-key" // Sesuaikan dengan secret key Anda
      );
      
      // Optional: cek role admin
      if ((decoded as any).role !== "ADMIN" && (decoded as any).role !== "SUPER_ADMIN") {
        return NextResponse.json(
          { error: "Forbidden - Admin access required" },
          { status: 403 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid token" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { phone, message } = body;

    if (!phone || !message) {
      return NextResponse.json(
        { error: "Phone dan message wajib diisi" },
        { status: 400 }
      );
    }

    // Format nomor telepon
    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('62')) {
      // Jika dimulai dengan 0, ganti dengan 62
      formattedPhone = '62' + formattedPhone.substring(1);
    }
    formattedPhone = `${formattedPhone}@s.whatsapp.net`;

    // Kirim ke WhatsApp server
    const whatsappResponse = await fetch('https://wa.sicerdiq.my.id/send/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': '11722d7b-0836-477c-9800-cfc4a12f1731',
        'Authorization': 'Basic ' + Buffer.from('admin:StrongPassword123!').toString('base64')
      },
      body: JSON.stringify({
        phone: formattedPhone,
        message: message
      }),
      // @ts-ignore - untuk development dengan self-signed certificate
      // Hapus di production!
      ...(process.env.NODE_ENV === 'development' && {
        agent: new (require('https').Agent)({
          rejectUnauthorized: false
        })
      })
    });

    const result = await whatsappResponse.json();

    if (!whatsappResponse.ok) {
      console.error('WhatsApp API Error:', {
        status: whatsappResponse.status,
        response: result
      });
      
      return NextResponse.json(
        { 
          error: "Gagal mengirim WhatsApp", 
          details: result,
          status: whatsappResponse.status
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "WhatsApp berhasil dikirim",
      data: result
    });

  } catch (error) {
    console.error('Send WhatsApp Error:', error);
    return NextResponse.json(
      { error: "Internal server error", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}