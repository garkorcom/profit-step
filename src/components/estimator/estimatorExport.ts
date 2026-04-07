/**
 * @fileoverview PDF / Excel / TXT export utilities for the Electrical Estimator.
 * Extracted from ElectricalEstimatorPage to reduce bundle coupling.
 * @module components/estimator/estimatorExport
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { DEVICES, WIRE } from '../../constants/electricalDevices';
import { ProjectOverview } from '../../utils/estimateValidation';
import {
  ElectricalItem, QuantityMap, EstimatorCalcResult,
  EQUIPMENT_SBO, fmt, fmtHr,
} from './estimator.types';
import type { BlueprintV3Session } from '../../types/blueprint.types';

// ─── Helpers ──────────────────────────────────────────────

const stringToColor = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
};

// ─── PDF Export ────────────────────────────────────────────

interface PdfExportParams {
  projectName: string;
  projectType: string;
  sqft: number;
  stories: number;
  overheadPct: number;
  profitPct: number;
  overview: ProjectOverview;
  calc: EstimatorCalcResult;
  notes: string;
  quantities: QuantityMap;
  wireQty: QuantityMap;
  gearData: ElectricalItem[];
  poolData: ElectricalItem[];
  genData: ElectricalItem[];
  landData: ElectricalItem[];
  gearQty: QuantityMap;
  poolQty: QuantityMap;
  genQty: QuantityMap;
  landQty: QuantityMap;
  equipmentPrices: QuantityMap;
  activeV3Sessions: BlueprintV3Session[];
  label?: string;
  aiQtyMap?: QuantityMap;
}

export async function generateEstimatePDF(params: PdfExportParams): Promise<void> {
  const {
    projectName, projectType, sqft, stories, overheadPct, profitPct,
    overview, calc, notes, quantities, wireQty,
    gearData, poolData, genData, landData,
    gearQty, poolQty, genQty, landQty,
    equipmentPrices, activeV3Sessions, label, aiQtyMap,
  } = params;

  const pdf = new jsPDF();

  // Header
  pdf.setFontSize(18);
  const title = label ? `ELECTRICAL ESTIMATE - ${label}` : 'ELECTRICAL ESTIMATE';
  pdf.text(title, 14, 20);
  pdf.setFontSize(10);
  pdf.setTextColor(100);
  pdf.text(`Project: ${projectName} | ${projectType} | ${sqft} sq ft | ${stories} story`, 14, 28);
  pdf.text(`Date: ${new Date().toLocaleDateString()} | Overhead: ${overheadPct}% | Profit: ${profitPct}%`, 14, 34);

  // PROJECT OVERVIEW
  const ovBgColor: [number, number, number] = overview.hasWarnings ? [255, 243, 224] : [232, 245, 233];
  pdf.setFillColor(...ovBgColor);
  pdf.roundedRect(14, 38, 182, 28, 2, 2, 'F');
  pdf.setFontSize(9);
  pdf.setTextColor(33, 33, 33);
  pdf.text('📋 PROJECT OVERVIEW', 18, 44);
  pdf.setFontSize(8);
  pdf.setTextColor(80);
  pdf.text(`Area: ${overview.areaSqft > 0 ? overview.areaSqft.toLocaleString() + ' sq ft' : '—'}   |   Devices: ${overview.totalDevices.toLocaleString()}   |   BOM Cost: ${fmt(overview.totalBomCost)}`, 18, 50);
  const costStatus = overview.costValidation.status === 'ok' ? '✓' : '⚠';
  const roomStatus = overview.roomValidation.status === 'ok' ? '✓' : '⚠';
  pdf.text(`Cost/sq.ft: $${overview.costValidation.costPerSqft.toFixed(2)} ${costStatus}   |   Files: ${overview.roomCount} ${roomStatus}`, 18, 56);
  if (overview.hasWarnings) {
    pdf.setTextColor(211, 84, 0);
    pdf.setFontSize(7);
    let warnY = 62;
    if (overview.costValidation.status !== 'ok') {
      pdf.text(overview.costValidation.message, 18, warnY);
      warnY += 4;
    }
    if (overview.roomValidation.status !== 'ok') {
      pdf.text(overview.roomValidation.message, 18, warnY);
    }
  }

  const getCustomQty = aiQtyMap ? (id: string) => aiQtyMap[id] || 0 : null;
  let startY = overview.hasWarnings ? 72 : 68;

  // Sections
  const sections: { name: string; items: ElectricalItem[]; qtyMap: QuantityMap }[] = [
    ...Object.entries(DEVICES).map(([key, items]) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      items: items as ElectricalItem[],
      qtyMap: getCustomQty ? (aiQtyMap as QuantityMap) : quantities,
    })),
    { name: 'Wire & Conduit', items: WIRE as ElectricalItem[], qtyMap: getCustomQty ? (aiQtyMap as QuantityMap) : wireQty },
    { name: 'Panels & Gear', items: gearData, qtyMap: getCustomQty ? (aiQtyMap as QuantityMap) : gearQty },
    { name: 'Pool & Spa', items: poolData, qtyMap: getCustomQty ? (aiQtyMap as QuantityMap) : poolQty },
    { name: 'Generator', items: genData, qtyMap: getCustomQty ? (aiQtyMap as QuantityMap) : genQty },
    { name: 'Landscape', items: landData, qtyMap: getCustomQty ? (aiQtyMap as QuantityMap) : landQty },
  ];

  sections.forEach(sec => {
    const rows = sec.items
      .filter(item => (getCustomQty ? getCustomQty(item.id) : (sec.qtyMap[item.id] || 0)) > 0)
      .map(item => {
        const qty = getCustomQty ? getCustomQty(item.id) : (sec.qtyMap[item.id] || 0);
        return [
          item.name,
          `$${item.matRate}`,
          `${item.laborRate}h`,
          qty.toString(),
          `$${(qty * item.matRate).toFixed(2)}`,
        ];
      });
    if (rows.length === 0) return;

    pdf.setFontSize(11);
    pdf.setTextColor(33, 33, 33);
    pdf.text(sec.name.toUpperCase(), 14, startY);
    startY += 2;
    autoTable(pdf, {
      startY,
      head: [['Item', 'Mat $', 'Labor Hr', 'Qty', 'Mat Total']],
      body: rows,
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [25, 118, 210] },
      margin: { left: 14, right: 14 },
      theme: 'grid',
    });
    startY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    if (startY > 260) { pdf.addPage(); startY = 20; }
  });

  // Equipment S.B.O.
  const eqRows = EQUIPMENT_SBO
    .filter(eq => (equipmentPrices[eq.id] || 0) > 0)
    .map(eq => {
      const price = equipmentPrices[eq.id] || 0;
      return [eq.name, '', '', '1', `$${price.toFixed(2)}`];
    });
  if (eqRows.length > 0) {
    if (startY > 250) { pdf.addPage(); startY = 20; }
    pdf.setFontSize(11);
    pdf.setTextColor(33, 33, 33);
    pdf.text('EQUIPMENT (S.B.O.)', 14, startY);
    startY += 2;
    autoTable(pdf, {
      startY,
      head: [['Item', '', '', '', 'Price']],
      body: eqRows,
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [76, 175, 80] },
      margin: { left: 14, right: 14 },
      theme: 'grid',
    });
    startY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // Summary
  if (startY > 220) { pdf.addPage(); startY = 20; }
  pdf.setFontSize(12);
  pdf.setTextColor(33, 33, 33);
  pdf.text('SUMMARY', 14, startY);
  startY += 4;
  autoTable(pdf, {
    startY,
    body: [
      ['Materials (Base)', fmt(calc.materialsBase)],
      ['Materials (+18%)', fmt(calc.materialsFinal)],
      [`Labor (${fmtHr(calc.totalHrs)})`, fmt(calc.laborCost)],
      ['Mat + Labor', fmt(calc.matLaborCost)],
      [`Overhead (${overheadPct}%)`, fmt(calc.overhead)],
      [`Profit (${profitPct}%)`, fmt(calc.profit)],
      ['Sales Tax', fmt(calc.salesTaxMat)],
      ['BASE PRICE', fmt(calc.basePrice)],
      ['', ''],
      ['Equipment (Net)', fmt(calc.eqNet)],
      ['Equipment (Tax+Markup)', fmt(calc.eqTax + calc.eqMarkup)],
      ['Equipment Total', fmt(calc.eqTotal)],
      ['', ''],
      ['TOTAL PRICE', fmt(calc.totalPrice)],
      ['Cost per sq ft', fmt(calc.totalPrice / sqft)],
    ],
    styles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold' } },
    theme: 'plain',
    margin: { left: 14 },
  });

  if (notes) {
    const notesY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    pdf.setFontSize(9);
    pdf.text(`Notes: ${notes}`, 14, notesY);
  }

  // V3 Visual Proof Appendix
  const sessionToPrint = activeV3Sessions[0];
  if (sessionToPrint?.v3Results && sessionToPrint?.images) {
    const selectedImages = sessionToPrint.images.filter((i: { selected?: boolean }) => i.selected);
    if (selectedImages.length > 0) {
      pdf.addPage();
      pdf.setFontSize(16);
      pdf.setTextColor(33, 33, 33);
      pdf.text('APPENDIX: AI VISUAL PROOF', 14, 20);
      pdf.setFontSize(10);
      pdf.text('The following floor plans indicate the exact locations of detected items.', 14, 28);

      for (const imgData of selectedImages) {
        if (!imgData.storageUrl) continue;
        const pageResults = sessionToPrint.v3Results[imgData.id];
        if (!pageResults) continue;

        pdf.addPage();
        pdf.setFontSize(12);
        pdf.text(`Page: ${imgData.originalFileName || imgData.pageNumber}`, 14, 15);

        try {
          const imgBlob = await fetch(imgData.storageUrl).then(r => r.blob());
          const imgDataUrl = await new Promise<string>(res => {
            const reader = new FileReader();
            reader.onload = e => res(e.target!.result as string);
            reader.readAsDataURL(imgBlob);
          });

          const imgWidth = imgData.dimensions?.width || 1000;
          const imgHeight = imgData.dimensions?.height || 1000;
          const pdfW = 190;
          const pdfH = 260;
          const ratio = Math.min(pdfW / imgWidth, pdfH / imgHeight);
          const printW = imgWidth * ratio;
          const printH = imgHeight * ratio;
          const printX = (210 - printW) / 2;
          const printY = 25;

          pdf.addImage(imgDataUrl, 'PNG', printX, printY, printW, printH);

          // Draw bounding boxes
          pdf.setLineWidth(0.5);
          Object.entries(pageResults).forEach(([itemType, boxes]) => {
            const colorHex = stringToColor(itemType);
            const [r, g, b] = hexToRgb(colorHex);
            pdf.setDrawColor(r, g, b);

            (boxes as Array<number[] | { box?: number[]; confidence?: number }>).forEach((item) => {
              const boxArr = Array.isArray(item) ? item : item?.box;
              if (!boxArr) return;
              const [ymin, xmin, ymax, xmax] = boxArr;
              const bx = printX + (xmin / 1000) * printW;
              const by = printY + (ymin / 1000) * printH;
              const bw = ((xmax - xmin) / 1000) * printW;
              const bh = ((ymax - ymin) / 1000) * printH;
              pdf.rect(bx, by, bw, bh);
            });
          });
        } catch (e) {
          console.error('Failed to append visual proof page:', e);
          pdf.setFontSize(10);
          pdf.setTextColor(255, 0, 0);
          pdf.text('Failed to load image for visual proof', 14, 30);
        }
      }
    }
  }

  const pdfBlobUrl = pdf.output('bloburl');
  window.open(pdfBlobUrl.toString(), '_blank');
  const safeName = projectName.replace(/\s+/g, '_');
  const suffix = label ? `_${label.replace(/\s+/g, '_')}` : '';
  pdf.save(`${safeName}_Estimate${suffix}.pdf`);
}

// ─── Excel Export ──────────────────────────────────────────

interface ExcelExportParams {
  projectName: string;
  projectType: string;
  sqft: number;
  stories: number;
  overheadPct: number;
  profitPct: number;
  laborRate: number;
  overview: ProjectOverview;
  calc: EstimatorCalcResult;
  notes: string;
  quantities: QuantityMap;
  wireQty: QuantityMap;
  gearData: ElectricalItem[];
  poolData: ElectricalItem[];
  genData: ElectricalItem[];
  landData: ElectricalItem[];
  gearQty: QuantityMap;
  poolQty: QuantityMap;
  genQty: QuantityMap;
  landQty: QuantityMap;
  equipmentPrices: QuantityMap;
}

export function generateExcelExport(params: ExcelExportParams): void {
  const {
    projectName, projectType, sqft, stories, overheadPct, profitPct, laborRate,
    overview, calc, notes, quantities, wireQty,
    gearData, poolData, genData, landData,
    gearQty, poolQty, genQty, landQty,
    equipmentPrices,
  } = params;

  const wb = XLSX.utils.book_new();

  const allSections: { name: string; items: ElectricalItem[]; qtyMap: QuantityMap }[] = [
    ...Object.entries(DEVICES).map(([key, items]) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      items: items as ElectricalItem[],
      qtyMap: quantities,
    })),
    { name: 'Wire & Conduit', items: WIRE as ElectricalItem[], qtyMap: wireQty },
    { name: 'Panels & Gear', items: gearData, qtyMap: gearQty },
    { name: 'Pool & Spa', items: poolData, qtyMap: poolQty },
    { name: 'Generator', items: genData, qtyMap: genQty },
    { name: 'Landscape', items: landData, qtyMap: landQty },
  ];

  // Sheet 1: All Items
  const itemsData: (string | number)[][] = [
    ['ELECTRICAL ESTIMATE'],
    [`Project: ${projectName} | ${projectType} | ${sqft} sq ft | ${stories} story`],
    [`Date: ${new Date().toLocaleDateString()} | Overhead: ${overheadPct}% | Profit: ${profitPct}%`],
    [],
    ['Section', 'Item', 'Material $', 'Labor Hr', 'Qty', 'Mat Total $', 'Labor Total Hr'],
  ];
  allSections.forEach(sec => {
    sec.items.forEach(item => {
      const qty = sec.qtyMap[item.id] || 0;
      if (qty > 0) {
        itemsData.push([
          sec.name, item.name, item.matRate, item.laborRate,
          qty, qty * item.matRate, +(qty * item.laborRate).toFixed(2),
        ]);
      }
    });
  });
  const wsItems = XLSX.utils.aoa_to_sheet(itemsData);
  wsItems['!cols'] = [
    { wch: 18 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsItems, 'Estimate');

  // Sheet 2: Equipment S.B.O.
  const eqData: (string | number)[][] = [
    ['EQUIPMENT (S.B.O.)'],
    [],
    ['Item', 'Default Price', 'Actual Price'],
  ];
  EQUIPMENT_SBO.forEach(eq => {
    const price = equipmentPrices[eq.id] || 0;
    eqData.push([eq.name, eq.defaultPrice, price]);
  });
  eqData.push([]);
  eqData.push(['Equipment Net', '', calc.eqNet]);
  eqData.push(['Tax + Markup', '', calc.eqTax + calc.eqMarkup]);
  eqData.push(['Equipment Total', '', calc.eqTotal]);
  const wsEq = XLSX.utils.aoa_to_sheet(eqData);
  wsEq['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsEq, 'Equipment');

  // Sheet 3: Summary
  const summaryData: (string | number)[][] = [
    ['📋 PROJECT OVERVIEW'],
    ['Area (sq ft)', overview.areaSqft > 0 ? overview.areaSqft : 0],
    ['Total Devices', overview.totalDevices],
    ['BOM Cost (Base Materials)', overview.totalBomCost],
    ['Cost/sq.ft', overview.costValidation.costPerSqft > 0 ? `$${overview.costValidation.costPerSqft.toFixed(2)}` : '—'],
    ['Cost Validation', overview.costValidation.status === 'ok' ? 'Normal range' : 'WARNING — check estimate'],
    ['Files/Rooms', overview.roomCount],
    ['Room Validation', overview.roomValidation.status === 'ok' ? 'Normal' : 'WARNING — possible duplication'],
    [],
    ['SUMMARY'],
    [],
    ['Parameter', 'Value'],
    ['Project Name', projectName],
    ['Project Type', projectType],
    ['Area (sq ft)', sqft],
    ['Stories', stories],
    ['Labor Rate ($/hr)', laborRate],
    [],
    ['Materials (Base)', calc.materialsBase],
    ['Materials (+18%)', calc.materialsFinal],
    ['Sales Tax (7%)', calc.salesTaxMat],
    ['Total Labor Hours', +calc.totalHrs.toFixed(1)],
    ['Labor Cost', calc.laborCost],
    ['Mat + Labor', calc.matLaborCost],
    [`Overhead (${overheadPct}%)`, calc.overhead],
    [`Profit (${profitPct}%)`, calc.profit],
    ['BASE PRICE', calc.basePrice],
    [],
    ['Equipment Net', calc.eqNet],
    ['Equipment Tax+Markup', calc.eqTax + calc.eqMarkup],
    ['Equipment Total', calc.eqTotal],
    [],
    ['TOTAL PRICE', calc.totalPrice],
    ['Cost per sq ft', +(calc.totalPrice / sqft).toFixed(2)],
    [],
    ['Notes', notes || ''],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 22 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  XLSX.writeFile(wb, `${projectName.replace(/\s+/g, '_')}_Estimate.xlsx`);
}

// ─── Text Export ───────────────────────────────────────────

interface TextExportParams {
  projectName: string;
  projectType: string;
  sqft: number;
  stories: number;
  overheadPct: number;
  profitPct: number;
  overview: ProjectOverview;
  calc: EstimatorCalcResult;
  notes: string;
}

export function generatePrintContent(params: TextExportParams): string {
  const { projectName, projectType, sqft, stories, overheadPct, profitPct, overview, calc, notes } = params;
  const date = new Date().toLocaleDateString();
  const costTag = overview.costValidation.status === 'ok' ? 'Normal' : 'WARNING';
  const roomTag = overview.roomValidation.status === 'ok' ? 'Normal' : 'WARNING';
  return `
ELECTRICAL ESTIMATE
==========================================
Project: ${projectName}
Date: ${date}
Type: ${projectType === 'commercial' ? 'Commercial' : 'Residential'}
Size: ${sqft} sq ft | ${stories} story

📋 PROJECT OVERVIEW
• Area: ${overview.areaSqft > 0 ? overview.areaSqft.toLocaleString() : '—'} sq ft
• Devices: ${overview.totalDevices.toLocaleString()}
• BOM Cost: ${fmt(overview.totalBomCost)}
• Cost/sq.ft: $${overview.costValidation.costPerSqft.toFixed(2)} [${costTag}]
• Room validation: ${overview.roomCount} files [${roomTag}]
──────────────────

SUMMARY
------------------------------------------
Materials (Base):     ${fmt(calc.materialsBase)}
Materials (+18%):     ${fmt(calc.materialsFinal)}
Labor (${fmtHr(calc.totalHrs)}):   ${fmt(calc.laborCost)}
------------------------------------------
Mat + Labor:          ${fmt(calc.matLaborCost)}
Overhead (${overheadPct}%):        ${fmt(calc.overhead)}
Profit (${profitPct}%):          ${fmt(calc.profit)}
Sales Tax:            ${fmt(calc.salesTaxMat)}
------------------------------------------
BASE PRICE:           ${fmt(calc.basePrice)}

EQUIPMENT (S.B.O.)
------------------------------------------
Net:                  ${fmt(calc.eqNet)}
Tax + Markup:         ${fmt(calc.eqTax + calc.eqMarkup)}
Equipment Total:      ${fmt(calc.eqTotal)}

==========================================
TOTAL PRICE:          ${fmt(calc.totalPrice)}
==========================================
Cost per sq ft:       ${fmt(calc.totalPrice / sqft)}

Notes: ${notes || 'N/A'}
    `;
}
