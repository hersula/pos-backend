import { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

// Kode akun default yang dibuat otomatis saat tenant di-approve (lihat admin/tenants/[id]/approve)
export const ACCOUNT_CODES = {
  KAS: "1000",
  BANK: "1100",
  PIUTANG_USAHA: "1200",
  PERSEDIAAN: "1300",
  HUTANG_USAHA: "2000",
  PPN_KELUARAN: "2100",
  MODAL_PEMILIK: "3000",
  PENDAPATAN_PENJUALAN: "4000",
  HPP: "5000",
  BEBAN_OPERASIONAL: "6000",
} as const;

type JournalLineInput = {
  accountCode: string;
  debit?: number;
  credit?: number;
};

async function resolveAccountId(tx: TxClient, tenantId: string, code: string) {
  const account = await tx.chartOfAccount.findFirst({ where: { tenantId, code } });
  if (!account) {
    throw new Error(
      `Akun dengan kode ${code} tidak ditemukan untuk tenant ini. Pastikan Chart of Accounts default belum dihapus.`
    );
  }
  return account.id;
}

/**
 * Membuat satu jurnal (entry + baris debit/kredit). Memvalidasi total debit = total kredit
 * (toleransi pembulatan 1 sen) sebelum menyimpan — prinsip dasar double-entry accounting.
 */
export async function createJournalEntry(
  tx: TxClient,
  params: {
    tenantId: string;
    entryDate: Date;
    referenceType: string; // 'SALE' | 'SALE_CANCEL' | 'PURCHASE' | 'EXPENSE' | 'MANUAL'
    referenceId?: string;
    description: string;
    lines: JournalLineInput[];
  }
) {
  const { tenantId, entryDate, referenceType, referenceId, description, lines } = params;

  const totalDebit = round2(lines.reduce((sum, l) => sum + (l.debit ?? 0), 0));
  const totalCredit = round2(lines.reduce((sum, l) => sum + (l.credit ?? 0), 0));

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Jurnal tidak balance: total debit (${totalDebit}) != total kredit (${totalCredit}). Referensi: ${referenceType} ${referenceId ?? ""}`
    );
  }

  const resolvedLines = await Promise.all(
    lines
      .filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)
      .map(async (l) => ({
        accountId: await resolveAccountId(tx, tenantId, l.accountCode),
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
      }))
  );

  return tx.journalEntry.create({
    data: {
      tenantId,
      entryDate,
      referenceType,
      referenceId,
      description,
      lines: { create: resolvedLines },
    },
    include: { lines: true },
  });
}

/**
 * Jurnal otomatis saat transaksi penjualan disimpan (dipanggil di dalam transaction yang sama
 * dengan pembuatan Sale di POST /api/sales).
 *
 *   Debit  Kas/Bank        = sesuai masing-masing metode pembayaran
 *   Debit  Piutang Usaha   = sisa yang belum dibayar (kalau status PARTIAL)
 *   Kredit Pendapatan      = taxableAmount (subtotal - diskon)
 *   Kredit PPN Keluaran    = taxAmount
 *   Debit  HPP             = total harga modal barang terjual
 *   Kredit Persediaan      = total harga modal barang terjual
 */
export async function postSaleJournal(
  tx: TxClient,
  params: {
    tenantId: string;
    saleId: string;
    invoiceNo: string;
    entryDate: Date;
    payments: { method: "CASH" | "DEBIT" | "CREDIT" | "QRIS" | "TRANSFER" | "EWALLET"; amount: number }[];
    taxableAmount: number;
    taxAmount: number;
    grandTotal: number;
    paidTotal: number;
    cogsAmount: number; // total harga modal (costPrice * qty) barang yang terjual
  }
) {
  const { tenantId, saleId, invoiceNo, entryDate, payments, taxableAmount, taxAmount, grandTotal, paidTotal, cogsAmount } =
    params;

  const lines: JournalLineInput[] = [];

  // Debit Kas untuk pembayaran CASH, Debit Bank untuk metode non-tunai (digabung 1 akun demi kesederhanaan)
  let cashTotal = round2(payments.filter((p) => p.method === "CASH").reduce((s, p) => s + p.amount, 0));
  let bankTotal = round2(payments.filter((p) => p.method !== "CASH").reduce((s, p) => s + p.amount, 0));

  // PENTING: kalau pelanggan bayar lebih dari total tagihan (ada kembalian), uang yang
  // benar-benar "masuk" ke kas toko cuma sebesar grandTotal — sisanya dikembalikan tunai
  // ke pelanggan. Tanpa penyesuaian ini, sisi debit (kas) akan lebih besar dari sisi
  // kredit (pendapatan) sebesar kembalian, dan jurnal jadi tidak balance (error 500).
  // Kembalian diasumsikan selalu diambil dari uang tunai di laci kasir, baru dari
  // pembayaran non-tunai kalau tunai saja tidak cukup (kasus langka).
  let changeAmount = round2(paidTotal - grandTotal);
  if (changeAmount > 0) {
    const deductFromCash = Math.min(cashTotal, changeAmount);
    cashTotal = round2(cashTotal - deductFromCash);
    changeAmount = round2(changeAmount - deductFromCash);

    if (changeAmount > 0) {
      const deductFromBank = Math.min(bankTotal, changeAmount);
      bankTotal = round2(bankTotal - deductFromBank);
      changeAmount = round2(changeAmount - deductFromBank);
    }
  }

  if (cashTotal > 0) lines.push({ accountCode: ACCOUNT_CODES.KAS, debit: cashTotal });
  if (bankTotal > 0) lines.push({ accountCode: ACCOUNT_CODES.BANK, debit: bankTotal });

  const outstanding = round2(grandTotal - paidTotal);
  if (outstanding > 0) {
    lines.push({ accountCode: ACCOUNT_CODES.PIUTANG_USAHA, debit: outstanding });
  }

  lines.push({ accountCode: ACCOUNT_CODES.PENDAPATAN_PENJUALAN, credit: round2(taxableAmount) });
  if (taxAmount > 0) {
    lines.push({ accountCode: ACCOUNT_CODES.PPN_KELUARAN, credit: round2(taxAmount) });
  }

  if (cogsAmount > 0) {
    lines.push({ accountCode: ACCOUNT_CODES.HPP, debit: round2(cogsAmount) });
    lines.push({ accountCode: ACCOUNT_CODES.PERSEDIAAN, credit: round2(cogsAmount) });
  }

  return createJournalEntry(tx, {
    tenantId,
    entryDate,
    referenceType: "SALE",
    referenceId: saleId,
    description: `Penjualan ${invoiceNo}`,
    lines,
  });
}

/**
 * Jurnal pembelian saat PO diterima (dipanggil dari POST /api/purchase-orders/:id/receive).
 * Akun kredit tergantung metode pembayaran yang dipilih saat PO dibuat:
 *   - CASH     -> Debit Persediaan / Kredit Kas       (lunas seketika)
 *   - TRANSFER -> Debit Persediaan / Kredit Bank      (lunas seketika)
 *   - CREDIT   -> Debit Persediaan / Kredit Hutang Usaha (belum lunas / tempo)
 */
export async function postPurchaseJournal(
  tx: TxClient,
  params: {
    tenantId: string;
    poId: string;
    poNumber: string;
    entryDate: Date;
    total: number;
    paymentMethod: "CASH" | "CREDIT" | "TRANSFER";
  }
) {
  const { tenantId, poId, poNumber, entryDate, total, paymentMethod } = params;
  if (total <= 0) return null;

  const creditAccountCode =
    paymentMethod === "CASH"
      ? ACCOUNT_CODES.KAS
      : paymentMethod === "TRANSFER"
        ? ACCOUNT_CODES.BANK
        : ACCOUNT_CODES.HUTANG_USAHA;

  const methodLabel = paymentMethod === "CASH" ? "Tunai" : paymentMethod === "TRANSFER" ? "Transfer Bank" : "Tempo";

  return createJournalEntry(tx, {
    tenantId,
    entryDate,
    referenceType: "PURCHASE",
    referenceId: poId,
    description: `Penerimaan barang PO ${poNumber} (${methodLabel})`,
    lines: [
      { accountCode: ACCOUNT_CODES.PERSEDIAAN, debit: total },
      { accountCode: creditAccountCode, credit: total },
    ],
  });
}

/**
 * Jurnal pelunasan hutang usaha dari pembelian tempo (dipanggil dari
 * POST /api/purchase-orders/:id/payments).
 *   Debit  Hutang Usaha = amount
 *   Kredit Kas/Bank     = amount (tergantung metode pelunasan)
 */
export async function postPurchasePaymentJournal(
  tx: TxClient,
  params: {
    tenantId: string;
    poId: string;
    poNumber: string;
    entryDate: Date;
    amount: number;
    method: "CASH" | "TRANSFER";
  }
) {
  const { tenantId, poId, poNumber, entryDate, amount, method } = params;
  const debitCashOrBankCode = method === "CASH" ? ACCOUNT_CODES.KAS : ACCOUNT_CODES.BANK;

  return createJournalEntry(tx, {
    tenantId,
    entryDate,
    referenceType: "PURCHASE_PAYMENT",
    referenceId: poId,
    description: `Pelunasan hutang PO ${poNumber}`,
    lines: [
      { accountCode: ACCOUNT_CODES.HUTANG_USAHA, debit: amount },
      { accountCode: debitCashOrBankCode, credit: amount },
    ],
  });
}

/**
 * Jurnal beban operasional (dipanggil dari POST /api/expenses).
 *   Debit  Beban Operasional = amount
 *   Kredit Kas                = amount
 */
export async function postExpenseJournal(
  tx: TxClient,
  params: { tenantId: string; expenseId: string; entryDate: Date; amount: number; description: string }
) {
  const { tenantId, expenseId, entryDate, amount, description } = params;

  return createJournalEntry(tx, {
    tenantId,
    entryDate,
    referenceType: "EXPENSE",
    referenceId: expenseId,
    description,
    lines: [
      { accountCode: ACCOUNT_CODES.BEBAN_OPERASIONAL, debit: amount },
      { accountCode: ACCOUNT_CODES.KAS, credit: amount },
    ],
  });
}

/**
 * Membuat jurnal balik (reversing entry) dari seluruh jurnal yang terhubung ke sebuah referensi
 * (mis. saat transaksi penjualan dibatalkan). Debit <-> Kredit ditukar dari jurnal asal.
 */
export async function reverseJournalForReference(
  tx: TxClient,
  params: { tenantId: string; referenceType: string; referenceId: string; entryDate: Date; description: string }
) {
  const { tenantId, referenceType, referenceId, entryDate, description } = params;

  const originalEntries = await tx.journalEntry.findMany({
    where: { tenantId, referenceType, referenceId },
    include: { lines: true },
  });

  const reversedEntries = [];
  for (const original of originalEntries) {
    const lines: JournalLineInput[] = await Promise.all(
      original.lines.map(async (line) => {
        const account = await tx.chartOfAccount.findUnique({ where: { id: line.accountId } });
        return {
          accountCode: account!.code,
          debit: Number(line.credit), // ditukar
          credit: Number(line.debit),
        };
      })
    );

    const reversed = await createJournalEntry(tx, {
      tenantId,
      entryDate,
      referenceType: `${referenceType}_CANCEL`,
      referenceId,
      description,
      lines,
    });
    reversedEntries.push(reversed);
  }

  return reversedEntries;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
