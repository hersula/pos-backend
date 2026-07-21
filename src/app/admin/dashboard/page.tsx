"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch, getAdminProfile, getAdminToken, clearAdminSession, AdminApiError } from "@/lib/admin-client";
import Sidebar from "@/components/admin/Sidebar";
import StatusStamp from "@/components/admin/StatusStamp";
import Toast, { ToastState } from "@/components/admin/Toast";

type Tenant = {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone?: string;
  planType: "FREE" | "SUBSCRIBE";
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  createdAt: string;
  rejectedReason?: string | null;
};

type TabKey = "ALL" | "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

const TABS: { key: TabKey; label: string }[] = [
  { key: "ALL", label: "Semua" },
  { key: "PENDING", label: "Menunggu" },
  { key: "APPROVED", label: "Disetujui" },
  { key: "REJECTED", label: "Ditolak" },
  { key: "SUSPENDED", label: "Ditangguhkan" },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const [adminName, setAdminName] = useState("");
  const [adminRole, setAdminRole] = useState("");

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>("PENDING");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const [rejectTarget, setRejectTarget] = useState<Tenant | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // ---- Auth guard ----
  useEffect(() => {
    if (!getAdminToken()) {
      router.replace("/admin/login");
      return;
    }
    const profile = getAdminProfile();
    setAdminName(profile?.name ?? "Admin");
    setAdminRole(profile?.role ?? "");
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadTenants() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await adminFetch<{ data: Tenant[] }>("/api/admin/tenants");
      setTenants(res.data);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        clearAdminSession();
        router.replace("/admin/login");
        return;
      }
      setLoadError(err instanceof AdminApiError ? err.message : "Gagal memuat data tenant");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearAdminSession();
    router.replace("/admin/login");
  }

  const counts = useMemo(() => {
    return {
      ALL: tenants.length,
      PENDING: tenants.filter((t) => t.status === "PENDING").length,
      APPROVED: tenants.filter((t) => t.status === "APPROVED").length,
      REJECTED: tenants.filter((t) => t.status === "REJECTED").length,
      SUSPENDED: tenants.filter((t) => t.status === "SUSPENDED").length,
    };
  }, [tenants]);

  const filtered = useMemo(() => {
    return tenants.filter((t) => {
      if (activeTab !== "ALL" && t.status !== activeTab) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          t.businessName.toLowerCase().includes(q) ||
          t.ownerName.toLowerCase().includes(q) ||
          t.email.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tenants, activeTab, search]);

  async function sendWhatsAppNotification(phone: string, message: string) {
    if (!phone) return null;

    try {
      console.log("📤 Sending WhatsApp via Next.js API route");
      
      // Gunakan fetch biasa untuk Next.js API route
      // Jangan gunakan adminFetch karena itu untuk backend
      const response = await fetch('/api/admin/send-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Tidak perlu auth token karena ini Next.js sendiri
        },
        body: JSON.stringify({ phone, message }),
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Gagal kirim WhatsApp');
      }
      
      console.log("✅ WhatsApp notification sent:", result);
      return result;
      
    } catch (error) {
      console.error("❌ Gagal kirim WhatsApp:", error);
      return null;
    }
  }

  async function handleApprove(tenant: Tenant) {
    if (!window.confirm(`Setujui pendaftaran "${tenant.businessName}"? Toko akan langsung bisa login.`)) return;
    setBusyId(tenant.id);
    
    try {
      // Ini panggil backend
      await adminFetch(`/api/admin/tenants/${tenant.id}/approve`, { method: "POST" });
      setToast({ type: "success", message: `${tenant.businessName} berhasil disetujui.` });
      
      // Ini panggil Next.js API route (sendiri)
      if (tenant.phone) {
        const waMessage = `Halo ${tenant.ownerName},\n\nPendaftaran toko "${tenant.businessName}" telah DISETUJUI. ✅\n\nAkun Anda sudah aktif dan bisa langsung login ke aplikasi.\n\nTerima kasih telah bergabung!\n\n- Admin`;
        
        // Fire and forget - jangan await
        sendWhatsAppNotification(tenant.phone, waMessage).catch(err => 
          console.error("WhatsApp failed:", err)
        );
      }
      
      await loadTenants();
    } catch (err) {
      setToast({ type: "error", message: err instanceof AdminApiError ? err.message : "Gagal menyetujui tenant" });
    } finally {
      setBusyId(null);
    }
  }

  function openRejectModal(tenant: Tenant) {
    setRejectTarget(tenant);
    setRejectReason("");
  }

  async function submitReject() {
    if (!rejectTarget || rejectReason.trim().length < 3) return;
    setRejectSubmitting(true);
    
    try {
      // Ini panggil backend
      await adminFetch(`/api/admin/tenants/${rejectTarget.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      
      setToast({ type: "success", message: `${rejectTarget.businessName} ditolak.` });

      // Ini panggil Next.js API route (sendiri)
      if (rejectTarget.phone) {
        const waMessage = `Halo ${rejectTarget.ownerName},\n\nPendaftaran toko "${rejectTarget.businessName}" DITOLAK. ❌\n\nAlasan: ${rejectReason.trim()}\n\nSilakan perbaiki data pendaftaran Anda atau hubungi admin untuk informasi lebih lanjut.\n\n- Admin`;
        
        // Fire and forget - jangan await
        sendWhatsAppNotification(rejectTarget.phone, waMessage).catch(err => 
          console.error("WhatsApp failed:", err)
        );
      }

      setRejectTarget(null);
      await loadTenants();
    } catch (err) {
      setToast({ type: "error", message: err instanceof AdminApiError ? err.message : "Gagal menolak tenant" });
    } finally {
      setRejectSubmitting(false);
    }
  }

  return (
    <div className="shell">
      <Sidebar adminName={adminName} adminRole={adminRole} onLogout={handleLogout} />

      <main className="main">
        <div className="page-head">
          <div>
            <h1 className="page-title">Pusat Persetujuan Tenant</h1>
            <p className="page-subtitle">Tinjau pendaftaran toko/perusahaan baru sebelum mereka bisa mulai pakai aplikasi.</p>
          </div>
        </div>

        <div className="stat-grid">
          <div className={`stat-card ${counts.PENDING > 0 ? "is-pending" : ""}`}>
            <p className="stat-card-label">Menunggu Persetujuan</p>
            <p className="stat-card-value">{counts.PENDING}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card-label">Disetujui</p>
            <p className="stat-card-value">{counts.APPROVED}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card-label">Ditolak</p>
            <p className="stat-card-value">{counts.REJECTED}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card-label">Total Tenant</p>
            <p className="stat-card-value">{counts.ALL}</p>
          </div>
        </div>

        <div className="toolbar">
          <div className="tabs">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={`tab ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label} {tab.key !== "ALL" ? `(${counts[tab.key]})` : ""}
              </button>
            ))}
          </div>
          <div className="search-box">
            <span className="search-icon">⌕</span>
            <input
              placeholder="Cari nama usaha, pemilik, atau email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="table-card">
          {loading ? (
            <div className="empty-state">Memuat data tenant...</div>
          ) : loadError ? (
            <div className="empty-state">
              <p className="empty-state-title">Gagal memuat data</p>
              <p>{loadError}</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={loadTenants}>
                Coba lagi
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">Tidak ada tenant di sini</p>
              <p>Coba ganti filter atau kata kunci pencarian.</p>
            </div>
          ) : (
            <table className="tenant-table">
              <thead>
                <tr>
                  <th>Usaha</th>
                  <th>Kontak</th>
                  <th>Paket</th>
                  <th>Status</th>
                  <th>Terdaftar</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tenant) => (
                  <tr key={tenant.id}>
                    <td>
                      <div className="cell-business">{tenant.businessName}</div>
                      <div className="cell-sub">{tenant.ownerName}</div>
                      {tenant.status === "REJECTED" && tenant.rejectedReason && (
                        <div className="cell-sub" style={{ color: "var(--stamp-rejected)" }}>
                          Alasan: {tenant.rejectedReason}
                        </div>
                      )}
                    </td>
                    <td>
                      <div>{tenant.email}</div>
                      <div className="cell-sub">{tenant.phone ?? "-"}</div>
                    </td>
                    <td>
                      <span className={`plan-chip ${tenant.planType === "FREE" ? "free" : "subscribe"}`}>
                        {tenant.planType}
                      </span>
                    </td>
                    <td>
                      <StatusStamp status={tenant.status} />
                    </td>
                    <td className="cell-sub">
                      {new Date(tenant.createdAt).toLocaleDateString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td>
                      {tenant.status === "PENDING" && (
                        <div className="row-actions">
                          <button
                            className="btn btn-approve btn-sm"
                            disabled={busyId === tenant.id}
                            onClick={() => handleApprove(tenant)}
                          >
                            {busyId === tenant.id ? <span className="spinner" /> : "Setujui"}
                          </button>
                          <button
                            className="btn btn-danger-outline btn-sm"
                            disabled={busyId === tenant.id}
                            onClick={() => openRejectModal(tenant)}
                          >
                            Tolak
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {rejectTarget && (
        <div className="modal-overlay" onClick={() => !rejectSubmitting && setRejectTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-title">Tolak Pendaftaran</p>
            <p className="modal-desc">
              Menolak <b>{rejectTarget.businessName}</b>. Jelaskan alasannya — pemilik toko akan melihat pesan ini.
            </p>
            <div className="field">
              <label htmlFor="reason">Alasan Penolakan</label>
              <textarea
                id="reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Contoh: Data usaha tidak lengkap / tidak dapat diverifikasi"
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setRejectTarget(null)} disabled={rejectSubmitting}>
                Batal
              </button>
              <button
                className="btn btn-danger-outline"
                onClick={submitReject}
                disabled={rejectSubmitting || rejectReason.trim().length < 3}
              >
                {rejectSubmitting ? <span className="spinner" /> : "Tolak Pendaftaran"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
