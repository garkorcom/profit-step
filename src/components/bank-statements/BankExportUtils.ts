/**
 * @fileoverview Pure export functions for bank statements.
 * CSV, PDF, and Schedule C exports — no React dependencies.
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';

// jspdf-autotable extends jsPDF at runtime; types aren't exported.
// This is the subset of the plugin API we use across all export helpers.
type PdfWithAutoTable = jsPDF & {
    autoTable: (opts: Record<string, unknown>) => void;
    lastAutoTable?: { finalY?: number };
};
import {
    BankTransaction,
    InlineReportData,
    TaxCategory,
    INCOME_CATEGORIES,
    SUBCONTRACT_CATEGORIES,
    TRANSFER_CATEGORIES,
    CATEGORY_LABELS,
    SCHEDULE_C_MAP,
    DEFAULT_DEDUCTIBILITY,
    MONTH_NAMES,
} from './bankStatements.types';

// ─── CSV Export (basic) ─────────────────────────────────────

export function exportCSV(
    transactions: BankTransaction[],
    filterCategory: TaxCategory | 'all',
    selectedYear: number,
): void {
    const filtered = filterCategory === 'all'
        ? transactions
        : transactions.filter(tx => tx.category === filterCategory);

    const headers = ['Date', 'Vendor', 'City', 'State', 'Category', 'Amount', 'Deductible', 'Notes'];
    const rows = filtered.map(tx => [
        new Date(tx.date.seconds * 1000).toLocaleDateString(),
        tx.vendor,
        tx.city || '',
        tx.state || '',
        tx.category,
        tx.amount.toFixed(2),
        tx.isDeductible ? 'Yes' : 'No',
        tx.notes || '',
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    downloadBlob(csv, `bank_statements_${selectedYear}.csv`, 'text/csv');
}

// ─── PDF Export (basic) ─────────────────────────────────────

export function exportPDF(
    transactions: BankTransaction[],
    filterCategory: TaxCategory | 'all',
    selectedYear: number,
): void {
    const filtered = filterCategory === 'all'
        ? transactions
        : transactions.filter(tx => tx.category === filterCategory);

    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text(`Bank Statements ${selectedYear}`, 14, 22);

    doc.setFontSize(10);
    doc.text(`Total Transactions: ${filtered.length}`, 14, 32);
    doc.text(`Total Amount: $${Math.abs(filtered.reduce((sum, tx) => sum + tx.amount, 0)).toFixed(2)}`, 14, 38);

    const tableData = filtered.map(tx => [
        new Date(tx.date.seconds * 1000).toLocaleDateString(),
        tx.vendor.substring(0, 25),
        tx.category,
        `$${Math.abs(tx.amount).toFixed(2)}`,
    ]);

    (doc as PdfWithAutoTable).autoTable({
        startY: 45,
        head: [['Date', 'Vendor', 'Category', 'Amount']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [66, 66, 66] },
        styles: { fontSize: 8 },
    });

    doc.save(`bank_statements_${selectedYear}.pdf`);
}

// ─── Detailed CSV ───────────────────────────────────────────

export function exportDetailedCSV(
    monthFilteredTransactions: BankTransaction[],
    selectedYear: number,
    selectedMonth: number | 'all',
): void {
    const filtered = monthFilteredTransactions.filter(tx => tx.category !== 'private');

    const getType = (category: TaxCategory): string => {
        if (INCOME_CATEGORIES.has(category)) return 'Income';
        if (SUBCONTRACT_CATEGORIES.has(category)) return 'Subcontract';
        if (TRANSFER_CATEGORIES.includes(category)) return 'Internal Transfer (Not Tax Deductible)';
        return 'Expense';
    };

    const getTaxDeductible = (category: TaxCategory): string => {
        if (TRANSFER_CATEGORIES.includes(category)) return 'No';
        if (category === 'insurance') return 'Partially';
        if (category === 'private') return 'No';
        return 'Yes';
    };

    const header = 'Date,Type,Category,Description,Counterparty,Amount_USD,Tax_Deductible,Notes';
    const rows = filtered.map(tx => {
        const date = new Date(tx.date.seconds * 1000).toISOString().split('T')[0];
        const type = getType(tx.category);
        const category = CATEGORY_LABELS[tx.category];
        const description = tx.rawDescription.replace(/,/g, ' ').replace(/"/g, "'");
        const counterparty = tx.vendor.replace(/,/g, ' ').replace(/"/g, "'");
        const amount = Math.abs(tx.amount).toFixed(2);
        const taxDeductible = getTaxDeductible(tx.category);
        const notes = tx.notes?.replace(/,/g, ' ').replace(/"/g, "'") || '';

        return `${date},"${type}","${category}","${description}","${counterparty}",${amount},${taxDeductible},"${notes}"`;
    });

    const csv = [header, ...rows].join('\n');
    const monthStr = selectedMonth === 'all' ? 'ALL' : String(selectedMonth).padStart(2, '0');
    downloadBlob(csv, `Detailed_Export_${selectedYear}_${monthStr}.csv`, 'text/csv;charset=utf-8;');
}

// ─── Category Summary CSV ───────────────────────────────────

export function exportCategorySummaryCSV(
    monthFilteredTransactions: BankTransaction[],
    selectedYear: number,
    selectedMonth: number | 'all',
): string {
    const filtered = monthFilteredTransactions.filter(tx => tx.category !== 'private');

    const categoryTotals: Record<string, number> = {};
    let totalIncome = 0;
    let totalExpenses = 0;
    let totalTransfers = 0;
    let totalSubcontract = 0;

    filtered.forEach(tx => {
        const amount = Math.abs(tx.amount);
        categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + amount;

        if (INCOME_CATEGORIES.has(tx.category)) totalIncome += amount;
        else if (SUBCONTRACT_CATEGORIES.has(tx.category)) totalSubcontract += amount;
        else if (TRANSFER_CATEGORIES.includes(tx.category)) totalTransfers += amount;
        else totalExpenses += amount;
    });

    let csv = 'Type,Category,Amount_USD\n';
    csv += `Income,Client Payments (net of internal transfers),${totalIncome.toFixed(2)}\n`;

    const expenseRows = [
        { cat: 'office_rent', label: 'Rent (Office / Home office portion)' },
        { cat: 'apps_work', label: 'Apps for Work (Dropbox)' },
        { cat: 'advertising', label: 'Advertising (Instagram)' },
        { cat: 'materials', label: 'Tools & Materials' },
        { cat: 'car_repair', label: 'Car Repair' },
        { cat: 'fees', label: 'Bank Fees (PayPal + International Wire Fee)' },
        { cat: 'fuel', label: 'Auto Expense / Fuel' },
        { cat: 'software', label: 'Software / Subscriptions' },
        { cat: 'meals', label: 'Business Meals' },
        { cat: 'office_supplies', label: 'Office / Miscellaneous' },
        { cat: 'payroll', label: 'Payroll (Salary)' },
        { cat: 'payroll_taxes', label: 'Payroll Taxes' },
        { cat: 'permits_licenses', label: 'Permits & Licenses' },
        { cat: 'business_services', label: 'Business Services' },
        { cat: 'insurance', label: 'Insurance' },
        { cat: 'hotels', label: 'Hotels' },
        { cat: 'office_equipment', label: 'Office Equipment' },
        { cat: 'atm_debit', label: 'ATM & Debit Card' },
        { cat: 'zelle_expense', label: 'Zelle - Expense' },
        { cat: 'cash_expense', label: 'Cash - Expense' },
    ];

    expenseRows.forEach(row => {
        const amount = categoryTotals[row.cat] || 0;
        if (amount > 0) csv += `Expense,${row.label},${amount.toFixed(2)}\n`;
    });

    csv += `Subcontract,Subcontract Expenses (Zelle to contractors),${totalSubcontract.toFixed(2)}\n`;
    csv += `Internal Transfer (Not Tax Deductible),Business credit card payments + PayPal transfers,${totalTransfers.toFixed(2)}\n`;
    csv += `TOTAL_INCOME,Total Income (Business),${totalIncome.toFixed(2)}\n`;

    const totalBusinessExpenses = totalExpenses + totalSubcontract;
    csv += `TOTAL_EXPENSE,Total Business Expenses (excluding Internal Transfers),${totalBusinessExpenses.toFixed(2)}\n`;

    const netProfit = totalIncome - totalBusinessExpenses;
    csv += `NET_PROFIT,Net Profit / Loss (Income - Expenses),${netProfit.toFixed(2)}\n`;

    const fileName = `${MONTH_NAMES[(selectedMonth as number) - 1] || 'All'}_${selectedYear}_with_Totals.csv`;
    downloadBlob(csv, fileName, 'text/csv;charset=utf-8;');

    return fileName;
}

// ─── Report PDF ─────────────────────────────────────────────

export function exportReportPDF(data: InlineReportData): string {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header
    doc.setFillColor(52, 73, 94);
    doc.rect(0, 0, pageWidth, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Garkor Corp', 14, 18);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Bank Statement Report - ${data.period}`, 14, 28);

    doc.setTextColor(0, 0, 0);
    let yPos = 45;

    // Summary boxes
    doc.setFillColor(46, 125, 50);
    doc.rect(14, yPos, 85, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text('TOTAL INCOME', 18, yPos + 8);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`$${data.income.toFixed(2)}`, 18, yPos + 20);

    doc.setFillColor(198, 40, 40);
    doc.rect(105, yPos, 85, 25, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('TOTAL EXPENSES', 109, yPos + 8);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`$${(data.expenses + data.subcontract).toFixed(2)}`, 109, yPos + 20);

    yPos += 35;

    doc.setTextColor(0, 0, 0);
    doc.setFillColor(240, 240, 240);
    doc.rect(14, yPos, pageWidth - 28, 15, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`NET PROFIT: $${data.net.toFixed(2)}`, 18, yPos + 10);
    yPos += 25;

    // Expense table
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Expense Breakdown', 14, yPos);
    yPos += 8;

    const expenseData: string[][] = [];
    Object.entries(data.categories).forEach(([cat, amount]) => {
        if (!INCOME_CATEGORIES.has(cat as TaxCategory) &&
            !TRANSFER_CATEGORIES.includes(cat as TaxCategory) &&
            cat !== 'private' && amount > 0) {
            expenseData.push([
                CATEGORY_LABELS[cat as TaxCategory] || cat,
                `$${amount.toFixed(2)}`,
            ]);
        }
    });

    if (expenseData.length > 0) {
        const docWithPlugin = doc as PdfWithAutoTable;
        docWithPlugin.autoTable({
            startY: yPos,
            head: [['Category', 'Amount']],
            body: expenseData,
            theme: 'striped',
            headStyles: { fillColor: [66, 66, 66] },
            styles: { fontSize: 9 },
            columnStyles: {
                0: { cellWidth: 120 },
                1: { cellWidth: 40, halign: 'right' },
            },
        });
        yPos = (docWithPlugin.lastAutoTable?.finalY ?? yPos) + 10;
    }

    // Transfers
    if (data.transfers > 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(`Internal Transfers (Not Deductible): $${data.transfers.toFixed(2)}`, 14, yPos);
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated: ${new Date().toLocaleDateString()} | Transactions: ${data.transactionCount}`, 14, 280);

    const fileName = `BankReport_${data.period.replace(/\s+/g, '_')}.pdf`;
    doc.save(fileName);
    return fileName;
}

// ─── Schedule C PDF ─────────────────────────────────────────

export function downloadScheduleC(
    monthFilteredTransactions: BankTransaction[],
    selectedYear: number,
    selectedMonth: number | 'all',
): void {
    const doc_pdf = new jsPDF();
    const pageWidth = doc_pdf.internal.pageSize.getWidth();

    // Header
    doc_pdf.setFillColor(25, 118, 210);
    doc_pdf.rect(0, 0, pageWidth, 35, 'F');
    doc_pdf.setTextColor(255, 255, 255);
    doc_pdf.setFontSize(18);
    doc_pdf.setFont('helvetica', 'bold');
    doc_pdf.text('Schedule C — Profit or Loss from Business', 14, 18);
    doc_pdf.setFontSize(10);
    doc_pdf.setFont('helvetica', 'normal');
    const periodLabel = selectedMonth === 'all'
        ? `Year ${selectedYear}`
        : `${MONTH_NAMES[(selectedMonth as number) - 1]} ${selectedYear}`;
    doc_pdf.text(`Garkor Corp — ${periodLabel}`, 14, 28);

    doc_pdf.setTextColor(0, 0, 0);
    let yPos = 45;

    // Build Schedule C data
    const scheduleCData: Record<string, { line: string; amount: number; deductible: number }> = {};

    monthFilteredTransactions.forEach(tx => {
        if (tx.category === 'private' || tx.category === 'uncategorized') return;
        if (INCOME_CATEGORIES.has(tx.category)) return;
        if (TRANSFER_CATEGORIES.includes(tx.category)) return;

        const lineItem = SCHEDULE_C_MAP[tx.category] || 'Other Expenses';
        const amount = Math.abs(tx.amount);
        const pct = tx.deductibilityPercent ?? (DEFAULT_DEDUCTIBILITY[tx.category] ?? 100);
        const deductible = amount * (pct / 100);

        if (!scheduleCData[lineItem]) {
            scheduleCData[lineItem] = { line: lineItem, amount: 0, deductible: 0 };
        }
        scheduleCData[lineItem].amount += amount;
        scheduleCData[lineItem].deductible += deductible;
    });

    const tableData = Object.values(scheduleCData)
        .sort((a, b) => b.deductible - a.deductible)
        .map(row => [row.line, `$${row.amount.toFixed(2)}`, `$${row.deductible.toFixed(2)}`]);

    const totalAmount = Object.values(scheduleCData).reduce((s, r) => s + r.amount, 0);
    const totalDeductible = Object.values(scheduleCData).reduce((s, r) => s + r.deductible, 0);

    if (tableData.length > 0) {
        const pdfPlugin = doc_pdf as PdfWithAutoTable;
        pdfPlugin.autoTable({
            startY: yPos,
            head: [['IRS Line Item', 'Gross Amount', 'Tax Deductible']],
            body: tableData,
            foot: [['TOTAL', `$${totalAmount.toFixed(2)}`, `$${totalDeductible.toFixed(2)}`]],
            theme: 'grid',
            headStyles: { fillColor: [25, 118, 210] },
            footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
            styles: { fontSize: 9 },
            columnStyles: {
                0: { cellWidth: 90 },
                1: { cellWidth: 40, halign: 'right' },
                2: { cellWidth: 40, halign: 'right' },
            },
        });
        yPos = (pdfPlugin.lastAutoTable?.finalY ?? yPos) + 15;
    }

    // Income summary
    const totalIncome = monthFilteredTransactions
        .filter(tx => INCOME_CATEGORIES.has(tx.category))
        .reduce((s, tx) => s + Math.abs(tx.amount), 0);

    doc_pdf.setFontSize(12);
    doc_pdf.setFont('helvetica', 'bold');
    doc_pdf.text(`Gross Income (Line 1): $${totalIncome.toFixed(2)}`, 14, yPos);
    yPos += 8;
    doc_pdf.text(`Total Deductions: $${totalDeductible.toFixed(2)}`, 14, yPos);
    yPos += 8;
    doc_pdf.setFontSize(14);
    const netProfit = totalIncome - totalDeductible;
    doc_pdf.text(`Net Profit (Line 31): $${netProfit.toFixed(2)}`, 14, yPos);

    // Footer
    doc_pdf.setFontSize(7);
    doc_pdf.setFont('helvetica', 'normal');
    doc_pdf.setTextColor(150, 150, 150);
    doc_pdf.text(`Generated: ${new Date().toLocaleString()} | This is a draft — consult your CPA`, 14, 285);

    doc_pdf.save(`ScheduleC_Draft_${periodLabel.replace(/\s+/g, '_')}.pdf`);
}

// ─── Helper ─────────────────────────────────────────────────

function downloadBlob(content: string, fileName: string, type: string): void {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
}
