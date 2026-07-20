"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch, saveAdminSession, AdminApiError } from "@/lib/admin-client";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await adminFetch<{ accessToken: string; admin: any }>("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      saveAdminSession(res.accessToken, res.admin);
      router.push("/admin/dashboard");
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Gagal masuk. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <p className="login-mark">Gerbang</p>
        <p className="login-tagline">Pusat persetujuan pendaftaran toko &amp; perusahaan.</p>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="superadmin@pos.com"
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="password">Kata Sandi</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading && <span className="spinner" />}
            {loading ? "Memeriksa..." : "Masuk"}
          </button>
        </form>

        <p className="login-hint">
          Akses khusus tim platform. Kredensial dibuat lewat <code>npm run seed</code> di backend — lihat README.md.
        </p>
      </div>
    </div>
  );
}
