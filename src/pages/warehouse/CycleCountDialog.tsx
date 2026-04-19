/**
 * Cycle count (UC7) — dedicated flow for physical inventory.
 *
 * Flow:
 *  1. Pick a location.
 *  2. Snapshot all non-zero balances at that location as `systemQty`.
 *  3. Worker fills countedQty for each item (default = systemQty = zero variance).
 *  4. Submit creates a count document with variance per line.
 *  5. "Сразу провести" applies adjustments atomically.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import toast from 'react-hot-toast';
import {
  createDocument,
  listBalancesByLocation,
  postDocument,
  type WhBalanceClient,
  type WhDocumentLineClient,
  type WhItemClient,
  type WhLocationClient,
} from '../../api/warehouseApi';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  items: WhItemClient[];
  locations: WhLocationClient[];
}

interface CountRow {
  key: string; // `${itemId}`
  itemId: string;
  systemQty: number;
  countedQty: string; // controlled input
  baseUOM: string;
  manual: boolean; // row added by user (not from balances snapshot)
}

export default function CycleCountDialog({ open, onClose, onSaved, items, locations }: Props) {
  const [locationId, setLocationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CountRow[]>([]);
  const [note, setNote] = useState('');
  const [postImmediately, setPostImmediately] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLocationId('');
      setRows([]);
      setNote('');
      setError(null);
      setSaving(false);
      setPostImmediately(true);
    }
  }, [open]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const locationOptions = useMemo(
    () => locations.map((l) => ({ id: l.id, label: `${l.name} · ${l.locationType}` })),
    [locations],
  );

  const itemOptions = useMemo(
    () => items.map((i) => ({ id: i.id, label: `${i.name} · ${i.sku}`, baseUOM: i.baseUOM })),
    [items],
  );

  const varianceSum = useMemo(
    () =>
      rows.reduce((acc, r) => {
        const counted = Number(r.countedQty);
        if (!Number.isFinite(counted)) return acc;
        return acc + (counted - r.systemQty);
      }, 0),
    [rows],
  );
  const rowsWithVariance = useMemo(
    () => rows.filter((r) => Number(r.countedQty) !== r.systemQty),
    [rows],
  );

  async function loadSnapshot(locId: string) {
    setLoading(true);
    setError(null);
    try {
      const balances = await listBalancesByLocation(locId);
      const snap: CountRow[] = balances
        .filter((b: WhBalanceClient) => (b.onHandQty ?? 0) > 0)
        .map((b: WhBalanceClient) => {
          const item = itemById.get(b.itemId);
          return {
            key: b.itemId,
            itemId: b.itemId,
            systemQty: b.onHandQty ?? 0,
            countedQty: String(b.onHandQty ?? 0),
            baseUOM: item?.baseUOM ?? 'each',
            manual: false,
          };
        });
      setRows(snap);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить остатки');
    } finally {
      setLoading(false);
    }
  }

  function handleLocationChange(id: string) {
    setLocationId(id);
    if (id) void loadSnapshot(id);
    else setRows([]);
  }

  function updateRow(key: string, patch: Partial<CountRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  function addManualRow() {
    const newKey = `manual_${Math.random().toString(36).slice(2, 10)}`;
    setRows((rs) => [
      ...rs,
      { key: newKey, itemId: '', systemQty: 0, countedQty: '0', baseUOM: 'each', manual: true },
    ]);
  }

  async function handleSubmit() {
    setError(null);
    if (!locationId) return setError('Выберите локацию');
    if (rows.length === 0) return setError('Нет строк для подсчёта');

    const cleanLines: WhDocumentLineClient[] = [];
    for (const r of rows) {
      if (!r.itemId) continue; // skip placeholder manual rows without item picked
      const counted = Number(r.countedQty);
      if (!Number.isFinite(counted) || counted < 0) {
        return setError(`Некорректное counted qty для ${itemById.get(r.itemId)?.name ?? r.itemId}`);
      }
      cleanLines.push({
        itemId: r.itemId,
        uom: r.baseUOM,
        qty: counted,
        // systemQty and variance go as extra fields on the line; backend Zod
        // schema accepts them (CreateWhDocumentLineSchema).
        // We can't set them via the typed WhDocumentLineClient, so cast:
        ...({ systemQty: r.systemQty, countedQty: counted, variance: counted - r.systemQty } as Record<string, number>),
      });
    }
    if (cleanLines.length === 0) return setError('Добавьте хотя бы одну строку с товаром');

    setSaving(true);
    try {
      const created = await createDocument({
        docType: 'count',
        eventDate: new Date().toISOString().slice(0, 10),
        locationId,
        lines: cleanLines,
        note: note.trim() || undefined,
        source: 'ui',
      });
      if (postImmediately) {
        await postDocument(created.documentId);
        toast.success(`✅ Inventory posted: ${created.docNumber}`);
      } else {
        toast.success(`📝 Draft ${created.docNumber} создан`);
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>⚖️ Инвентаризация (cycle count)</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              1. Локация
            </Typography>
            <Autocomplete
              options={locationOptions}
              getOptionLabel={(o) => o.label}
              value={locationOptions.find((l) => l.id === locationId) ?? null}
              onChange={(_, v) => handleLocationChange(v?.id ?? '')}
              renderInput={(p) => <TextField {...p} label="Локация" required />}
              sx={{ maxWidth: 480 }}
            />
          </Box>

          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="subtitle2">2. Строки пересчёта</Typography>
              {rows.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  Всего: <strong>{rows.length}</strong> · с изменениями:{' '}
                  <strong>{rowsWithVariance.length}</strong> · суммарная variance:{' '}
                  <strong style={{ color: varianceSum < 0 ? '#d32f2f' : varianceSum > 0 ? '#2e7d32' : undefined }}>
                    {varianceSum > 0 ? '+' : ''}
                    {varianceSum}
                  </strong>
                </Typography>
              )}
            </Stack>

            {!locationId ? (
              <Alert severity="info">Выберите локацию — подтянем текущие остатки как starting point.</Alert>
            ) : loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Paper variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Товар</TableCell>
                      <TableCell width={90}>UOM</TableCell>
                      <TableCell width={110} align="right">
                        System
                      </TableCell>
                      <TableCell width={140} align="right">
                        Counted
                      </TableCell>
                      <TableCell width={110} align="right">
                        Δ
                      </TableCell>
                      <TableCell width={50} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((r) => {
                      const counted = Number(r.countedQty);
                      const variance = Number.isFinite(counted) ? counted - r.systemQty : 0;
                      const varianceColor =
                        variance > 0 ? 'success.main' : variance < 0 ? 'error.main' : 'text.secondary';
                      return (
                        <TableRow key={r.key} hover>
                          <TableCell>
                            {r.manual ? (
                              <Autocomplete
                                options={itemOptions}
                                getOptionLabel={(o) => o.label}
                                value={itemOptions.find((o) => o.id === r.itemId) ?? null}
                                onChange={(_, v) =>
                                  updateRow(r.key, {
                                    itemId: v?.id ?? '',
                                    baseUOM: v?.baseUOM ?? 'each',
                                  })
                                }
                                size="small"
                                renderInput={(p) => <TextField {...p} placeholder="Поиск..." />}
                              />
                            ) : (
                              <span>{itemById.get(r.itemId)?.name ?? r.itemId}</span>
                            )}
                          </TableCell>
                          <TableCell>{r.baseUOM}</TableCell>
                          <TableCell align="right">{r.systemQty}</TableCell>
                          <TableCell align="right">
                            <TextField
                              size="small"
                              type="number"
                              value={r.countedQty}
                              onChange={(e) => updateRow(r.key, { countedQty: e.target.value })}
                              inputProps={{ style: { textAlign: 'right' }, min: 0 }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Typography component="span" color={varianceColor} fontWeight={variance !== 0 ? 600 : 400}>
                              {variance > 0 ? '+' : ''}
                              {variance}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <IconButton size="small" onClick={() => removeRow(r.key)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                          Здесь пока нет товаров с остатком &gt; 0.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <Box sx={{ p: 1 }}>
                  <Button size="small" startIcon={<AddIcon />} onClick={addManualRow}>
                    Добавить строку (для товара которого ещё не было)
                  </Button>
                </Box>
              </Paper>
            )}
          </Box>

          <TextField
            label="Комментарий"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            minRows={2}
            inputProps={{ maxLength: 2000 }}
            fullWidth
          />

          <FormControlLabel
            control={<Switch checked={postImmediately} onChange={(e) => setPostImmediately(e.target.checked)} />}
            label={
              <span>
                Сразу провести (post) — применит adjustments{' '}
                <Chip size="small" label={`${rowsWithVariance.length} строк`} sx={{ ml: 1 }} />
              </span>
            }
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={saving || !locationId}
          startIcon={saving ? <CircularProgress size={18} /> : undefined}
        >
          {saving ? 'Обработка…' : postImmediately ? '✅ Провести inventory' : '💾 Создать draft'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
