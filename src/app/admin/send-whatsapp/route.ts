import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, message } = body;

    console.log("📱 WhatsApp API called");
    console.log("Phone:", phone);
    console.log("Message:", message?.substring(0, 50) + "...");

    // Validasi input
    if (!phone || !message) {
      return NextResponse.json(
        { error: "Phone dan message wajib diisi" },
        { status: 400 }
      );
    }

    // Format nomor telepon
    let formattedPhone = phone.replace(/\D/g, '');
    
    // Handle format nomor Indonesia
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '62' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('8')) {
      formattedPhone = '62' + formattedPhone;
    }
    
    // Tambahkan @s.whatsapp.net jika belum ada
    if (!formattedPhone.includes('@s.whatsapp.net')) {
      formattedPhone = `${formattedPhone}@s.whatsapp.net`;
    }

    console.log("Formatted phone:", formattedPhone);

    // Kirim ke WhatsApp server
    const whatsappResponse = await fetch('https://wa.sicerdiq.my.id/send/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': '11722d7b-0836-477c-9800-cfc4a12f1731',
        'Authorization': 'Basic ' + btoa('admin:StrongPassword123!')
      },
      body: JSON.stringify({
        phone: formattedPhone,
        message: message
      })
    });

    console.log("WhatsApp response status:", whatsappResponse.status);

    const result = await whatsappResponse.json();
    console.log("WhatsApp response:", result);

    if (!whatsappResponse.ok) {
      return NextResponse.json(
        { 
          error: "Gagal mengirim WhatsApp", 
          details: result 
        },
        { status: whatsappResponse.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: "WhatsApp berhasil dikirim",
      data: result
    });

  } catch (error) {
    console.error("❌ WhatsApp Error:", error);
    return NextResponse.json(
      { 
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

// Optional: Handle method lain
export async function GET() {
  return NextResponse.json(
    { message: "WhatsApp API endpoint ready" },
    { status: 200 }
  );
}