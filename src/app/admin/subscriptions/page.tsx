"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch, getAdminProfile, getAdminToken, clearAdminSession, AdminApiError } from "@/lib/admin-client";
import Sidebar from "@/components/admin/Sidebar";
import Toast, { ToastState } from "@/components/admin/Toast";

type SubscriptionRow = {
  id: string;
  planName: string;
  price: string;
  startDate: string;
  endDate: string;
  computedStatus: "TRIAL" | "ACTIVE" | "PENDING_PAYMENT" | "EXPIRED" | "CANCELLED";
  paymentStatus: "UNPAID" | "PAID";
  paymentNote: string | null;
  daysRemaining: number;
  tenant: { id: string; businessName: string; ownerName: string; email: string; phone: string | null };
};

type TabKey = "ALL" | "TRIAL" | "PENDING_PAYMENT" | "EXPIRED" | "ACTIVE";

const TABS: { key: TabKey; label: string }[] = [
  { key: "ALL", label: "Semua" },
  { key: "PENDING_PAYMENT", label: "Menunggu Konfirmasi" },
  { key: "TRIAL", label: "Trial" },
  { key: "EXPIRED", label: "Habis Masa" },
  { key: "ACTIVE", label: "Aktif" },
];

const STATUS_LABELS: Record<string, string> = {
  TRIAL: "Trial",
  ACTIVE: "Aktif",
  PENDING_PAYMENT: "Menunggu Konfirmasi",
  EXPIRED: "Habis Masa",
  CANCELLED: "Dibatalkan",
};

const STATUS_CLASS: Record<string, string> = {
  TRIAL: "pending",
  ACTIVE: "approved",
  PENDING_PAYMENT: "pending",
  EXPIRED: "rejected",
  CANCELLED: "suspended",
};

export default function AdminSubscriptionsPage() {
  const router = useRouter();
  const [adminName, setAdminName] = useState("");
  const [adminRole, setAdminRole] = useState("");

  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("PENDING_PAYMENT");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const [confirmTarget, setConfirmTarget] = useState<SubscriptionRow | null>(null);
  const [extendDays, setExtendDays] = useState(30);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  useEffect(() => {
    if (!getAdminToken()) {
      router.replace("/admin/login");
      return;
    }
    const profile = getAdminProfile();
    setAdminName(profile?.name ?? "Admin");
    setAdminRole(profile?.role ?? "");
    loadSubs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadSubs() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await adminFetch<{ data: SubscriptionRow[] }>("/api/admin/subscriptions");
      setSubs(res.data);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        clearAdminSession();
        router.replace("/admin/login");
        return;
      }
      setLoadError(err instanceof AdminApiError ? err.message : "Gagal memuat data langganan");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearAdminSession();
    router.replace("/admin/login");
  }

  const counts = useMemo(
    () => ({
      ALL: subs.length,
      TRIAL: subs.filter((s) => s.computedStatus === "TRIAL").length,
      PENDING_PAYMENT: subs.filter((s) => s.computedStatus === "PENDING_PAYMENT").length,
      EXPIRED: subs.filter((s) => s.computedStatus === "EXPIRED").length,
      ACTIVE: subs.filter((s) => s.computedStatus === "ACTIVE").length,
    }),
    [subs]
  );

  const filtered = useMemo(() => {
    if (activeTab === "ALL") return subs;
    return subs.filter((s) => s.computedStatus === activeTab);
  }, [subs, activeTab]);

  function openConfirmDialog(sub: SubscriptionRow) {
    setConfirmTarget(sub);
    setExtendDays(30);
  }

  async function submitConfirmPayment() {
    if (!confirmTarget) return;
    setConfirmSubmitting(true);
    try {
      await adminFetch(`/api/admin/subscriptions/${confirmTarget.id}/confirm-payment`, {
        method: "POST",
        body: JSON.stringify({ extendDays }),
      });
      setToast({ type: "success", message: `Langganan ${confirmTarget.tenant.businessName} berhasil diperpanjang.` });
      setConfirmTarget(null);
      await loadSubs();
    } catch (err) {
      setToast({ type: "error", message: err instanceof AdminApiError ? err.message : "Gagal konfirmasi pembayaran" });
    } finally {
      setConfirmSubmitting(false);
    }
  }

  return (
    <div className="shell">
      <Sidebar adminName={adminName} adminRole={adminRole} onLogout={handleLogout} />

      <main className="main">
        <div className="page-head">
          <div>
            <h1 className="page-title">Langganan Tenant</h1>
            <p className="page-subtitle">Pantau masa trial & konfirmasi pembayaran perpanjangan langganan.</p>
          </div>
        </div>

        <div className="stat-grid">
          <div className={`stat-card ${counts.PENDING_PAYMENT > 0 ? "is-pending" : ""}`}>
            <p className="stat-card-label">Menunggu Konfirmasi</p>
            <p className="stat-card-value">{counts.PENDING_PAYMENT}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card-label">Sedang Trial</p>
            <p className="stat-card-value">{counts.TRIAL}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card-label">Habis Masa</p>
            <p className="stat-card-value">{counts.EXPIRED}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card-label">Aktif (Sudah Bayar)</p>
            <p className="stat-card-value">{counts.ACTIVE}</p>
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
        </div>

        <div className="table-card">
          {loading ? (
            <div className="empty-state">Memuat data langganan...</div>
          ) : loadError ? (
            <div className="empty-state">
              <p className="empty-state-title">Gagal memuat data</p>
              <p>{loadError}</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={loadSubs}>
                Coba lagi
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">Tidak ada data di sini</p>
              <p>Coba ganti filter di atas.</p>
            </div>
          ) : (
            <table className="tenant-table">
              <thead>
                <tr>
                  <th>Toko</th>
                  <th>Paket</th>
                  <th>Status</th>
                  <th>Berakhir</th>
                  <th>Catatan</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sub) => (
                  <tr key={sub.id}>
                    <td>
                      <div className="cell-business">{sub.tenant.businessName}</div>
                      <div className="cell-sub">{sub.tenant.ownerName} · {sub.tenant.phone ?? sub.tenant.email}</div>
                    </td>
                    <td>{sub.planName}</td>
                    <td>
                      <span className={`stamp ${STATUS_CLASS[sub.computedStatus] ?? "suspended"}`}>
                        {STATUS_LABELS[sub.computedStatus] ?? sub.computedStatus}
                      </span>
                    </td>
                    <td className="cell-sub">
                      {new Date(sub.endDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                      {sub.computedStatus === "TRIAL" || sub.computedStatus === "ACTIVE" ? (
                        <div>{sub.daysRemaining >= 0 ? `${sub.daysRemaining} hari lagi` : "-"}</div>
                      ) : null}
                    </td>
                    <td className="cell-sub" style={{ maxWidth: 200 }}>
                      {sub.paymentNote || "-"}
                    </td>
                    <td>
                      <button className="btn btn-approve btn-sm" disabled={busyId === sub.id} onClick={() => openConfirmDialog(sub)}>
                        Konfirmasi Bayar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {confirmTarget && (
        <div className="modal-overlay" onClick={() => !confirmSubmitting && setConfirmTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-title">Konfirmasi Pembayaran</p>
            <p className="modal-desc">
              Konfirmasi pembayaran untuk <b>{confirmTarget.tenant.businessName}</b>. Ini akan memperpanjang masa langganan
              dan otomatis mengirim notifikasi WhatsApp ke pemilik toko.
            </p>
            <div className="field">
              <label htmlFor="extendDays">Perpanjang Berapa Hari</label>
              <input
                id="extendDays"
                type="number"
                min={1}
                value={extendDays}
                onChange={(e) => setExtendDays(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "11px 13px",
                  border: "1.5px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 14.5,
                }}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmTarget(null)} disabled={confirmSubmitting}>
                Batal
              </button>
              <button className="btn btn-approve" onClick={submitConfirmPayment} disabled={confirmSubmitting}>
                {confirmSubmitting ? "Menyimpan..." : "Konfirmasi & Perpanjang"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
