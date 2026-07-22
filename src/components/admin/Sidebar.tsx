"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Sidebar({
  adminName,
  adminRole,
  onLogout,
}: {
  adminName: string;
  adminRole: string;
  onLogout: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <p className="sidebar-mark">Gerbang</p>
      <p className="sidebar-sub">Admin POS</p>

      <Link href="/admin/dashboard" className={`nav-item ${pathname?.startsWith("/admin/dashboard") ? "active" : ""}`}>
        Tenant
      </Link>
      <div className="nav-item" style={{ opacity: 0.45, cursor: "default" }}>
        Langganan <span style={{ fontSize: 10, marginLeft: "auto" }}>segera</span>
      </div>
      <Link href="/admin/settings" className={`nav-item ${pathname?.startsWith("/admin/settings") ? "active" : ""}`}>
        Pengaturan
      </Link>

      <div className="sidebar-footer">
        <div className="sidebar-admin-name">{adminName}</div>
        <div className="sidebar-admin-role">{adminRole === "SUPER_ADMIN" ? "Super Admin" : "Admin Support"}</div>
        <button className="btn btn-ghost btn-sm" style={{ width: "100%" }} onClick={onLogout}>
          Keluar
        </button>
      </div>
    </aside>
  );
}
