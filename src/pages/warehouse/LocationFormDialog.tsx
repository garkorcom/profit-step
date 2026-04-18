/**
 * Location form dialog — create / edit.
 * Spec: Improvement 11 §5.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import toast from 'react-hot-toast';
import {
  createLocation,
  updateLocation,
  type CreateLocationPayload,
  type LocationType,
  type WhLocationClient,
} from '../../api/warehouseApi';

const LOCATION_TYPES: Array<{ value: LocationType; label: string }> = [
  { value: 'warehouse', label: '🏭 Склад' },
  { value: 'van', label: '🚐 Van (машина сотрудника)' },
  { value: 'site', label: '🏗 Site (объект)' },
  { value: 'quarantine', label: '⚠️ Quarantine (брак/возврат)' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  mode: 'create' | 'edit';
  location?: WhLocationClient | null;
}

interface FormState {
  name: string;
  locationType: LocationType;
  ownerEmployeeId: string;
  licensePlate: string;
  address: string;
  twoPhaseTransferEnabled: boolean;
}

function emptyState(): FormState {
  return {
    name: '',
    locationType: 'warehouse',
    ownerEmployeeId: '',
    licensePlate: '',
    address: '',
    twoPhaseTransferEnabled: false,
  };
}

function stateFromLocation(loc: WhLocationClient): FormState {
  return {
    name: loc.name,
    locationType: loc.locationType,
    ownerEmployeeId: loc.ownerEmployeeId ?? '',
    licensePlate: loc.licensePlate ?? '',
    address: loc.address ?? '',
    twoPhaseTransferEnabled: false,
  };
}

export default function LocationFormDialog({ open, onClose, onSaved, mode, location }: Props) {
  const [form, setForm] = useState<FormState>(emptyState());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(mode === 'edit' && location ? stateFromLocation(location) : emptyState());
      setError(null);
    }
  }, [open, mode, location]);

  const isEdit = mode === 'edit';

  async function handleSubmit() {
    setError(null);
    if (!form.name.trim()) return setError('Название обязательно');
    if (form.locationType === 'van' && !form.ownerEmployeeId.trim()) {
      return setError('Для Van обязателен ownerEmployeeId');
    }

    setSaving(true);
    try {
      if (isEdit && location) {
        await updateLocation(location.id, {
          name: form.name.trim(),
          ownerEmployeeId: form.ownerEmployeeId.trim() || undefined,
          licensePlate: form.licensePlate.trim() || undefined,
          address: form.address.trim() || undefined,
          twoPhaseTransferEnabled: form.twoPhaseTransferEnabled,
        });
        toast.success('Локация обновлена');
      } else {
        const payload: CreateLocationPayload = {
          name: form.name.trim(),
          locationType: form.locationType,
          ownerEmployeeId: form.ownerEmployeeId.trim() || undefined,
          licensePlate: form.licensePlate.trim() || undefined,
          address: form.address.trim() || undefined,
          twoPhaseTransferEnabled: form.twoPhaseTransferEnabled,
        };
        await createLocation(payload);
        toast.success(`✅ Локация «${payload.name}» создана`);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  const isVan = form.locationType === 'van';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? `Редактировать: ${location?.name}` : '➕ Новая локация'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Название"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            fullWidth
            autoFocus
          />

          <TextField
            select
            label="Тип локации"
            value={form.locationType}
            onChange={(e) => setForm({ ...form, locationType: e.target.value as LocationType })}
            disabled={isEdit}
            fullWidth
            helperText={isEdit ? 'Тип изменить нельзя' : undefined}
          >
            {LOCATION_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label={isVan ? 'Owner employee ID (userId)' : 'Owner employee ID (опц.)'}
            value={form.ownerEmployeeId}
            onChange={(e) => setForm({ ...form, ownerEmployeeId: e.target.value })}
            required={isVan}
            fullWidth
            helperText={isVan ? 'Обязательно для Van' : 'Firestore users/{uid}'}
          />

          {isVan && (
            <TextField
              label="License plate"
              value={form.licensePlate}
              onChange={(e) => setForm({ ...form, licensePlate: e.target.value })}
              fullWidth
            />
          )}

          <TextField
            label="Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            multiline
            minRows={2}
            fullWidth
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={form.twoPhaseTransferEnabled}
                onChange={(e) => setForm({ ...form, twoPhaseTransferEnabled: e.target.checked })}
              />
            }
            label="Two-phase transfer (intransit → received)"
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
