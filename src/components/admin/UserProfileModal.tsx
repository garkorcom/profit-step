import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Avatar,
  IconButton,
  CircularProgress,
  Alert,
} from '@mui/material';
import { PhotoCamera as PhotoCameraIcon } from '@mui/icons-material';
import { UserProfile } from '../../types/user.types';
import { uploadUserAvatar, updateUserExtendedProfile } from '../../api/userManagementApi';

interface UserProfileModalProps {
  open: boolean;
  user: UserProfile | null;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Модальное окно для редактирования профиля пользователя
 * Доступно только для администраторов
 */
const UserProfileModal: React.FC<UserProfileModalProps> = ({
  open,
  user,
  onClose,
  onSuccess,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Загружаем данные пользователя в форму при открытии
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setTitle(user.title || '');
      setPhone(user.phone || '');
      setPhotoURL(user.photoURL || '');

      // Преобразуем дату рождения в формат YYYY-MM-DD для input[type="date"]
      if (user.dob) {
        const date = typeof user.dob === 'string' ? new Date(user.dob) : user.dob.toDate();
        setDob(date.toISOString().split('T')[0]);
      } else {
        setDob('');
      }
    }
  }, [user]);

  // Обработка загрузки аватара
  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    // Проверяем тип файла
    if (!file.type.startsWith('image/')) {
      setError('Пожалуйста, выберите изображение');
      return;
    }

    // Проверяем размер файла (макс 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Размер файла не должен превышать 5MB');
      return;
    }

    try {
      setUploading(true);
      setError(null);

      const downloadURL = await uploadUserAvatar(user.id, file);
      setPhotoURL(downloadURL);

      console.log('✅ Avatar uploaded successfully');
    } catch (err: any) {
      console.error('Error uploading avatar:', err);
      setError('Не удалось загрузить аватар: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  // Обработка сохранения профиля
  const handleSave = async () => {
    if (!user) return;

    try {
      setSaving(true);
      setError(null);

      await updateUserExtendedProfile(user.id, {
        displayName: displayName.trim(),
        title: title.trim() || undefined,
        phone: phone.trim() || undefined,
        dob: dob ? new Date(dob) : null,
      });

      console.log('✅ Profile updated successfully');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error saving profile:', err);
      setError('Не удалось сохранить профиль: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Редактирование профиля</DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Загрузчик аватара */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3, mt: 2 }}>
          <Box sx={{ position: 'relative' }}>
            <Avatar
              src={photoURL}
              alt={displayName}
              sx={{ width: 120, height: 120 }}
            />
            <input
              accept="image/*"
              style={{ display: 'none' }}
              id="avatar-upload"
              type="file"
              onChange={handleAvatarUpload}
              disabled={uploading}
            />
            <label htmlFor="avatar-upload">
              <IconButton
                component="span"
                sx={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  bgcolor: 'primary.main',
                  color: 'white',
                  '&:hover': {
                    bgcolor: 'primary.dark',
                  },
                }}
                disabled={uploading}
              >
                {uploading ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  <PhotoCameraIcon />
                )}
              </IconButton>
            </label>
          </Box>
        </Box>

        {/* Поля формы */}
        <TextField
          label="Полное имя"
          fullWidth
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          margin="normal"
        />

        <TextField
          label="Должность"
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          margin="normal"
          placeholder="Например: Ведущий сметчик"
        />

        <TextField
          label="Телефон"
          fullWidth
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          margin="normal"
          placeholder="+7 (999) 123-45-67"
        />

        <TextField
          label="Дата рождения"
          fullWidth
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          margin="normal"
          InputLabelProps={{
            shrink: true,
          }}
        />

        <TextField
          label="Email"
          fullWidth
          value={user.email}
          margin="normal"
          disabled
          helperText="Email нельзя изменить"
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving || !displayName.trim()}
        >
          {saving ? <CircularProgress size={24} /> : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UserProfileModal;
