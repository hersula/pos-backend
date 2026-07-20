"use client";

const LABELS: Record<string, string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  SUSPENDED: "Ditangguhkan",
};

const CLASS: Record<string, string> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  SUSPENDED: "suspended",
};

export default function StatusStamp({ status }: { status: string }) {
  return <span className={`stamp ${CLASS[status] ?? "suspended"}`}>{LABELS[status] ?? status}</span>;
}
