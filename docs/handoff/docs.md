# Serah terima: docs (fitur Konsinyasi, backend)

- Status: SEBAGIAN. `docs/manual/konsinyasi.md` dan `CHANGELOG.md` selesai. `README.md` belum diperbarui karena izin Read ditolak. Lihat "Belum selesai".

## Yang dikerjakan
- `docs/manual/konsinyasi.md`: konsep, diagram status (Mermaid), endpoint ringkas dan contoh curl, role, perubahan `GET /api/warehouses`, perbaikan bug, cara menjalankan migrasi (belum dijalankan), catatan BUG-004, status verifikasi.
- `CHANGELOG.md` baru (Keep a Changelog, `[Unreleased]`).
- `docs/handoff/docs.md` (file ini).

## File utama
- `docs/manual/konsinyasi.md` (baru)
- `CHANGELOG.md` (baru)
- `docs/handoff/docs.md` (baru)

## Cara memverifikasi
```
cd C:\laragon\www\pos-backend
npx prisma validate        # dijalankan saat penulisan: valid
```
Contoh curl di manual belum dijalankan terhadap server (tidak ada database uji).

## Asumsi dan keputusan
- Sumber: `docs/api-contract.md` (kontrak), `docs/handoff/backend.md`, `docs/handoff/qc.md`, dan kode route (keberadaan 7 route konsinyasi dan logika default `type=STORE` dicek di `src/app/api/`).
- Dokumen `docs/analysis/consignment-fit.md` sudah usang. Bagian 0 menyatakan backend tidak bisa dibaca. Yang berlaku adalah kontrak dan serah terima backend. Analisis juga menyebut GUDANG boleh menulis, padahal kontrak tidak mengizinkan.
- Versi tidak dinaikkan. Semua perubahan di `[Unreleased]`.

## Belum selesai
- **README.md belum diperbarui.** Izin Read untuk `C:\laragon\www\pos-backend\README.md` ditolak dua kali, sehingga Edit tidak bisa dilakukan. Yang perlu ditambahkan:
  1. Bagian "Modul Konsinyasi" sebelum "Sisa Roadmap" (ringkasan dan tautan ke `docs/manual/konsinyasi.md`).
  2. Nomor "Sisa Roadmap" menjadi 11.
  Isi bagian ini sudah tersedia di `docs/manual/konsinyasi.md` bagian 1 sampai 6.
- **`docs/qc/` kosong.** `docs/handoff/qc.md` merujuk `docs/qc/report.md`, yang tidak ada. Detail BUG-004 belum bisa diverifikasi dari repo. Manual hanya memakai ringkasan dari `qc.md`.
- Migrasi belum diverifikasi terhadap database. Perintah `prisma migrate status` belum dijalankan.
- Skrip `npm run prisma:migrate` memakai `prisma migrate dev --name init`. Ini berisiko bila dipakai untuk migrasi baru. Disarankan diganti atau didokumentasikan.

## Permintaan ke agent lain
- backend: tulis `docs/qc/report.md` (atau salin dari hasil QC) agar BUG-004 bisa diverifikasi. Pertimbangkan mengganti skrip `prisma:migrate`.
- devops: jalankan `npx prisma migrate status` terhadap database target sebelum deploy (BUG-004).
- pengguna/manager: beri izin Read `README.md`, atau tambahkan bagian konsinyasi secara manual dari `docs/manual/konsinyasi.md`.
- frontend: pelunasan piutang belum punya UI di mobile. Tambahkan bila dibutuhkan (lihat `pos-mobile/docs/manual/konsinyasi-user-guide.md` bagian 10).
