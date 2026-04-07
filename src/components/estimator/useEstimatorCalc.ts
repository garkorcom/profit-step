/**
 * @fileoverview useEstimatorCalc — Pure calculation engine for electrical estimates.
 * Extracted from ElectricalEstimatorPage's `calc` useMemo block.
 * @module components/estimator/useEstimatorCalc
 */

import { useMemo } from 'react';
import { DEVICES, WIRE } from '../../constants/electricalDevices';
import { ElectricalItem, QuantityMap, WireRate, EstimatorCalcResult } from './estimator.types';

interface CalcInputs {
  devicesData: typeof DEVICES;
  gearData: ElectricalItem[];
  poolData: ElectricalItem[];
  genData: ElectricalItem[];
  landData: ElectricalItem[];
  quantities: QuantityMap;
  gearQty: QuantityMap;
  poolQty: QuantityMap;
  genQty: QuantityMap;
  landQty: QuantityMap;
  wireQty: QuantityMap;
  equipmentPrices: QuantityMap;
  laborRate: number;
  overheadPct: number;
  profitPct: number;
  storyMult: number;
  typeMult: number;
  wireRatesData: Record<string, WireRate>;
}

export function useEstimatorCalc(inputs: CalcInputs): EstimatorCalcResult {
  const {
    devicesData, gearData, poolData, genData, landData,
    quantities, gearQty, poolQty, genQty, landQty, wireQty, equipmentPrices,
    laborRate, overheadPct, profitPct, storyMult, typeMult, wireRatesData,
  } = inputs;

  return useMemo(() => {
    let devicesMat = 0, devicesLabor = 0;
    const wireByType: Record<string, number> = {};

    const processItems = (items: ElectricalItem[], qtyMap: QuantityMap, addWire = true) => {
      let mat = 0, labor = 0;
      items.forEach(item => {
        const qty = qtyMap[item.id] || 0;
        if (qty > 0) {
          mat += qty * (item.matRate || 0);
          labor += qty * (item.laborRate || 0);
          if (addWire && item.wireType && (item.wireLen || 0) > 0) {
            const adjLen = (item.wireLen || 0) * storyMult;
            wireByType[item.wireType] = (wireByType[item.wireType] || 0) + qty * adjLen;
          }
        }
      });
      return { mat, labor };
    };

    const devRes = processItems(Object.values(devicesData).flat() as ElectricalItem[], quantities);
    devicesMat = devRes.mat; devicesLabor = devRes.labor;

    const gearRes = processItems(gearData, gearQty, false);
    const poolRes = processItems(poolData, poolQty);
    const genRes = processItems(genData, genQty);
    const landRes = processItems(landData, landQty);
    const wireRes = processItems(WIRE as ElectricalItem[], wireQty, false);

    let wireMat = 0, wireLabor = 0;
    Object.entries(wireByType).forEach(([type, len]) => {
      const w = wireRatesData[type];
      if (w) {
        const withAdd = len * 1.10;
        wireMat += withAdd * w.rate;
        wireLabor += (withAdd / 100) * w.laborPer100;
      }
    });

    const sectionsData: Record<string, { mat: number; labor: number }> = {
      devices: { mat: devicesMat, labor: devicesLabor },
      wire_auto: { mat: wireMat, labor: wireLabor },
      wire_manual: { mat: wireRes.mat, labor: wireRes.labor },
      gear: { mat: gearRes.mat, labor: gearRes.labor },
      pool: { mat: poolRes.mat, labor: poolRes.labor },
      generator: { mat: genRes.mat, labor: genRes.labor },
      landscape: { mat: landRes.mat, labor: landRes.labor },
    };

    const materialsBase = Object.values(sectionsData).reduce((s, x) => s + x.mat, 0);
    const productiveHrs = Object.values(sectionsData).reduce((s, x) => s + x.labor, 0) * typeMult;
    const nonProdHrs = productiveHrs * 0.18;
    const totalHrs = productiveHrs + nonProdHrs;

    const miscMarkup = materialsBase * 0.18;
    const materialsFinal = materialsBase + miscMarkup;
    const salesTaxMat = materialsBase * 0.07;
    const laborCost = totalHrs * laborRate;
    const matLaborCost = materialsFinal + laborCost;
    const overhead = matLaborCost * (overheadPct / 100);
    const profit = matLaborCost * (profitPct / 100);

    let eqNet = 0;
    Object.entries(equipmentPrices).forEach(([, price]) => { eqNet += price || 0; });
    const eqTax = eqNet * 0.07;
    const eqMarkup = eqNet * 0.25;
    const eqTotal = eqNet + eqTax + eqMarkup;

    const basePrice = matLaborCost + overhead + profit + salesTaxMat;
    const totalPrice = basePrice + eqTotal;

    return {
      sectionsData, wireByType, materialsBase, miscMarkup, materialsFinal, salesTaxMat,
      productiveHrs, nonProdHrs, totalHrs, laborCost, matLaborCost, overhead, profit,
      eqNet, eqTax, eqMarkup, eqTotal, basePrice, totalPrice
    };
  }, [quantities, gearQty, poolQty, genQty, landQty, wireQty, equipmentPrices, laborRate, overheadPct, profitPct, storyMult, typeMult, devicesData, gearData, poolData, genData, landData, wireRatesData]);
}
