/**
 * CSV bulk import for items (SPEC §11).
 *
 * Accepts CSV with columns:
 *   sku,name,category,baseUOM,lastPurchasePrice,minStock,reorderPoint,notes
 * Parses client-side (no dependency on papaparse — small hand-rolled parser
 * covers our "flat tabular data" case including quoted fields).
 * Each row → CreateItemPayload with reasonable defaults
 * (purchaseUOMs=[{uom: baseUOM, factor: 1, isDefault: true}]).
 * Submits all valid rows in one bulk POST; shows per-row status on completion.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import toast from 'react-hot-toast';
import {
  bulkCreateItems,
  type BulkCreateItemsResult,
  type CreateItemPayload,
  type WhCategoryClient,
} from '../../api/warehouseApi';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  categories: WhCategoryClient[];
}

interface ParsedRow {
  row: number;
  raw: Record<string, string>;
  payload?: CreateItemPayload;
  error?: string;
}

// Minimal RFC-4180-ish CSV parser (single-line values only).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === ',') {
          out.push(cur);
          cur = '';
        } else if (ch === '"' && cur === '') {
          inQuotes = true;
        } else {
          cur += ch;
        }
      }
    }
    out.push(cur);
    rows.push(out.map((c) => c.trim()));
  }
  return rows;
}

function buildPayload(raw: Record<string, string>, rowNum: number): ParsedRow {
  const sku = (raw.sku ?? '').toUpperCase();
  const name = raw.name ?? '';
  const category = raw.category ?? '';
  const baseUOM = raw.baseuom || raw.base_uom || raw.baseUom || 'each';
  const lastPurchasePrice = Number(raw.lastpurchaseprice ?? raw.price ?? 0);
  const averageCost = Number(raw.averagecost ?? raw.avg_cost ?? lastPurchasePrice);

  if (!sku) return { row: rowNum, raw, error: 'SKU обязателен' };
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(sku)) return { row: rowNum, raw, error: 'SKU: UPPERCASE A-Z0-9-_' };
  if (!name) return { row: rowNum, raw, error: 'name обязателен' };
  if (!category) return { row: rowNum, raw, error: 'category обязательна' };

  const payload: CreateItemPayload = {
    sku,
    name,
    category,
    baseUOM,
    purchaseUOMs: [{ uom: baseUOM, factor: 1, isDefault: true }],
    allowedIssueUOMs: [baseUOM],
    lastPurchasePrice: Number.isFinite(lastPurchasePrice) ? lastPurchasePrice : 0,
    averageCost: Number.isFinite(averageCost) ? averageCost : 0,
  };
  const minStock = Number(raw.minstock ?? raw.min_stock);
  if (Number.isFinite(minStock) && minStock > 0) payload.minStock = minStock;
  const reorderPoint = Number(raw.reorderpoint ?? raw.reorder_point);
  if (Number.isFinite(reorderPoint) && reorderPoint > 0) payload.reorderPoint = reorderPoint;
  if (raw.notes) payload.notes = raw.notes;

  return { row: rowNum, raw, payload };
}

export default function ItemsBulkImportDialog({ open, onClose, onSaved, categories }: Props) {
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkCreateItemsResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const categorySlugs = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);

  function resetState() {
    setParsedRows([]);
    setFileName('');
    setResult(null);
  }

  function handleClose() {
    if (submitting) return;
    resetState();
    onClose();
  }

  async function handleFile(file: File) {
    setResult(null);
    setFileName(file.name);
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) {
      setParsedRows([]);
      toast.error('CSV должен содержать header + минимум 1 строку');
      return;
    }
    const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const parsed: ParsedRow[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h] = r[idx] ?? '';
      });
      const row = buildPayload(obj, i);
      // Category warning (not a hard error)
      if (row.payload && !categorySlugs.has(row.payload.category) && categorySlugs.size > 0) {
        row.error = `Неизвестная категория ${row.payload.category}`;
        row.payload = undefined;
      }
      parsed.push(row);
    }
    setParsedRows(parsed);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  async function handleSubmit() {
    const valid = parsedRows.filter((r) => r.payload).map((r) => r.payload!);
    if (valid.length === 0) {
      toast.error('Нет валидных строк для импорта');
      return;
    }
    setSubmitting(true);
    try {
      const res = await bulkCreateItems(valid);
      setResult(res);
      if (res.created.length > 0) toast.success(`✅ Создано ${res.created.length} товаров`);
      if (res.skipped.length > 0) toast(`${res.skipped.length} пропущено (дубликаты)`);
      if (res.errors.length > 0) toast.error(`${res.errors.length} ошибок валидации`);
      onSaved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Не удалось импортировать');
    } finally {
      setSubmitting(false);
    }
  }

  const validCount = parsedRows.filter((r) => r.payload).length;
  const errorCount = parsedRows.length - validCount;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>📤 Bulk import: товары из CSV</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            Колонки: <code>sku,name,category,baseUOM,lastPurchasePrice,minStock,reorderPoint,notes</code>.<br />
            Первая строка — header. Пустые ячейки игнорируются. Для каждого товара создаётся одна purchaseUOM
            (= baseUOM, factor=1).
          </Alert>

          <Stack direction="row" spacing={2} alignItems="center">
            <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => inputRef.current?.click()}>
              Выбрать CSV
            </Button>
            <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={handleInputChange} />
            {fileName && (
              <Typography variant="body2" color="text.secondary">
                {fileName} · <strong>{parsedRows.length}</strong> строк ·{' '}
                <Chip size="small" color="success" label={`${validCount} ok`} /> ·{' '}
                {errorCount > 0 && <Chip size="small" color="error" label={`${errorCount} ошибок`} />}
              </Typography>
            )}
          </Stack>

          {parsedRows.length > 0 && !result && (
            <Paper variant="outlined" sx={{ maxHeight: 360, overflow: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell width={60}>#</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell>Название</TableCell>
                    <TableCell>Категория</TableCell>
                    <TableCell>UOM</TableCell>
                    <TableCell align="right">Price</TableCell>
                    <TableCell>Статус</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {parsedRows.slice(0, 100).map((r) => (
                    <TableRow key={r.row} hover>
                      <TableCell>{r.row}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.raw.sku ?? ''}</TableCell>
                      <TableCell>{r.raw.name ?? ''}</TableCell>
                      <TableCell>{r.raw.category ?? ''}</TableCell>
                      <TableCell>{r.payload?.baseUOM ?? ''}</TableCell>
                      <TableCell align="right">{r.payload?.lastPurchasePrice ?? '—'}</TableCell>
                      <TableCell>
                        {r.payload ? (
                          <Chip size="small" color="success" label="ok" variant="outlined" />
                        ) : (
                          <Chip size="small" color="error" label={r.error ?? 'error'} variant="outlined" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {parsedRows.length > 100 && (
                    <TableRow>
                      <TableCell colSpan={7} sx={{ color: 'text.secondary' }}>
                        ... и ещё {parsedRows.length - 100} строк
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          )}

          {result && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Результат импорта
              </Typography>
              <Stack direction="row" spacing={1}>
                <Chip color="success" label={`Создано: ${result.created.length}`} />
                <Chip color="warning" label={`Пропущено (дубли): ${result.skipped.length}`} />
                <Chip color="error" label={`Ошибки валидации: ${result.errors.length}`} />
              </Stack>
              {result.errors.length > 0 && (
                <Box sx={{ mt: 2, maxHeight: 240, overflow: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>SKU</TableCell>
                        <TableCell>Ошибка</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {result.errors.map((e, i) => (
                        <TableRow key={i}>
                          <TableCell>{e.index + 1}</TableCell>
                          <TableCell>{e.sku ?? '—'}</TableCell>
                          <TableCell>{e.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Paper>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          Закрыть
        </Button>
        {!result && (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting || validCount === 0}
            startIcon={submitting ? <CircularProgress size={18} /> : undefined}
          >
            {submitting ? 'Импорт…' : `Импортировать ${validCount} шт.`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
