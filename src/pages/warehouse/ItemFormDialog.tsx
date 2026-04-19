/**
 * Item form dialog — create / edit.
 *
 * Create: full form per SPEC §4 (Improvement 11).
 * Edit: mutable fields only (name/category/minStock/reorderPoint/isTrackable/notes)
 * per functions/src/warehouse/database/schemas/item.schema.ts UpdateWhItemSchema.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import toast from 'react-hot-toast';
import {
  createItem,
  updateItem,
  type CreateItemPayload,
  type WhCategoryClient,
  type WhItemClient,
  type WhPurchaseUOMClient,
} from '../../api/warehouseApi';

const BASE_UOM_OPTIONS = ['each', 'ft', 'm', 'lb', 'gal', 'roll', 'box', 'pack', 'bag'];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  mode: 'create' | 'edit';
  categories: WhCategoryClient[];
  item?: WhItemClient | null;
}

interface FormState {
  sku: string;
  name: string;
  category: string;
  baseUOM: string;
  purchaseUOMs: WhPurchaseUOMClient[];
  allowedIssueUOMs: string[];
  lastPurchasePrice: string;
  averageCost: string;
  minStock: string;
  reorderPoint: string;
  isTrackable: boolean;
  notes: string;
}

function emptyState(): FormState {
  return {
    sku: '',
    name: '',
    category: '',
    baseUOM: 'each',
    purchaseUOMs: [{ uom: 'each', factor: 1, isDefault: true }],
    allowedIssueUOMs: ['each'],
    lastPurchasePrice: '0',
    averageCost: '0',
    minStock: '',
    reorderPoint: '',
    isTrackable: false,
    notes: '',
  };
}

function stateFromItem(item: WhItemClient): FormState {
  return {
    sku: item.sku,
    name: item.name,
    category: item.category,
    baseUOM: item.baseUOM,
    purchaseUOMs: item.purchaseUOMs ?? [{ uom: item.baseUOM, factor: 1, isDefault: true }],
    allowedIssueUOMs: item.allowedIssueUOMs ?? [item.baseUOM],
    lastPurchasePrice: String(item.lastPurchasePrice ?? 0),
    averageCost: String(item.averageCost ?? 0),
    minStock: item.minStock !== undefined ? String(item.minStock) : '',
    reorderPoint: item.reorderPoint !== undefined ? String(item.reorderPoint) : '',
    isTrackable: !!item.isTrackable,
    notes: item.notes ?? '',
  };
}

export default function ItemFormDialog({ open, onClose, onSaved, mode, categories, item }: Props) {
  const [form, setForm] = useState<FormState>(emptyState());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(mode === 'edit' && item ? stateFromItem(item) : emptyState());
      setError(null);
    }
  }, [open, mode, item]);

  const isEdit = mode === 'edit';

  const purchaseUomOptions = useMemo(
    () => [...new Set([form.baseUOM, ...form.purchaseUOMs.map((p) => p.uom)].filter(Boolean))],
    [form.baseUOM, form.purchaseUOMs],
  );

  function updatePurchaseUom(idx: number, patch: Partial<WhPurchaseUOMClient>) {
    setForm((f) => ({
      ...f,
      purchaseUOMs: f.purchaseUOMs.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));
  }

  function setDefaultPurchaseUom(idx: number) {
    setForm((f) => ({
      ...f,
      purchaseUOMs: f.purchaseUOMs.map((p, i) => ({ ...p, isDefault: i === idx })),
    }));
  }

  function addPurchaseUom() {
    setForm((f) => ({
      ...f,
      purchaseUOMs: [...f.purchaseUOMs, { uom: '', factor: 1, isDefault: f.purchaseUOMs.length === 0 }],
    }));
  }

  function removePurchaseUom(idx: number) {
    setForm((f) => {
      const next = f.purchaseUOMs.filter((_, i) => i !== idx);
      if (next.length > 0 && !next.some((p) => p.isDefault)) {
        next[0] = { ...next[0], isDefault: true };
      }
      return { ...f, purchaseUOMs: next };
    });
  }

  function toggleIssueUom(uom: string) {
    setForm((f) => ({
      ...f,
      allowedIssueUOMs: f.allowedIssueUOMs.includes(uom)
        ? f.allowedIssueUOMs.filter((u) => u !== uom)
        : [...f.allowedIssueUOMs, uom],
    }));
  }

  async function handleSubmit() {
    setError(null);

    if (!isEdit) {
      if (!form.sku.trim()) return setError('SKU обязателен');
      if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(form.sku.trim())) {
        return setError('SKU должен быть UPPERCASE (A-Z, 0-9, - и _)');
      }
      if (!form.name.trim()) return setError('Название обязательно');
      if (!form.category) return setError('Категория обязательна');
      if (!form.baseUOM) return setError('Base UOM обязателен');
      if (form.purchaseUOMs.length === 0) return setError('Нужна хотя бы одна purchase UOM');
      if (form.purchaseUOMs.filter((p) => p.isDefault).length !== 1) {
        return setError('Ровно одна purchase UOM должна быть default');
      }
      if (form.purchaseUOMs.some((p) => !p.uom || !(p.factor > 0))) {
        return setError('У каждой purchase UOM нужен uom и factor > 0');
      }
      if (form.allowedIssueUOMs.length === 0) return setError('Нужна хотя бы одна allowed issue UOM');
    } else {
      if (!form.name.trim()) return setError('Название обязательно');
      if (!form.category) return setError('Категория обязательна');
    }

    setSaving(true);
    try {
      if (isEdit && item) {
        const payload = {
          name: form.name.trim(),
          category: form.category,
          minStock: form.minStock ? Number(form.minStock) : undefined,
          reorderPoint: form.reorderPoint ? Number(form.reorderPoint) : undefined,
          isTrackable: form.isTrackable,
          notes: form.notes.trim() || undefined,
        };
        await updateItem(item.id, payload);
        toast.success('Товар обновлён');
      } else {
        const payload: CreateItemPayload = {
          sku: form.sku.trim().toUpperCase(),
          name: form.name.trim(),
          category: form.category,
          baseUOM: form.baseUOM,
          purchaseUOMs: form.purchaseUOMs.map((p) => ({
            uom: p.uom.trim(),
            factor: Number(p.factor),
            isDefault: p.isDefault,
          })),
          allowedIssueUOMs: form.allowedIssueUOMs,
          lastPurchasePrice: Number(form.lastPurchasePrice) || 0,
          averageCost: Number(form.averageCost) || 0,
          minStock: form.minStock ? Number(form.minStock) : undefined,
          reorderPoint: form.reorderPoint ? Number(form.reorderPoint) : undefined,
          isTrackable: form.isTrackable,
          notes: form.notes.trim() || undefined,
        };
        await createItem(payload);
        toast.success(`✅ Товар ${payload.sku} создан`);
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
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEdit ? `Редактировать: ${item?.name}` : '➕ Новый товар'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" spacing={2}>
            <TextField
              label="SKU"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })}
              disabled={isEdit}
              required
              fullWidth
              helperText={isEdit ? 'SKU изменить нельзя' : 'UPPERCASE, буквы/цифры/- _'}
            />
            <TextField
              label="Название"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              fullWidth
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Категория"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              required
              fullWidth
            >
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Base UOM"
              value={form.baseUOM}
              onChange={(e) => setForm({ ...form, baseUOM: e.target.value })}
              disabled={isEdit}
              required
              fullWidth
            >
              {BASE_UOM_OPTIONS.map((u) => (
                <MenuItem key={u} value={u}>
                  {u}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {!isEdit && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Purchase UOMs (единицы закупки)
              </Typography>
              <Stack spacing={1}>
                {form.purchaseUOMs.map((p, i) => (
                  <Stack key={i} direction="row" spacing={1} alignItems="center">
                    <TextField
                      size="small"
                      label="UOM"
                      value={p.uom}
                      onChange={(e) => updatePurchaseUom(i, { uom: e.target.value })}
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      size="small"
                      label="Factor (= base)"
                      type="number"
                      value={p.factor}
                      onChange={(e) => updatePurchaseUom(i, { factor: Number(e.target.value) })}
                      sx={{ width: 160 }}
                    />
                    <FormControlLabel
                      control={<Checkbox checked={p.isDefault} onChange={() => setDefaultPurchaseUom(i)} />}
                      label="default"
                    />
                    <IconButton size="small" onClick={() => removePurchaseUom(i)} disabled={form.purchaseUOMs.length === 1}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
                <Button size="small" startIcon={<AddIcon />} onClick={addPurchaseUom} sx={{ alignSelf: 'flex-start' }}>
                  Добавить UOM
                </Button>
              </Stack>
            </Box>
          )}

          {!isEdit && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Разрешённые UOM для списания
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {purchaseUomOptions.map((u) => (
                  <Chip
                    key={u}
                    label={u}
                    color={form.allowedIssueUOMs.includes(u) ? 'primary' : 'default'}
                    onClick={() => toggleIssueUom(u)}
                    variant={form.allowedIssueUOMs.includes(u) ? 'filled' : 'outlined'}
                  />
                ))}
              </Stack>
            </Box>
          )}

          <Stack direction="row" spacing={2}>
            <TextField
              label="Last purchase price"
              type="number"
              value={form.lastPurchasePrice}
              onChange={(e) => setForm({ ...form, lastPurchasePrice: e.target.value })}
              disabled={isEdit}
              fullWidth
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              helperText={isEdit ? 'обновляется при постинге receipt' : undefined}
            />
            <TextField
              label="Average cost"
              type="number"
              value={form.averageCost}
              onChange={(e) => setForm({ ...form, averageCost: e.target.value })}
              disabled={isEdit}
              fullWidth
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              helperText={isEdit ? 'рассчитывается автоматически' : 'default = lastPurchasePrice'}
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              label="Min stock"
              type="number"
              value={form.minStock}
              onChange={(e) => setForm({ ...form, minStock: e.target.value })}
              fullWidth
              helperText="low stock alert threshold"
            />
            <TextField
              label="Reorder point"
              type="number"
              value={form.reorderPoint}
              onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })}
              fullWidth
              helperText="auto-reorder trigger"
            />
          </Stack>

          <FormControlLabel
            control={
              <Checkbox
                checked={form.isTrackable}
                onChange={(e) => setForm({ ...form, isTrackable: e.target.checked })}
              />
            }
            label="Trackable (для инструментов с серийным номером)"
          />

          <TextField
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            multiline
            minRows={2}
            maxRows={6}
            fullWidth
            inputProps={{ maxLength: 2000 }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Создать'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
