/**
 * Vendor form dialog — create / edit supplier.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import toast from 'react-hot-toast';
import {
  createVendor,
  updateVendor,
  type CreateVendorPayload,
  type VendorType,
  type WhCategoryClient,
  type WhVendorClient,
} from '../../api/warehouseApi';

const VENDOR_TYPES: Array<{ value: VendorType; label: string }> = [
  { value: 'big_box', label: '🏬 Big box (Home Depot, Lowes)' },
  { value: 'local_supply', label: '🏪 Local supply (local dealer)' },
  { value: 'subcontractor_proxy', label: '👷 Subcontractor-proxy' },
  { value: 'online', label: '🌐 Online (Amazon, Grainger)' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  mode: 'create' | 'edit';
  vendor?: WhVendorClient | null;
  categories: WhCategoryClient[];
}

export default function VendorFormDialog({ open, onClose, onSaved, mode, vendor, categories }: Props) {
  const [name, setName] = useState('');
  const [vendorType, setVendorType] = useState<VendorType>('local_supply');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [defaultPaymentTerms, setDefaultPaymentTerms] = useState('');
  const [preferredForCategories, setPreferredForCategories] = useState<string[]>([]);
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === 'edit';

  useEffect(() => {
    if (!open) return;
    if (isEdit && vendor) {
      setName(vendor.name);
      setVendorType(vendor.vendorType);
      setContactEmail(vendor.contactEmail ?? '');
      setContactPhone(vendor.contactPhone ?? '');
      setContactName(vendor.contactName ?? '');
      setDefaultPaymentTerms(vendor.defaultPaymentTerms ?? '');
      setPreferredForCategories(vendor.preferredForCategories ?? []);
      setApiEndpoint(vendor.apiEndpoint ?? '');
    } else {
      setName('');
      setVendorType('local_supply');
      setContactEmail('');
      setContactPhone('');
      setContactName('');
      setDefaultPaymentTerms('');
      setPreferredForCategories([]);
      setApiEndpoint('');
    }
    setError(null);
  }, [open, isEdit, vendor]);

  async function handleSubmit() {
    setError(null);
    if (!name.trim()) return setError('Название обязательно');

    setSaving(true);
    try {
      const payload: CreateVendorPayload = {
        name: name.trim(),
        vendorType,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        contactName: contactName.trim() || undefined,
        defaultPaymentTerms: defaultPaymentTerms.trim() || undefined,
        preferredForCategories: preferredForCategories.length > 0 ? preferredForCategories : undefined,
        apiEndpoint: apiEndpoint.trim() || undefined,
      };
      if (isEdit && vendor) {
        await updateVendor(vendor.id, payload);
        toast.success('Поставщик обновлён');
      } else {
        await createVendor(payload);
        toast.success(`✅ Поставщик «${payload.name}» создан`);
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? `Редактировать: ${vendor?.name}` : '➕ Новый поставщик'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" spacing={2}>
            <TextField label="Название" value={name} onChange={(e) => setName(e.target.value)} required fullWidth autoFocus />
            <TextField
              select
              label="Тип"
              value={vendorType}
              onChange={(e) => setVendorType(e.target.value as VendorType)}
              sx={{ minWidth: 220 }}
            >
              {VENDOR_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              label="Email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              fullWidth
            />
            <TextField label="Телефон" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} fullWidth />
          </Stack>

          <TextField label="Контактное лицо" value={contactName} onChange={(e) => setContactName(e.target.value)} fullWidth />

          <TextField
            label="Условия оплаты"
            value={defaultPaymentTerms}
            onChange={(e) => setDefaultPaymentTerms(e.target.value)}
            placeholder="net 30"
            fullWidth
          />

          <Autocomplete
            multiple
            freeSolo
            options={categories.map((c) => c.id)}
            getOptionLabel={(id) => categories.find((c) => c.id === id)?.name ?? id}
            value={preferredForCategories}
            onChange={(_, v) => setPreferredForCategories(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Приоритетные категории"
                helperText="Для UC6 (автозаказ) и UC4 (procurement)"
              />
            )}
          />

          <TextField
            label="API endpoint (опц.)"
            value={apiEndpoint}
            onChange={(e) => setApiEndpoint(e.target.value)}
            placeholder="https://..."
            fullWidth
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
