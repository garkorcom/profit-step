/**
 * CompanyFormDialog - Create/Edit company dialog
 *
 * Features:
 * - Create new company
 * - Edit existing company
 * - Form validation (required fields, email, website)
 * - Loading states
 * - Toast notifications
 */

import React, { useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  CircularProgress,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { createCompany, updateCompany } from '../../api/companiesApi';
import { Company } from '../../types/crm.types';

interface CompanyFormDialogProps {
  open: boolean;
  onClose: () => void;
  companyToEdit: Company | null;
  onSaved: () => void;
}

interface FormData {
  name: string;
  email: string;
  phone: string;
  website: string;
  address: string;
}

export default function CompanyFormDialog({
  open,
  onClose,
  companyToEdit,
  onSaved,
}: CompanyFormDialogProps) {
  const { userProfile } = useAuth();
  const [saving, setSaving] = React.useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      website: '',
      address: '',
    },
  });

  // Заполнение формы при редактировании
  useEffect(() => {
    if (companyToEdit) {
      reset({
        name: companyToEdit.name,
        email: companyToEdit.email || '',
        phone: companyToEdit.phone || '',
        website: companyToEdit.website || '',
        address: companyToEdit.address || '',
      });
    } else {
      reset({
        name: '',
        email: '',
        phone: '',
        website: '',
        address: '',
      });
    }
  }, [companyToEdit, reset]);

  const onSubmit = async (data: FormData) => {
    if (!userProfile?.companyId) return;

    setSaving(true);
    try {
      if (companyToEdit) {
        // Обновление
        await updateCompany(companyToEdit.id, data);
        toast.success(`Компания "${data.name}" обновлена`);
      } else {
        // Создание
        await createCompany(data, userProfile.companyId);
        toast.success(`Компания "${data.name}" создана`);
      }

      onSaved();
      onClose();
      reset();
    } catch (error) {
      console.error('Error saving company:', error);
      toast.error('Ошибка при сохранении компании');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>
          {companyToEdit ? 'Редактировать компанию' : 'Новая компания'}
        </DialogTitle>

        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <Controller
              name="name"
              control={control}
              rules={{ required: 'Название обязательно' }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Название компании"
                  fullWidth
                  error={!!errors.name}
                  helperText={errors.name?.message}
                  autoFocus
                />
              )}
            />

            <Controller
              name="email"
              control={control}
              rules={{
                pattern: {
                  value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                  message: 'Некорректный email',
                },
              }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Email"
                  type="email"
                  fullWidth
                  error={!!errors.email}
                  helperText={errors.email?.message}
                />
              )}
            />

            <Controller
              name="phone"
              control={control}
              render={({ field }) => <TextField {...field} label="Телефон" fullWidth />}
            />

            <Controller
              name="website"
              control={control}
              rules={{
                pattern: {
                  value: /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/,
                  message: 'Некорректный URL',
                },
              }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Сайт"
                  fullWidth
                  placeholder="https://example.com"
                  error={!!errors.website}
                  helperText={errors.website?.message}
                />
              )}
            />

            <Controller
              name="address"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Адрес" fullWidth multiline rows={2} />
              )}
            />
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={saving}
            startIcon={saving ? <CircularProgress size={20} /> : null}
          >
            {companyToEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
