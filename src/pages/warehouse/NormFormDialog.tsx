/**
 * Norm form dialog — create / edit BoM (bill of materials) for a task type.
 * Backend schema: functions/src/warehouse/database/schemas/norm.schema.ts.
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
  IconButton,
  Paper,
  Stack,
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
  createNorm,
  updateNorm,
  type CreateNormPayload,
  type WhItemClient,
  type WhNormClient,
  type WhNormItemClient,
} from '../../api/warehouseApi';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  mode: 'create' | 'edit';
  items: WhItemClient[];
  norm?: WhNormClient | null;
}

interface LineDraft {
  id: string;
  itemId: string;
  qtyPerUnit: string;
  note: string;
}

function newLine(): LineDraft {
  return { id: Math.random().toString(36).slice(2, 10), itemId: '', qtyPerUnit: '1', note: '' };
}

export default function NormFormDialog({ open, onClose, onSaved, mode, items, norm }: Props) {
  const [taskType, setTaskType] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedLaborHours, setEstimatedLaborHours] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === 'edit';

  useEffect(() => {
    if (!open) return;
    if (isEdit && norm) {
      setTaskType(norm.taskType);
      setName(norm.name);
      setDescription(norm.description ?? '');
      setEstimatedLaborHours(norm.estimatedLaborHours ? String(norm.estimatedLaborHours) : '');
      setLines(
        norm.items.map((it) => ({
          id: Math.random().toString(36).slice(2, 10),
          itemId: it.itemId,
          qtyPerUnit: String(it.qtyPerUnit),
          note: it.note ?? '',
        })),
      );
    } else {
      setTaskType('');
      setName('');
      setDescription('');
      setEstimatedLaborHours('');
      setLines([newLine()]);
    }
    setError(null);
  }, [open, mode, norm, isEdit]);

  const itemOptions = useMemo(
    () => items.map((i) => ({ id: i.id, label: `${i.name} · ${i.sku}`, baseUOM: i.baseUOM })),
    [items],
  );

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((ls) => [...ls, newLine()]);
  }

  function removeLine(id: string) {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.id !== id)));
  }

  async function handleSubmit() {
    setError(null);
    if (!isEdit) {
      if (!/^[a-z][a-z0-9_]*$/.test(taskType.trim())) {
        return setError('taskType должен быть snake_case (a-z, 0-9, _)');
      }
    }
    if (!name.trim()) return setError('Название обязательно');

    const cleanItems: WhNormItemClient[] = [];
    for (const [i, l] of lines.entries()) {
      if (!l.itemId) return setError(`Строка ${i + 1}: выберите товар`);
      const qty = Number(l.qtyPerUnit);
      if (!(qty > 0)) return setError(`Строка ${i + 1}: qtyPerUnit > 0`);
      cleanItems.push({
        itemId: l.itemId,
        qtyPerUnit: qty,
        note: l.note.trim() || undefined,
      });
    }

    setSaving(true);
    try {
      if (isEdit && norm) {
        await updateNorm(norm.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          items: cleanItems,
          estimatedLaborHours: estimatedLaborHours ? Number(estimatedLaborHours) : undefined,
        });
        toast.success('Норма обновлена');
      } else {
        const payload: CreateNormPayload = {
          taskType: taskType.trim(),
          name: name.trim(),
          description: description.trim() || undefined,
          items: cleanItems,
          estimatedLaborHours: estimatedLaborHours ? Number(estimatedLaborHours) : undefined,
        };
        await createNorm(payload);
        toast.success(`✅ Норма ${payload.taskType} создана`);
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Не удалось сохранить';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEdit ? `Редактировать норму: ${norm?.name}` : '➕ Новая норма'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" spacing={2}>
            <TextField
              label="Task type (snake_case)"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              disabled={isEdit}
              required
              sx={{ minWidth: 260 }}
              helperText={isEdit ? 'изменить нельзя' : 'e.g. install_outlet'}
            />
            <TextField
              label="Название"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              fullWidth
            />
          </Stack>

          <TextField
            label="Описание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            inputProps={{ maxLength: 1000 }}
          />

          <TextField
            label="Estimated labor hours (на единицу)"
            value={estimatedLaborHours}
            onChange={(e) => setEstimatedLaborHours(e.target.value)}
            type="number"
            sx={{ width: 280 }}
          />

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Материалы на единицу
            </Typography>
            <Paper variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Товар</TableCell>
                    <TableCell width={140} align="right">
                      Кол-во / ед.
                    </TableCell>
                    <TableCell>Note</TableCell>
                    <TableCell width={50} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Autocomplete
                          options={itemOptions}
                          getOptionLabel={(o) => o.label}
                          value={itemOptions.find((o) => o.id === l.itemId) ?? null}
                          onChange={(_, v) => updateLine(l.id, { itemId: v?.id ?? '' })}
                          size="small"
                          renderInput={(p) => <TextField {...p} placeholder="Поиск..." />}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small"
                          type="number"
                          value={l.qtyPerUnit}
                          onChange={(e) => updateLine(l.id, { qtyPerUnit: e.target.value })}
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
                  ))}
                </TableBody>
              </Table>
            </Paper>
            <Button size="small" startIcon={<AddIcon />} onClick={addLine} sx={{ mt: 1 }}>
              Добавить строку
            </Button>
          </Box>
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
