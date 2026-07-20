import "./admin.css";

export const metadata = {
  title: "Admin — Pusat Persetujuan Tenant",
};

export default function AdminSegmentLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-root">{children}</div>;
}
