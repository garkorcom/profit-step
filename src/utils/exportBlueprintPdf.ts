import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BlueprintAgentResult } from '../types/blueprint.types';
import { ITEM_NAMES } from '../constants/electricalDevices';
import { validateRoomCount, countTotalDevices } from './estimateValidation';

export interface PageResult {
    fileIndex: number;
    pageIndex: number;
    fileName: string;
    geminiResult?: BlueprintAgentResult;
    claudeResult?: BlueprintAgentResult;
    openAiResult?: BlueprintAgentResult;
    mergedResult: BlueprintAgentResult;
}

export const exportBlueprintPdf = (
    projectName: string,
    pageResults: PageResult[],
    globalMerged: BlueprintAgentResult,
    selectedAgents: string[]
) => {
    const pdf = new jsPDF();
    const dateStr = new Date().toLocaleDateString();

    // Title
    pdf.setFontSize(16);
    pdf.text('AI Blueprint Analysis Report (V2)', 14, 22);

    // Metadata
    pdf.setFontSize(10);
    pdf.setTextColor(100);
    pdf.text(`Project: ${projectName || 'Untitled Project'}`, 14, 30);
    pdf.text(`Analyzed Pages: ${pageResults.length} | Date: ${dateStr}`, 14, 36);
    pdf.text(`AI Agents Used: ${selectedAgents.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ')}`, 14, 42);

    // PROJECT OVERVIEW — quick validation
    const totalDevices = countTotalDevices(globalMerged);
    const roomVal = validateRoomCount(pageResults.length);
    const overviewBg: [number, number, number] = roomVal.status !== 'ok' ? [255, 243, 224] : [232, 245, 233];
    pdf.setFillColor(...overviewBg);
    pdf.roundedRect(14, 46, 182, 14, 2, 2, 'F');
    pdf.setFontSize(8);
    pdf.setTextColor(33, 33, 33);
    pdf.text(`📋 OVERVIEW: ${pageResults.length} pages | ${Object.keys(globalMerged).length} device types | ${totalDevices} total devices | ${roomVal.message}`, 18, 54);

    pdf.setFontSize(9);
    pdf.setTextColor(211, 47, 47); // Warning red color
    pdf.text('* Note: This report reflects RAW visual data prior to the Master Electrician Smart Auditor review.', 14, 66);

    let currentY = 72;

    // Helper to render a table
    const renderTable = (result: BlueprintAgentResult, title: string, pageRes?: PageResult) => {
        pdf.setFontSize(12);
        pdf.setTextColor(33, 33, 33);
        pdf.text(title, 14, currentY);
        currentY += 4;

        const items = Object.entries(result)
            .filter(([, qty]) => qty > 0)
            .sort((a, b) => b[1] - a[1]);

        if (items.length === 0) {
            pdf.setFontSize(10);
            pdf.setTextColor(150);
            pdf.text('No results found.', 14, currentY + 4);
            currentY += 12;
            return;
        }

        const head = [['Item', 'Suggested Qty']];
        if (pageRes) {
            if (selectedAgents.includes('gemini')) head[0].push('Gemini');
            if (selectedAgents.includes('claude')) head[0].push('Claude');
            if (selectedAgents.includes('openai')) head[0].push('OpenAI');
            head[0].push('Status');
        }

        const body = items.map(([key, qty]) => {
            const name = ITEM_NAMES[key] || key.replace(/_/g, ' ');
            const row = [name, qty.toString()];

            if (pageRes) {
                const gQty = pageRes.geminiResult?.[key] ?? null;
                const cQty = pageRes.claudeResult?.[key] ?? null;
                const oQty = pageRes.openAiResult?.[key] ?? null;

                const validCounts: number[] = [];
                if (selectedAgents.includes('gemini') && gQty !== null) validCounts.push(gQty);
                if (selectedAgents.includes('claude') && cQty !== null) validCounts.push(cQty);
                if (selectedAgents.includes('openai') && oQty !== null) validCounts.push(oQty);

                const match = validCounts.length > 0 && validCounts.every(v => v === validCounts[0]);
                const statusStr = match ? 'Match' : (validCounts.length > 0 ? 'Discrepancy' : 'N/A');

                if (selectedAgents.includes('gemini')) row.push(gQty !== null ? gQty.toString() : '-');
                if (selectedAgents.includes('claude')) row.push(cQty !== null ? cQty.toString() : '-');
                if (selectedAgents.includes('openai')) row.push(oQty !== null ? oQty.toString() : '-');
                row.push(statusStr);
            }
            return row;
        });

        autoTable(pdf, {
            startY: currentY,
            head,
            body,
            styles: { fontSize: 9 },
            headStyles: { fillColor: [46, 125, 50] },
            margin: { left: 14, right: 14 },
            theme: 'grid',
            didDrawCell: (data) => {
                if (pageRes && data.section === 'body' && data.column.index === head[0].length - 1) {
                    const status = data.cell.raw;
                    if (status === 'Discrepancy') {
                        pdf.setTextColor(211, 47, 47); // Red for error/warning
                    } else if (status === 'Match') {
                        pdf.setTextColor(56, 142, 60); // Green for match
                    } else {
                        pdf.setTextColor(100, 100, 100);
                    }
                }
            }
        });

        currentY = (pdf as any).lastAutoTable.finalY + 14;
    };

    // 1. Global Summary Section
    renderTable(globalMerged, 'GLOBAL SUMMARY (All Pages Combined)');

    // 2. Per-Page Drilldown
    if (pageResults.length > 1 || (pageResults.length > 0 && currentY > 50)) {
        pageResults.forEach((pr, idx) => {
            // Check page break
            if (currentY > 250) {
                pdf.addPage();
                currentY = 20;
            }
            const title = `Page ${idx + 1}: ${pr.fileName} (p.${pr.pageIndex + 1})`;
            renderTable(pr.mergedResult, title, pr);
        });
    }

    const safeName = (projectName || 'Estimator').replace(/[^a-zA-Z0-9-]/g, '_');
    pdf.save(`AI_Blueprint_Report_${safeName}.pdf`);
};
