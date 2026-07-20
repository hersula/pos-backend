"use client";

export type ToastState = { type: "success" | "error"; message: string } | null;

export default function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return <div className={`toast ${toast.type}`}>{toast.message}</div>;
}
