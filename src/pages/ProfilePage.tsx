import React, { useState } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  TextField,
  Button,
  Stack,
  Divider,
  CircularProgress,
  Alert,
} from '@mui/material';
import { useAuth } from '../auth/AuthContext';
import AvatarUpload from '../components/admin/AvatarUpload';
import { updateUserExtendedProfile } from '../api/userManagementApi';

/**
 * Страница профиля пользователя
 * Позволяет редактировать свой профиль и загружать аватар
 */
const ProfilePage: React.FC = () => {
  const { userProfile } = useAuth();
  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [title, setTitle] = useState(userProfile?.title || '');
  const [phone, setPhone] = useState(userProfile?.phone || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Обновляем поля при изменении профиля
  React.useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.displayName || '');
      setTitle(userProfile.title || '');
      setPhone(userProfile.phone || '');
    }
  }, [userProfile]);

  const handleSave = async () => {
    if (!userProfile) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      await updateUserExtendedProfile(userProfile.id, {
        displayName: displayName.trim(),
        title: title.trim() || undefined,
        phone: phone.trim() || undefined,
      });

      setSuccess('Профиль успешно обновлен!');
      console.log('✅ Profile updated successfully');
    } catch (err: any) {
      console.error('Error saving profile:', err);
      setError('Не удалось сохранить профиль: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!userProfile) {
    return (
      <Container maxWidth="md" sx={{ mt: 4, textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Мой профиль
      </Typography>

      <Paper sx={{ p: 3, mt: 3 }}>
        {/* Аватар */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            Фото профиля
          </Typography>
          <AvatarUpload />
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Форма профиля */}
        <Box>
          <Typography variant="h6" gutterBottom>
            Основная информация
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}

          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              label="Полное имя"
              fullWidth
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />

            <TextField
              label="Должность"
              fullWidth
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Ведущий сметчик"
            />

            <TextField
              label="Телефон"
              fullWidth
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 (999) 123-45-67"
            />

            <TextField
              label="Email"
              fullWidth
              value={userProfile.email}
              disabled
              helperText="Email нельзя изменить"
            />

            <TextField
              label="Роль"
              fullWidth
              value={userProfile.role}
              disabled
              helperText="Роль может изменить только администратор"
            />

            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving || !displayName.trim()}
              fullWidth
            >
              {saving ? <CircularProgress size={24} /> : 'Сохранить изменения'}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Container>
  );
};

export default ProfilePage;
