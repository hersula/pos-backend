"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch, getAdminProfile, getAdminToken, clearAdminSession, AdminApiError } from "@/lib/admin-client";
import Sidebar from "@/components/admin/Sidebar";
import Toast, { ToastState } from "@/components/admin/Toast";

type AppVersion = {
  id: string;
  platform: "ANDROID" | "IOS";
  version: string;
  buildNumber: number;
  minSupportedVersion: string;
  mandatory: boolean;
  downloadUrl: string;
  releaseNotes: string | null;
  isActive: boolean;
  releasedAt: string;
};

type SourceMode = "upload" | "url";

const SEMVER = /^\d+\.\d+\.\d+$/;

// Cloudflare (paket Free/Pro) menolak request body > 100 MB dengan 413
const MAX_UPLOAD_SIZE = 100 * 1000 * 1000;

const inputStyle = {
  width: "100%",
  padding: "11px 13px",
  border: "1.5px solid var(--line)",
  borderRadius: 8,
  fontSize: 14,
} as const;

function formatSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/// Upload lewat XMLHttpRequest (bukan fetch) supaya progres upload APK besar bisa ditampilkan.
function uploadApk(
  file: File,
  version: string,
  build: string,
  onProgress: (percent: number) => void
): Promise<{ path: string; fileName: string; size: number }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("version", version);
    form.append("build", build);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/app/versions/upload");
    const token = getAdminToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: any = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // respons non-JSON, mis. 413 dari reverse proxy
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body.data);
      } else if (xhr.status === 413) {
        reject(
          new AdminApiError(
            "File terlalu besar untuk server (batas Cloudflare 100 MB, atau client_max_body_size di nginx)",
            413
          )
        );
      } else {
        reject(new AdminApiError(body?.message ?? "Gagal mengunggah APK", xhr.status));
      }
    };
    xhr.onerror = () => reject(new AdminApiError("Koneksi terputus saat mengunggah APK", 0));
    xhr.send(form);
  });
}

export default function AdminAppVersionsPage() {
  const router = useRouter();
  const [adminName, setAdminName] = useState("");
  const [adminRole, setAdminRole] = useState("");

  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [buildNumber, setBuildNumber] = useState("");
  const [minSupportedVersion, setMinSupportedVersion] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("upload");
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const isSuperAdmin = adminRole === "SUPER_ADMIN";

  useEffect(() => {
    if (!getAdminToken()) {
      router.replace("/admin/login");
      return;
    }
    const profile = getAdminProfile();
    setAdminName(profile?.name ?? "Admin");
    setAdminRole(profile?.role ?? "");
    loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadVersions() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await adminFetch<{ data: AppVersion[] }>("/api/app/versions");
      setVersions(res.data.filter((v) => v.platform === "ANDROID"));
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        clearAdminSession();
        router.replace("/admin/login");
        return;
      }
      setLoadError(err instanceof AdminApiError ? err.message : "Gagal memuat versi aplikasi");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearAdminSession();
    router.replace("/admin/login");
  }

  // Versi yang sedang ditawarkan ke HP: aktif dengan build tertinggi (sama dengan logika /api/app/version)
  const liveVersion = useMemo(
    () => versions.filter((v) => v.isActive).sort((a, b) => b.buildNumber - a.buildNumber)[0] ?? null,
    [versions]
  );

  function openForm() {
    const maxBuild = versions.reduce((max, v) => Math.max(max, v.buildNumber), 0);
    setVersion("");
    setBuildNumber(String(maxBuild + 1));
    setMinSupportedVersion(liveVersion?.version ?? "1.0.0");
    setMandatory(false);
    setReleaseNotes("");
    setSourceMode("upload");
    setApkFile(null);
    setDownloadUrl("");
    setFormError(null);
    setUploadProgress(null);
    setFormOpen(true);
  }

  async function submitForm() {
    const build = Number(buildNumber);
    if (!SEMVER.test(version.trim())) return setFormError("Versi harus format X.Y.Z, mis. 1.0.1");
    if (!Number.isInteger(build) || build <= 0) return setFormError("Build number harus bilangan bulat positif");
    if (versions.some((v) => v.buildNumber === build)) return setFormError(`Build number ${build} sudah terdaftar`);
    if (!SEMVER.test(minSupportedVersion.trim())) return setFormError("Versi minimum harus format X.Y.Z");
    if (sourceMode === "upload" && !apkFile) return setFormError("Pilih file APK yang akan diunggah");
    if (sourceMode === "upload" && apkFile && apkFile.size > MAX_UPLOAD_SIZE) {
      return setFormError(
        `APK ${formatSize(apkFile.size)} melebihi batas upload Cloudflare (100 MB). Pastikan memakai hasil ` +
          "`flutter build apk --release`, bukan APK debug."
      );
    }
    if (sourceMode === "url" && !/^https?:\/\//.test(downloadUrl.trim())) {
      return setFormError("URL download harus diawali http:// atau https://");
    }

    setFormError(null);
    setSubmitting(true);
    try {
      let url = downloadUrl.trim();
      if (sourceMode === "upload" && apkFile) {
        setUploadProgress(0);
        const uploaded = await uploadApk(apkFile, version.trim(), String(build), setUploadProgress);
        url = `${window.location.origin}${uploaded.path}`;
      }

      await adminFetch("/api/app/versions", {
        method: "POST",
        body: JSON.stringify({
          platform: "ANDROID",
          version: version.trim(),
          buildNumber: build,
          minSupportedVersion: minSupportedVersion.trim(),
          mandatory,
          downloadUrl: url,
          releaseNotes: releaseNotes.trim() || undefined,
        }),
      });

      setToast({ type: "success", message: `Versi ${version.trim()} (build ${build}) berhasil didaftarkan.` });
      setFormOpen(false);
      await loadVersions();
    } catch (err) {
      setFormError(err instanceof AdminApiError ? err.message : "Gagal mendaftarkan versi");
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }

  async function patchVersion(v: AppVersion, data: Partial<Pick<AppVersion, "isActive" | "mandatory">>, message: string) {
    setBusyId(v.id);
    try {
      await adminFetch(`/api/app/versions/${v.id}`, { method: "PATCH", body: JSON.stringify(data) });
      setToast({ type: "success", message });
      await loadVersions();
    } catch (err) {
      setToast({ type: "error", message: err instanceof AdminApiError ? err.message : "Gagal memperbarui versi" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="shell">
      <Sidebar adminName={adminName} adminRole={adminRole} onLogout={handleLogout} />

      <main className="main">
        <div className="page-head">
          <div>
            <h1 className="page-title">Versi Aplikasi</h1>
            <p className="page-subtitle">
              Daftarkan APK baru Q-Pos Android. Aplikasi di HP akan menawarkan update saat dashboard dibuka.
            </p>
          </div>
          {isSuperAdmin && (
            <button className="btn btn-primary" onClick={openForm} disabled={loading}>
              + Daftarkan Versi Baru
            </button>
          )}
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <p className="stat-card-label">Versi Ditawarkan</p>
            <p className="stat-card-value">{liveVersion ? liveVersion.version : "-"}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card-label">Build</p>
            <p className="stat-card-value">{liveVersion ? liveVersion.buildNumber : "-"}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card-label">Versi Minimum</p>
            <p className="stat-card-value">{liveVersion ? liveVersion.minSupportedVersion : "-"}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card-label">Sifat Update</p>
            <p className="stat-card-value">{liveVersion ? (liveVersion.mandatory ? "Wajib" : "Opsional") : "-"}</p>
          </div>
        </div>

        <div className="table-card">
          {loading ? (
            <div className="empty-state">Memuat versi aplikasi...</div>
          ) : loadError ? (
            <div className="empty-state">
              <p className="empty-state-title">Gagal memuat data</p>
              <p>{loadError}</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={loadVersions}>
                Coba lagi
              </button>
            </div>
          ) : versions.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">Belum ada versi terdaftar</p>
              <p>Daftarkan versi pertama supaya aplikasi di HP bisa menerima update.</p>
            </div>
          ) : (
            <table className="tenant-table">
              <thead>
                <tr>
                  <th>Versi</th>
                  <th>Status</th>
                  <th>Catatan Rilis</th>
                  <th>Dirilis</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <div className="cell-business">
                        {v.version} <span className="cell-sub">build {v.buildNumber}</span>
                      </div>
                      <div className="cell-sub">
                        Min. {v.minSupportedVersion} ·{" "}
                        <a href={v.downloadUrl} target="_blank" rel="noreferrer">
                          Unduh APK
                        </a>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {liveVersion?.id === v.id ? (
                          <span className="stamp approved">Ditawarkan</span>
                        ) : v.isActive ? (
                          <span className="stamp suspended">Aktif</span>
                        ) : (
                          <span className="stamp rejected">Nonaktif</span>
                        )}
                        {v.mandatory && <span className="stamp pending">Wajib</span>}
                      </div>
                    </td>
                    <td className="cell-sub" style={{ maxWidth: 260, whiteSpace: "pre-line" }}>
                      {v.releaseNotes || "-"}
                    </td>
                    <td className="cell-sub">
                      {new Date(v.releasedAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td>
                      {isSuperAdmin && (
                        <div className="row-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={busyId === v.id}
                            onClick={() =>
                              patchVersion(
                                v,
                                { mandatory: !v.mandatory },
                                `Versi ${v.version} sekarang ${v.mandatory ? "opsional" : "wajib"}.`
                              )
                            }
                          >
                            {v.mandatory ? "Jadikan Opsional" : "Jadikan Wajib"}
                          </button>
                          <button
                            className={`btn btn-sm ${v.isActive ? "btn-danger-outline" : "btn-approve"}`}
                            disabled={busyId === v.id}
                            onClick={() =>
                              patchVersion(
                                v,
                                { isActive: !v.isActive },
                                `Versi ${v.version} ${v.isActive ? "dinonaktifkan" : "diaktifkan kembali"}.`
                              )
                            }
                          >
                            {v.isActive ? "Nonaktifkan" : "Aktifkan"}
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

      {formOpen && (
        <div className="modal-overlay" onClick={() => !submitting && setFormOpen(false)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}
          >
            <p className="modal-title">Daftarkan Versi Baru</p>
            <p className="modal-desc">
              Samakan dengan <code>version</code> di pubspec.yaml. Contoh <code>1.0.1+2</code> berarti versi{" "}
              <b>1.0.1</b>, build <b>2</b>. HP dengan build lebih kecil akan ditawari update.
            </p>

            <div style={{ display: "flex", gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="version">Versi</label>
                <input id="version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.1" style={inputStyle} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="buildNumber">Build Number</label>
                <input
                  id="buildNumber"
                  type="number"
                  min={1}
                  value={buildNumber}
                  onChange={(e) => setBuildNumber(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="minSupportedVersion">Versi Minimum yang Masih Didukung</label>
              <input
                id="minSupportedVersion"
                value={minSupportedVersion}
                onChange={(e) => setMinSupportedVersion(e.target.value)}
                placeholder="1.0.0"
                style={inputStyle}
              />
              <div className="cell-sub">HP dengan versi di bawah ini otomatis dipaksa update.</div>
            </div>

            <div className="settings-row" style={{ padding: "8px 0" }}>
              <div>
                <div className="settings-row-label">Update Wajib</div>
                <div className="settings-row-desc">User tidak bisa menutup dialog sebelum memperbarui.</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="field">
              <label htmlFor="releaseNotes">Catatan Rilis</label>
              <textarea
                id="releaseNotes"
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                placeholder={"- Perbaikan UI\n- Optimasi performa"}
              />
            </div>

            <div className="field">
              <label>File APK</label>
              <div className="tabs" style={{ marginBottom: 8 }}>
                <button className={`tab ${sourceMode === "upload" ? "active" : ""}`} onClick={() => setSourceMode("upload")} type="button">
                  Unggah APK
                </button>
                <button className={`tab ${sourceMode === "url" ? "active" : ""}`} onClick={() => setSourceMode("url")} type="button">
                  Pakai URL
                </button>
              </div>
              {sourceMode === "upload" ? (
                <>
                  <input
                    type="file"
                    accept=".apk,application/vnd.android.package-archive"
                    onChange={(e) => setApkFile(e.target.files?.[0] ?? null)}
                    style={{ ...inputStyle, padding: "9px 11px" }}
                  />
                  {apkFile && <div className="cell-sub">{apkFile.name} · {formatSize(apkFile.size)}</div>}
                </>
              ) : (
                <input
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                  placeholder="https://pos.quantix.id/download/qpos-1.0.1.apk"
                  style={inputStyle}
                />
              )}
            </div>

            {uploadProgress !== null && (
              <div className="cell-sub" style={{ marginTop: 4 }}>
                Mengunggah APK... {uploadProgress}%
                <div style={{ height: 6, background: "var(--line)", borderRadius: 3, marginTop: 4, overflow: "hidden" }}>
                  <div style={{ width: `${uploadProgress}%`, height: "100%", background: "var(--accent)" }} />
                </div>
              </div>
            )}

            {formError && <p className="form-error">{formError}</p>}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setFormOpen(false)} disabled={submitting}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={submitForm} disabled={submitting}>
                {submitting ? "Menyimpan..." : "Daftarkan"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
