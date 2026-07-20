"use client";

export default function Sidebar({
  adminName,
  adminRole,
  onLogout,
}: {
  adminName: string;
  adminRole: string;
  onLogout: () => void;
}) {
  return (
    <aside className="sidebar">
      <p className="sidebar-mark">Gerbang</p>
      <p className="sidebar-sub">Admin POS</p>

      <div className="nav-item active">Tenant</div>
      <div className="nav-item" style={{ opacity: 0.45, cursor: "default" }}>
        Langganan <span style={{ fontSize: 10, marginLeft: "auto" }}>segera</span>
      </div>

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
