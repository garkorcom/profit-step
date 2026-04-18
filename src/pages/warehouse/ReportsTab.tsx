/**
 * Reports tab — low-stock reorder (UC6) + dead stock (UC8).
 *
 * Both endpoints compute on demand (no caching) — fine while catalog
 * and ledger stay small. When they grow, add scheduled cron that
 * stores precomputed report in Firestore + read that here.
 */

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import toast from 'react-hot-toast';
import {
  getDeadStockReport,
  getLowStockReport,
  type DeadStockReport,
  type LowStockReorderReport,
} from '../../api/warehouseApi';

const SUGGESTION_LABEL: Record<'return_to_vendor' | 'clearance' | 'write_off', { label: string; color: 'primary' | 'warning' | 'error' }> = {
  return_to_vendor: { label: 'Вернуть', color: 'primary' },
  clearance: { label: 'Clearance', color: 'warning' },
  write_off: { label: 'Списать', color: 'error' },
};

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))];
  const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsTab({ search: _search }: { search: string }) {
  const [tab, setTab] = useState<'low_stock' | 'dead_stock'>('low_stock');

  const [lowLoading, setLowLoading] = useState(false);
  const [lowReport, setLowReport] = useState<LowStockReorderReport | null>(null);

  const [deadLoading, setDeadLoading] = useState(false);
  const [deadReport, setDeadReport] = useState<DeadStockReport | null>(null);
  const [thresholdDays, setThresholdDays] = useState(90);

  async function loadLow() {
    setLowLoading(true);
    try {
      setLowReport(await getLowStockReport());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить отчёт');
    } finally {
      setLowLoading(false);
    }
  }

  async function loadDead() {
    setDeadLoading(true);
    try {
      setDeadReport(await getDeadStockReport(thresholdDays));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить отчёт');
    } finally {
      setDeadLoading(false);
    }
  }

  function exportLow() {
    if (!lowReport) return;
    downloadCsv(
      `low-stock-${new Date().toISOString().slice(0, 10)}.csv`,
      lowReport.lines.map((l) => ({
        itemId: l.itemId,
        item: l.itemName,
        baseUOM: l.baseUOM,
        available: l.totalAvailable,
        minStock: l.minStock,
        qtyToOrder: l.qtyToOrder,
        unitCost: l.estimatedUnitCost,
        total: l.estimatedTotalCost,
        vendor: l.preferredVendorName ?? '',
      })),
    );
  }

  function exportDead() {
    if (!deadReport) return;
    downloadCsv(
      `dead-stock-${new Date().toISOString().slice(0, 10)}.csv`,
      deadReport.lines.map((l) => ({
        itemId: l.itemId,
        item: l.itemName,
        category: l.category,
        onHand: l.totalOnHand,
        value: l.totalValue,
        daysInactive: Number.isFinite(l.daysSinceLastActivity) ? l.daysSinceLastActivity : 'never',
        suggestion: l.suggestion,
      })),
    );
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ px: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab value="low_stock" label="📉 Low stock (UC6)" />
          <Tab value="dead_stock" label="🪦 Dead stock (UC8)" />
        </Tabs>
      </Paper>

      {tab === 'low_stock' && (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button variant="contained" startIcon={<RefreshIcon />} onClick={loadLow} disabled={lowLoading}>
              {lowLoading ? 'Строим отчёт…' : 'Построить отчёт'}
            </Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportLow} disabled={!lowReport}>
              CSV
            </Button>
            {lowReport && (
              <Typography variant="body2" color="text.secondary">
                Сгенерирован: {new Date(lowReport.generatedAt).toLocaleString('ru-RU')} · позиций:{' '}
                <strong>{lowReport.lines.length}</strong> · итого{' '}
                <strong>${lowReport.grandTotalEstimated.toFixed(2)}</strong>
              </Typography>
            )}
          </Stack>

          {lowLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : !lowReport ? (
            <Alert severity="info">Нажмите «Построить отчёт» — сканирует каталог и сравнивает с minStock.</Alert>
          ) : lowReport.lines.length === 0 ? (
            <Alert severity="success">Все товары выше minStock. 🎉</Alert>
          ) : (
            lowReport.byVendor.map((vendor) => (
              <Paper variant="outlined" key={vendor.vendorId ?? '_no_vendor'}>
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="subtitle1" fontWeight={600}>
                      {vendor.vendorName ?? 'Без привязки к поставщику'}
                    </Typography>
                    <Typography variant="body2">
                      Subtotal: <strong>${vendor.subtotal.toFixed(2)}</strong>
                    </Typography>
                  </Stack>
                </Box>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Товар</TableCell>
                        <TableCell align="right">Доступно</TableCell>
                        <TableCell align="right">Min</TableCell>
                        <TableCell align="right">Заказать</TableCell>
                        <TableCell align="right">Цена</TableCell>
                        <TableCell align="right">Итого</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {vendor.lines.map((l) => (
                        <TableRow key={l.itemId}>
                          <TableCell>{l.itemName}</TableCell>
                          <TableCell align="right">
                            {l.totalAvailable} {l.baseUOM}
                          </TableCell>
                          <TableCell align="right">{l.minStock}</TableCell>
                          <TableCell align="right">
                            <Chip size="small" color="warning" label={`${l.qtyToOrder} ${l.baseUOM}`} />
                          </TableCell>
                          <TableCell align="right">${l.estimatedUnitCost.toFixed(2)}</TableCell>
                          <TableCell align="right">${l.estimatedTotalCost.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            ))
          )}
        </Stack>
      )}

      {tab === 'dead_stock' && (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              label="Порог дней без движений"
              type="number"
              value={thresholdDays}
              onChange={(e) => setThresholdDays(Math.max(1, Math.min(365, Number(e.target.value) || 90)))}
              sx={{ width: 220 }}
            />
            <Button variant="contained" startIcon={<RefreshIcon />} onClick={loadDead} disabled={deadLoading}>
              {deadLoading ? 'Строим…' : 'Построить отчёт'}
            </Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportDead} disabled={!deadReport}>
              CSV
            </Button>
            {deadReport && (
              <Typography variant="body2" color="text.secondary">
                {deadReport.totalItems} позиций · ${deadReport.totalValue.toFixed(2)}
              </Typography>
            )}
          </Stack>

          {deadLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : !deadReport ? (
            <Alert severity="info">
              Нажмите «Построить отчёт» — найдёт позиции без движений &gt; {thresholdDays} дней.
            </Alert>
          ) : deadReport.lines.length === 0 ? (
            <Alert severity="success">Нет мёртвого запаса по порогу {deadReport.thresholdDays} дней. 🎉</Alert>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Товар</TableCell>
                    <TableCell>Категория</TableCell>
                    <TableCell align="right">On hand</TableCell>
                    <TableCell align="right">Стоимость</TableCell>
                    <TableCell align="right">Дней без движений</TableCell>
                    <TableCell>Рекомендация</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deadReport.lines.map((l) => {
                    const suggestion = SUGGESTION_LABEL[l.suggestion];
                    return (
                      <TableRow key={l.itemId}>
                        <TableCell>{l.itemName}</TableCell>
                        <TableCell>{l.category}</TableCell>
                        <TableCell align="right">{l.totalOnHand}</TableCell>
                        <TableCell align="right">${l.totalValue.toFixed(2)}</TableCell>
                        <TableCell align="right">
                          {Number.isFinite(l.daysSinceLastActivity) ? l.daysSinceLastActivity : '∞'}
                        </TableCell>
                        <TableCell>
                          <Chip size="small" color={suggestion.color} label={suggestion.label} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      )}
    </Stack>
  );
}
