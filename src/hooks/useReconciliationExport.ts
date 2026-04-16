/**
 * useReconciliationExport — CSV and PDF export handlers for Reconciliation page.
 *
 * Extracted from ReconciliationPage.tsx to reduce file size.
 */
import { useCallback } from 'react';
import {
  type EnrichedTx,
  type QuickFilter,
  COST_CATEGORY_LABELS,
  renderDate,
} from '../components/reconciliation/types';

interface ExportDeps {
  filteredTransactions: EnrichedTx[];
  projects: { id: string; name: string }[];
  view: 'draft' | 'approved' | 'ignored';
  filterMonth: string;
  quickFilter: QuickFilter;
  searchQuery: string;
}

export function useReconciliationExport(deps: ExportDeps) {
  const { filteredTransactions, projects, view, filterMonth, quickFilter, searchQuery } = deps;

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

  return { handleExportCSV, handleExportPDF };
}
