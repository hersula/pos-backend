"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch, getAdminProfile, getAdminToken, clearAdminSession, AdminApiError } from "@/lib/admin-client";
import Sidebar from "@/components/admin/Sidebar";
import Toast, { ToastState } from "@/components/admin/Toast";

type WhatsappSettings = {
  deviceId: string;
  enabled: boolean;
  apiUrl: string;
  deviceIdSource: "database" | "env";
};

export default function AdminSettingsPage() {
  const router = useRouter();
  const [adminName, setAdminName] = useState("");
  const [adminRole, setAdminRole] = useState("");

  const [settings, setSettings] = useState<WhatsappSettings | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [testPhone, setTestPhone] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!getAdminToken()) {
      router.replace("/admin/login");
      return;
    }
    const profile = getAdminProfile();
    setAdminName(profile?.name ?? "Admin");
    setAdminRole(profile?.role ?? "");
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await adminFetch<{ data: WhatsappSettings }>("/api/admin/settings/whatsapp");
      setSettings(res.data);
      setDeviceId(res.data.deviceId);
      setEnabled(res.data.enabled);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        clearAdminSession();
        router.replace("/admin/login");
        return;
      }
      setToast({ type: "error", message: err instanceof AdminApiError ? err.message : "Gagal memuat pengaturan" });
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearAdminSession();
    router.replace("/admin/login");
  }

  async function handleSave(withTest: boolean) {
    if (withTest && !testPhone.trim()) {
      setToast({ type: "error", message: "Isi dulu nomor WhatsApp tujuan test" });
      return;
    }

    setSaving(true);
    try {
      const res = await adminFetch<{
        data: WhatsappSettings;
        testResult: { success: boolean; error?: string } | null;
      }>("/api/admin/settings/whatsapp", {
        method: "PUT",
        body: JSON.stringify({
          deviceId: deviceId.trim(),
          enabled,
          ...(withTest ? { testPhone: testPhone.trim() } : {}),
        }),
      });

      setSettings(res.data);

      if (withTest) {
        if (res.testResult?.success) {
          setToast({ type: "success", message: "Pengaturan tersimpan & pesan test berhasil dikirim." });
        } else {
          setToast({
            type: "error",
            message: `Pengaturan tersimpan, tapi pesan test gagal: ${res.testResult?.error ?? "tidak diketahui"}`,
          });
        }
      } else {
        setToast({ type: "success", message: "Pengaturan WhatsApp berhasil disimpan." });
      }
    } catch (err) {
      setToast({ type: "error", message: err instanceof AdminApiError ? err.message : "Gagal menyimpan pengaturan" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="shell">
      <Sidebar adminName={adminName} adminRole={adminRole} onLogout={handleLogout} />

      <main className="main">
        <div className="page-head">
          <div>
            <h1 className="page-title">Pengaturan</h1>
            <p className="page-subtitle">Konfigurasi gateway WhatsApp untuk notifikasi approve/tolak tenant.</p>
          </div>
        </div>

        {loading ? (
          <div className="settings-card">Memuat pengaturan...</div>
        ) : (
          <div className="settings-card">
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Notifikasi WhatsApp Aktif</div>
                <div className="settings-row-desc">
                  Kalau dimatikan, tidak ada pesan WA yang dikirim saat approve/tolak tenant.
                </div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <div>
                <div className="settings-row-label">
                  Device ID
                  {settings && (
                    <span className="badge-source">{settings.deviceIdSource === "database" ? "dari database" : "dari .env"}</span>
                  )}
                </div>
                <div className="settings-row-desc">
                  ID device WhatsApp gateway (mis. dari layanan seperti wa.sicerdiq.my.id). Bisa diganti di sini kapan saja
                  tanpa perlu deploy ulang aplikasi.
                </div>
              </div>
              <input
                className="settings-input"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="mis. 12722d7b-0836-477c-9800-cfc4a12f1731"
                style={{
                  padding: "10px 12px",
                  border: "1.5px solid var(--line)",
                  borderRadius: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                }}
              />
            </div>

            <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <div>
                <div className="settings-row-label">Kirim Pesan Test</div>
                <div className="settings-row-desc">
                  Opsional — isi nomor WhatsApp (mis. 08123456789) untuk kirim pesan uji coba sekaligus saat simpan.
                </div>
              </div>
              <input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="08123456789"
                style={{
                  padding: "10px 12px",
                  border: "1.5px solid var(--line)",
                  borderRadius: 8,
                  fontFamily: "var(--font-sans)",
                  fontSize: 13.5,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn btn-primary" disabled={saving} onClick={() => handleSave(false)}>
                {saving ? "Menyimpan..." : "Simpan Pengaturan"}
              </button>
              <button className="btn btn-ghost" disabled={saving} onClick={() => handleSave(true)}>
                Simpan & Kirim Test
              </button>
            </div>
          </div>
        )}
      </main>

      <Toast toast={toast} />
    </div>
  );
}
