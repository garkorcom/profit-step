/**
 * useReconciliationExport — CSV and PDF export handlers for Reconciliation page.
 *
 * Extracted from ReconciliationPage.tsx to reduce file size.
 */
import { useCallback, useState } from 'react';
import {
  type EnrichedTx,
  type QuickFilter,
  COST_CATEGORY_LABELS,
  renderDate,
} from '../components/reconciliation/types';
import { db } from '../firebase/firebase';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';

interface ExportDeps {
  filteredTransactions: EnrichedTx[];
  projects: { id: string; name: string }[];
  view: 'draft' | 'approved' | 'ignored';
  filterMonth: string;
  quickFilter: QuickFilter;
  searchQuery: string;
  /** When provided, ZIP export scopes bank_transactions to this company.
   *  Skip for legacy users whose docs don't have companyId. */
  companyId?: string | null;
}

const csvEscape = (value: unknown): string => {
  if (value === null || value === undefined) return '""';
  const s = typeof value === 'string' ? value : String(value);
  return `"${s.replace(/"/g, '""')}"`;
};

const tsToDate = (raw: unknown): Date | null => {
  if (!raw) return null;
  if (raw instanceof Timestamp) return raw.toDate();
  if (raw instanceof Date) return raw;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  const r = raw as { seconds?: number; toDate?: () => Date };
  if (typeof r.toDate === 'function') return r.toDate();
  if (typeof r.seconds === 'number') return new Date(r.seconds * 1000);
  return null;
};

const monthKeyFromDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const isoDate = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '');
const isoDateTime = (d: Date | null): string =>
  d ? `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}` : '';

export function useReconciliationExport(deps: ExportDeps) {
  const { filteredTransactions, projects, view, filterMonth, quickFilter, searchQuery, companyId } = deps;
  const [zipExporting, setZipExporting] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  // ─── CSV Export ─────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    const BOM = '\uFEFF';
    const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
    const headers = ['Date', 'Merchant', 'Raw Description', 'Location', 'Amount', 'Type', 'Category', 'Project'];
    const rows = filteredTransactions.map(t => [
      esc(renderDate(t.date)),
      esc(t.cleanMerchant || ''),
      esc(t.rawDescription || ''),
      esc(t._location || ''),
      Math.abs(t.amount).toFixed(2),
      t.paymentType === 'company' ? 'Company' : 'Personal',
      esc(COST_CATEGORY_LABELS[t.categoryId] || t.categoryId),
      esc(projects.find(p => p.id === t.projectId)?.name || ''),
    ]);
    const csv = BOM + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredTransactions, projects]);

  // ─── PDF Export ─────────────────────────────────────────
  const handleExportPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf');
    await import('jspdf-autotable');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const now = new Date();
    pdf.setFontSize(16);
    pdf.text(`Reconciliation Report — ${now.toLocaleDateString('ru-RU')}`, 14, 15);
    pdf.setFontSize(9);
    const filterInfo: string[] = [];
    if (view !== 'draft') filterInfo.push(`View: ${view}`);
    if (filterMonth !== 'all') filterInfo.push(`Month: ${filterMonth}`);
    if (quickFilter !== 'all') filterInfo.push(`Filter: ${quickFilter}`);
    if (searchQuery) filterInfo.push(`Search: ${searchQuery}`);
    if (filterInfo.length > 0) pdf.text(`Filters: ${filterInfo.join(' | ')}`, 14, 22);

    const tableData = filteredTransactions.map(t => [
      renderDate(t.date),
      t.cleanMerchant || '',
      t._location || '',
      `$${Math.abs(t.amount).toFixed(2)}${t.amount > 0 ? ' (ret)' : ''}`,
      t.paymentType === 'company' ? 'Company' : 'Personal',
      COST_CATEGORY_LABELS[t.categoryId] || t.categoryId,
      projects.find(p => p.id === t.projectId)?.name || '',
      t.verifiedBy ? '\u2713' : '',
    ]);
    type PdfExt = { autoTable: (o: Record<string, unknown>) => void; lastAutoTable?: { finalY?: number } };
    const ext = pdf as unknown as PdfExt;
    ext.autoTable({
      head: [['Date', 'Merchant', 'Location', 'Amount', 'Type', 'Category', 'Project', '\u2713']],
      body: tableData,
      startY: filterInfo.length > 0 ? 26 : 20,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
    });
    const finalY = ext.lastAutoTable?.finalY || 200;
    const total = filteredTransactions.reduce((s, t) => s + Math.abs(t.amount), 0);
    pdf.setFontSize(10);
    pdf.text(`Total: $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })} | Count: ${filteredTransactions.length}`, 14, finalY + 8);
    pdf.save(`reconciliation-${now.toISOString().slice(0, 10)}.pdf`);
  }, [filteredTransactions, view, filterMonth, quickFilter, searchQuery, projects]);

  // ─── ZIP-by-month Export ────────────────────────────────
  // Loads ALL bank_transactions + costs visible to the current user (RLS-scoped)
  // for the given year, groups by month, packages CSVs into one ZIP.
  const handleExportByMonthZip = useCallback(async (year: number = new Date().getFullYear()) => {
    setZipExporting(true);
    setZipError(null);
    try {
      const { default: JSZip } = await import('jszip');

      // ─── 1. Load bank_transactions for the current company (RLS-scoped) ──
      // `date` field is a string ('YYYY-MM-DD') in some docs and Timestamp in others —
      // we filter by year in memory rather than at the server, but DO scope by
      // companyId at the server when we know it, to avoid pulling other tenants'
      // docs through the RLS allowlist on big accounts.
      const txQuery = companyId
        ? query(collection(db, 'bank_transactions'), where('companyId', '==', companyId))
        : query(collection(db, 'bank_transactions'));
      const txSnap = await getDocs(txQuery);
      const allTxDocs: Array<Record<string, unknown> & { id: string }> = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const txDocs = allTxDocs.filter(t => {
        const d = tsToDate(t.date) || tsToDate(t.createdAt);
        return d?.getFullYear() === year;
      });

      // ─── 2. Load costs for the year (filter by createdAt Timestamp) ───────
      const yearStart = Timestamp.fromDate(new Date(year, 0, 1, 0, 0, 0));
      const yearEnd = Timestamp.fromDate(new Date(year + 1, 0, 1, 0, 0, 0));
      const costsQuery = query(
        collection(db, 'costs'),
        where('createdAt', '>=', yearStart),
        where('createdAt', '<', yearEnd),
      );
      const costsSnap = await getDocs(costsQuery);
      const costDocs: Array<Record<string, unknown> & { id: string }> = costsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // ─── 3. Group bank_transactions by month ────────────────────
      const txByMonth = new Map<string, typeof txDocs>();
      for (const t of txDocs) {
        const d = tsToDate(t.date) || tsToDate(t.createdAt);
        const mk = d ? monthKeyFromDate(d) : `${year}-00-unknown`;
        if (!txByMonth.has(mk)) txByMonth.set(mk, []);
        txByMonth.get(mk)!.push(t);
      }

      // ─── 4. Group costs by month ────────────────────────────────
      const costsByMonth = new Map<string, typeof costDocs>();
      for (const c of costDocs) {
        const d = tsToDate(c.createdAt) || tsToDate(c.date);
        const mk = d ? monthKeyFromDate(d) : `${year}-00-unknown`;
        if (!costsByMonth.has(mk)) costsByMonth.set(mk, []);
        costsByMonth.get(mk)!.push(c);
      }

      // ─── 5. Build CSVs ──────────────────────────────────────────
      const BOM = '﻿';
      const projectName = (id: unknown): string => projects.find(p => p.id === id)?.name || (typeof id === 'string' ? id : '');

      const txHeaders = [
        'id', 'date', 'year', 'month', 'vendor', 'rawDescription', 'city', 'state',
        'amount', 'category', 'categoryId', 'paymentType', 'projectId', 'projectName',
        'employeeId', 'statementId', 'status', 'isTransfer', 'isDeductible',
        'autoApprovedReason', 'verifiedBy', 'notes',
      ];
      const txRow = (t: Record<string, unknown>): string[] => [
        String(t.id ?? ''),
        isoDate(tsToDate(t.date)),
        String(t.year ?? ''),
        String(t.month ?? ''),
        String(t.vendor ?? ''),
        String(t.rawDescription ?? ''),
        String(t.city ?? ''),
        String(t.state ?? ''),
        String(t.amount ?? ''),
        String(t.category ?? ''),
        String(t.categoryId ?? ''),
        String(t.paymentType ?? ''),
        String(t.projectId ?? ''),
        projectName(t.projectId),
        String(t.employeeId ?? ''),
        String(t.statementId ?? ''),
        String(t.status ?? ''),
        String(t.isTransfer ?? ''),
        String(t.isDeductible ?? ''),
        String(t.autoApprovedReason ?? ''),
        String(t.verifiedBy ?? ''),
        String(t.notes ?? ''),
      ];

      const costHeaders = [
        'id', 'createdAt', 'userId', 'userName', 'clientId', 'clientName',
        'category', 'categoryLabel', 'amount', 'originalAmount',
        'description', 'status', 'receiptPhotoUrl', 'voiceNoteUrl', 'projectId',
      ];
      const costRow = (c: Record<string, unknown>): string[] => [
        String(c.id ?? ''),
        isoDateTime(tsToDate(c.createdAt)),
        String(c.userId ?? ''),
        String(c.userName ?? ''),
        String(c.clientId ?? ''),
        String(c.clientName ?? ''),
        String(c.category ?? ''),
        String(c.categoryLabel ?? ''),
        String(c.amount ?? ''),
        String(c.originalAmount ?? ''),
        String(c.description ?? ''),
        String(c.status ?? ''),
        String(c.receiptPhotoUrl ?? ''),
        String(c.voiceNoteUrl ?? ''),
        String(c.projectId ?? ''),
      ];

      const buildCsv = (headers: string[], rows: string[][]): string =>
        BOM + [headers.map(csvEscape).join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n');

      // ─── 6. Assemble ZIP ────────────────────────────────────────
      const zip = new JSZip();
      const txFolder = zip.folder('bank_transactions');
      const costsFolder = zip.folder('costs');

      const allMonthKeys = new Set<string>([...txByMonth.keys(), ...costsByMonth.keys()]);
      const sortedMonths = Array.from(allMonthKeys).sort();

      for (const mk of sortedMonths) {
        const txs = txByMonth.get(mk) || [];
        const cs = costsByMonth.get(mk) || [];
        if (txs.length > 0) {
          txFolder?.file(`${mk}.csv`, buildCsv(txHeaders, txs.map(txRow)));
        }
        if (cs.length > 0) {
          costsFolder?.file(`${mk}.csv`, buildCsv(costHeaders, cs.map(costRow)));
        }
      }

      // Manifest
      const manifest = {
        exportedAt: new Date().toISOString(),
        year,
        bank_transactions: {
          total: txDocs.length,
          byMonth: Object.fromEntries(Array.from(txByMonth.entries()).map(([k, v]) => [k, v.length])),
        },
        costs: {
          total: costDocs.length,
          byMonth: Object.fromEntries(Array.from(costsByMonth.entries()).map(([k, v]) => [k, v.length])),
        },
        note: 'Scope: only data visible to the exporting user under RLS. All statuses included.',
      };
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      // ─── 7. Trigger download ────────────────────────────────────
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `garkorfin${year}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('ZIP export failed:', e);
      setZipError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setZipExporting(false);
    }
  }, [projects, companyId]);

  return { handleExportCSV, handleExportPDF, handleExportByMonthZip, zipExporting, zipError };
}
