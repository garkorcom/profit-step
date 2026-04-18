/**
 * Document wizard — create draft for receipt / issue / transfer / count / adjustment.
 * Spec: Improvement 11 §6 + document.schema.ts.
 *
 * Flow: pick type → fill context → add lines → submit. Single-page form
 * for MVP (spec-mentioned 4-step wizard kept logically as sections).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
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
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import toast from 'react-hot-toast';
import {
  createDocument,
  postDocument,
  type CreateDocumentPayload,
  type DocType,
  type IssueReason,
  type WhDocumentLineClient,
  type WhItemClient,
  type WhLocationClient,
} from '../../api/warehouseApi';

const DOC_TYPES: Array<{ value: DocType; label: string; icon: string; hint: string }> = [
  { value: 'receipt', label: 'Приход', icon: '📥', hint: 'Закупка от поставщика' },
  { value: 'issue', label: 'Списание', icon: '📤', hint: 'Материалы на объект / работу' },
  { value: 'transfer', label: 'Перемещение', icon: '🚚', hint: 'Между локациями' },
  { value: 'count', label: 'Инвентаризация', icon: '⚖️', hint: 'Физический пересчёт' },
  { value: 'adjustment', label: 'Корректировка', icon: '🔧', hint: 'Ручная правка остатков' },
];

const ISSUE_REASONS: Array<{ value: IssueReason; label: string; requiresProject: boolean }> = [
  { value: 'project_installation', label: 'На объект — установка', requiresProject: true },
  { value: 'project_service_call', label: 'На объект — сервис', requiresProject: true },
  { value: 'project_warranty', label: 'На объект — гарантия', requiresProject: true },
  { value: 'internal_shop_use', label: 'Внутренние нужды', requiresProject: false },
  { value: 'damage_warehouse', label: 'Брак / повреждение (склад)', requiresProject: false },
  { value: 'damage_transit', label: 'Брак / повреждение (доставка)', requiresProject: false },
  { value: 'loss_theft', label: 'Потеря / кража', requiresProject: false },
  { value: 'return_to_vendor', label: 'Возврат поставщику', requiresProject: false },
];

interface LineDraft {
  id: string;
  itemId: string;
  uom: string;
  qty: string;
  unitCost: string;
  note: string;
}

function newLine(): LineDraft {
  return {
    id: Math.random().toString(36).slice(2, 10),
    itemId: '',
    uom: '',
    qty: '1',
    unitCost: '',
    note: '',
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  items: WhItemClient[];
  locations: WhLocationClient[];
  projects: Array<{ id: string; name: string }>;
  defaultType?: DocType;
}

export default function DocumentFormDialog({
  open,
  onClose,
  onSaved,
  items,
  locations,
  projects,
  defaultType,
}: Props) {
  const [docType, setDocType] = useState<DocType>(defaultType ?? 'receipt');
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [vendorReceiptNumber, setVendorReceiptNumber] = useState('');
  const [reason, setReason] = useState<IssueReason | ''>('');
  const [projectId, setProjectId] = useState('');
  const [phaseCode, setPhaseCode] = useState('');
  const [costCategory, setCostCategory] = useState<'materials' | 'equipment' | 'consumables' | ''>('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [postImmediately, setPostImmediately] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDocType(defaultType ?? 'receipt');
      setEventDate(new Date().toISOString().slice(0, 10));
      setSourceLocationId('');
      setDestinationLocationId('');
      setLocationId('');
      setVendorReceiptNumber('');
      setReason('');
      setProjectId('');
      setPhaseCode('');
      setCostCategory('');
      setNote('');
      setLines([newLine()]);
      setPostImmediately(false);
      setError(null);
    }
  }, [open, defaultType]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const locationOptions = useMemo(
    () => locations.map((l) => ({ id: l.id, label: `${l.name} · ${l.locationType}` })),
    [locations],
  );

  const itemOptions = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        label: `${i.name} · ${i.sku}`,
        baseUOM: i.baseUOM,
        allowedUOMs: i.allowedIssueUOMs ?? [i.baseUOM],
        purchaseUOMs: (i.purchaseUOMs ?? []).map((p) => p.uom),
      })),
    [items],
  );

  const subtotal = useMemo(() => {
    return lines.reduce((sum, l) => {
      const qty = Number(l.qty) || 0;
      const unit = Number(l.unitCost) || 0;
      return sum + qty * unit;
    }, 0);
  }, [lines]);

  const needsProject =
    docType === 'issue' && !!reason && ISSUE_REASONS.find((r) => r.value === reason)?.requiresProject;

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((ls) => [...ls, newLine()]);
  }

  function removeLine(id: string) {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.id !== id)));
  }

  function allowedUomsFor(itemId: string, type: DocType): string[] {
    const item = itemById.get(itemId);
    if (!item) return [];
    if (type === 'receipt') {
      return (item.purchaseUOMs ?? []).map((p) => p.uom);
    }
    return item.allowedIssueUOMs ?? [item.baseUOM];
  }

  async function handleSubmit() {
    setError(null);

    // Context validation (mirrors Zod superRefine)
    if (docType === 'receipt' && !destinationLocationId) return setError('Receipt требует локацию назначения');
    if (docType === 'issue' && !sourceLocationId) return setError('Issue требует локацию источника');
    if (docType === 'transfer') {
      if (!sourceLocationId || !destinationLocationId) return setError('Transfer требует источник и назначение');
      if (sourceLocationId === destinationLocationId) return setError('Источник и назначение должны отличаться');
    }
    if ((docType === 'count' || docType === 'adjustment') && !locationId) {
      return setError(`${docType} требует локацию`);
    }
    if (needsProject && !projectId) return setError('Issue с причиной "на объект" требует projectId');

    // Lines validation
    const cleanLines: WhDocumentLineClient[] = [];
    for (const [i, l] of lines.entries()) {
      if (!l.itemId) return setError(`Строка ${i + 1}: выберите товар`);
      if (!l.uom) return setError(`Строка ${i + 1}: выберите UOM`);
      const qty = Number(l.qty);
      if (!(qty > 0)) return setError(`Строка ${i + 1}: количество > 0`);
      const unitCost = l.unitCost === '' ? undefined : Number(l.unitCost);
      if (unitCost !== undefined && unitCost < 0) return setError(`Строка ${i + 1}: цена ≥ 0`);
      if (docType === 'receipt' && unitCost === undefined) {
        return setError(`Строка ${i + 1}: для receipt нужна unitCost`);
      }
      const line: WhDocumentLineClient = {
        itemId: l.itemId,
        uom: l.uom,
        qty,
      };
      if (unitCost !== undefined) line.unitCost = unitCost;
      if (l.note.trim()) line.note = l.note.trim();
      if (docType === 'issue' || docType === 'transfer') {
        if (projectId) line.projectId = projectId;
        if (phaseCode) line.phaseCode = phaseCode;
        if (costCategory) line.costCategory = costCategory;
      }
      cleanLines.push(line);
    }

    const payload: CreateDocumentPayload = {
      docType,
      eventDate,
      lines: cleanLines,
      source: 'ui',
    };
    if (docType === 'receipt') {
      payload.destinationLocationId = destinationLocationId;
      if (vendorReceiptNumber.trim()) payload.vendorReceiptNumber = vendorReceiptNumber.trim();
    }
    if (docType === 'issue') {
      payload.sourceLocationId = sourceLocationId;
      if (reason) payload.reason = reason;
      if (projectId) payload.projectId = projectId;
      if (phaseCode) payload.phaseCode = phaseCode;
      if (costCategory) payload.costCategory = costCategory;
    }
    if (docType === 'transfer') {
      payload.sourceLocationId = sourceLocationId;
      payload.destinationLocationId = destinationLocationId;
      if (projectId) payload.projectId = projectId;
    }
    if (docType === 'count' || docType === 'adjustment') {
      payload.locationId = locationId;
      if (reason) payload.reason = reason;
    }
    if (note.trim()) payload.note = note.trim();
    if (subtotal > 0) {
      payload.totals = { subtotal, total: subtotal, currency: 'USD' };
    }

    setSaving(true);
    try {
      const created = await createDocument(payload);
      if (postImmediately) {
        await postDocument(created.documentId);
        toast.success(`✅ Документ ${created.docNumber} проведён`);
      } else {
        toast.success(`📝 Draft ${created.docNumber} создан`);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>📄 Новый документ</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              1. Тип документа
            </Typography>
            <RadioGroup row value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
              {DOC_TYPES.map((t) => (
                <FormControlLabel
                  key={t.value}
                  value={t.value}
                  control={<Radio />}
                  label={
                    <span>
                      {t.icon} <strong>{t.label}</strong>{' '}
                      <Typography component="span" variant="caption" color="text.secondary">
                        — {t.hint}
                      </Typography>
                    </span>
                  }
                  sx={{ mr: 3 }}
                />
              ))}
            </RadioGroup>
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              2. Контекст
            </Typography>
            <Stack spacing={2}>
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Дата события"
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  sx={{ width: 220 }}
                />

                {(docType === 'issue' || docType === 'transfer') && (
                  <Autocomplete
                    options={locationOptions}
                    getOptionLabel={(o) => o.label}
                    value={locationOptions.find((l) => l.id === sourceLocationId) ?? null}
                    onChange={(_, v) => setSourceLocationId(v?.id ?? '')}
                    renderInput={(p) => <TextField {...p} label="Откуда" required />}
                    sx={{ flex: 1 }}
                  />
                )}

                {(docType === 'receipt' || docType === 'transfer') && (
                  <Autocomplete
                    options={locationOptions}
                    getOptionLabel={(o) => o.label}
                    value={locationOptions.find((l) => l.id === destinationLocationId) ?? null}
                    onChange={(_, v) => setDestinationLocationId(v?.id ?? '')}
                    renderInput={(p) => <TextField {...p} label="Куда" required />}
                    sx={{ flex: 1 }}
                  />
                )}

                {(docType === 'count' || docType === 'adjustment') && (
                  <Autocomplete
                    options={locationOptions}
                    getOptionLabel={(o) => o.label}
                    value={locationOptions.find((l) => l.id === locationId) ?? null}
                    onChange={(_, v) => setLocationId(v?.id ?? '')}
                    renderInput={(p) => <TextField {...p} label="Локация" required />}
                    sx={{ flex: 1 }}
                  />
                )}
              </Stack>

              {docType === 'receipt' && (
                <TextField
                  label="Номер накладной поставщика"
                  value={vendorReceiptNumber}
                  onChange={(e) => setVendorReceiptNumber(e.target.value)}
                  fullWidth
                />
              )}

              {docType === 'issue' && (
                <Stack direction="row" spacing={2}>
                  <TextField
                    select
                    label="Причина"
                    value={reason}
                    onChange={(e) => setReason(e.target.value as IssueReason)}
                    sx={{ minWidth: 260 }}
                  >
                    <MenuItem value="">— не выбрано —</MenuItem>
                    {ISSUE_REASONS.map((r) => (
                      <MenuItem key={r.value} value={r.value}>
                        {r.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {needsProject && (
                    <Autocomplete
                      options={projects}
                      getOptionLabel={(o) => o.name}
                      value={projects.find((p) => p.id === projectId) ?? null}
                      onChange={(_, v) => setProjectId(v?.id ?? '')}
                      renderInput={(p) => <TextField {...p} label="Проект" required />}
                      sx={{ flex: 1, minWidth: 260 }}
                    />
                  )}
                </Stack>
              )}

              {(docType === 'issue' || docType === 'transfer') && (
                <Stack direction="row" spacing={2}>
                  <TextField
                    select
                    label="Phase code"
                    value={phaseCode}
                    onChange={(e) => setPhaseCode(e.target.value)}
                    sx={{ minWidth: 200 }}
                  >
                    <MenuItem value="">—</MenuItem>
                    {['rough_in', 'trim', 'service', 'service_call', 'change_order', 'warranty'].map((p) => (
                      <MenuItem key={p} value={p}>
                        {p}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="Cost category"
                    value={costCategory}
                    onChange={(e) => setCostCategory(e.target.value as any)}
                    sx={{ minWidth: 200 }}
                  >
                    <MenuItem value="">—</MenuItem>
                    <MenuItem value="materials">materials</MenuItem>
                    <MenuItem value="equipment">equipment</MenuItem>
                    <MenuItem value="consumables">consumables</MenuItem>
                  </TextField>
                </Stack>
              )}
            </Stack>
          </Box>

          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle2">3. Строки</Typography>
              <Typography variant="body2" color="text.secondary">
                Subtotal: <strong>${subtotal.toFixed(2)}</strong>
              </Typography>
            </Stack>
            <Paper variant="outlined" sx={{ mt: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Товар</TableCell>
                    <TableCell width={120}>UOM</TableCell>
                    <TableCell width={110} align="right">
                      Кол-во
                    </TableCell>
                    <TableCell width={140} align="right">
                      Unit cost
                    </TableCell>
                    <TableCell>Note</TableCell>
                    <TableCell width={50} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((l) => {
                    const allowedUOMs = l.itemId ? allowedUomsFor(l.itemId, docType) : [];
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          <Autocomplete
                            options={itemOptions}
                            getOptionLabel={(o) => o.label}
                            value={itemOptions.find((o) => o.id === l.itemId) ?? null}
                            onChange={(_, v) => {
                              const item = v ? itemById.get(v.id) : null;
                              const defaultUOM = item
                                ? docType === 'receipt'
                                  ? (item.purchaseUOMs ?? []).find((p) => p.isDefault)?.uom ?? item.baseUOM
                                  : item.baseUOM
                                : '';
                              updateLine(l.id, { itemId: v?.id ?? '', uom: defaultUOM });
                            }}
                            size="small"
                            renderInput={(p) => <TextField {...p} placeholder="Поиск..." />}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            select
                            size="small"
                            value={l.uom}
                            onChange={(e) => updateLine(l.id, { uom: e.target.value })}
                            disabled={!l.itemId}
                            fullWidth
                          >
                            {allowedUOMs.map((u) => (
                              <MenuItem key={u} value={u}>
                                {u}
                              </MenuItem>
                            ))}
                          </TextField>
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            value={l.qty}
                            onChange={(e) => updateLine(l.id, { qty: e.target.value })}
                            inputProps={{ style: { textAlign: 'right' } }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            value={l.unitCost}
                            onChange={(e) => updateLine(l.id, { unitCost: e.target.value })}
                            placeholder={docType === 'receipt' ? 'обяз.' : 'опц.'}
                            InputProps={{
                              startAdornment: <InputAdornment position="start">$</InputAdornment>,
                            }}
                            inputProps={{ style: { textAlign: 'right' } }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={l.note}
                            onChange={(e) => updateLine(l.id, { note: e.target.value })}
                            fullWidth
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton size="small" onClick={() => removeLine(l.id)} disabled={lines.length === 1}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Paper>
            <Button size="small" startIcon={<AddIcon />} onClick={addLine} sx={{ mt: 1 }}>
              Добавить строку
            </Button>
          </Box>

          <TextField
            label="Комментарий"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            inputProps={{ maxLength: 2000 }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={postImmediately}
                onChange={(e) => setPostImmediately(e.target.checked)}
              />
            }
            label="Сразу провести (post): балансы обновятся мгновенно"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Сохранение…' : postImmediately ? '✅ Создать и провести' : '💾 Создать draft'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
