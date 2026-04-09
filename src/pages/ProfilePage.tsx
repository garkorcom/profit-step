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
  Card,
  CardContent,
  CardActions,
  Grid
} from '@mui/material';
import TelegramIcon from '@mui/icons-material/Telegram';
import { useAuth } from '../auth/AuthContext';
import AvatarUpload from '../components/admin/AvatarUpload';
import { updateUserExtendedProfile } from '../api/userManagementApi';
import { errorMessage } from '../utils/errorMessage';

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
    } catch (err: unknown) {
      console.error('Error saving profile:', err);
      setError('Не удалось сохранить профиль: ' + errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!userProfile) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 8 }}>
      <Typography variant="h4" gutterBottom fontWeight="bold" color="text.primary">
        Мой профиль
      </Typography>

      <Grid container spacing={4} sx={{ mt: 1 }}>
        {/* Left Column: Avatar & Quick Actions */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card elevation={0} sx={{ borderRadius: 4, border: '1px solid', borderColor: 'divider', textAlign: 'center', p: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight="600" color="text.secondary" sx={{ mb: 3 }}>
                Фото профиля
              </Typography>
              <Box display="flex" justifyContent="center" mb={2}>
                <AvatarUpload />
              </Box>
              <Typography variant="h6" fontWeight="bold">
                {userProfile.displayName || userProfile.email}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {userProfile.role && userProfile.role.toUpperCase()}
              </Typography>
            </CardContent>

            <Divider sx={{ my: 1, mx: 2 }} />

            <CardActions sx={{ flexDirection: 'column', gap: 1.5, p: 3 }}>
              <Typography variant="subtitle2" fontWeight="600" align="left" width="100%">
                Интеграции
              </Typography>
              <Button
                variant="outlined"
                color="info"
                startIcon={<TelegramIcon />}
                href={`https://t.me/gcostsbot`}
                target="_blank"
                fullWidth
                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600, py: 1 }}
              >
                Profit Step Bot
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                Подключите Telegram бота для быстрого управления задачами, отчетами и расходами прямо с телефона.
              </Typography>
            </CardActions>
          </Card>
        </Grid>

        {/* Right Column: Settings Form */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper elevation={0} sx={{ p: 4, borderRadius: 4, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="h6" gutterBottom fontWeight="bold">
              Основная информация
            </Typography>
            <Divider sx={{ mb: 4, mt: 2 }} />

            {error && (
              <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }} onClose={() => setSuccess(null)}>
                {success}
              </Alert>
            )}

            <Stack spacing={3}>
              <TextField
                label="Полное имя"
                fullWidth
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                InputProps={{ sx: { borderRadius: 2 } }}
              />

              <TextField
                label="Должность"
                fullWidth
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Ведущий сметчик"
                InputProps={{ sx: { borderRadius: 2 } }}
              />

              <TextField
                label="Телефон"
                fullWidth
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 (999) 123-45-67"
                InputProps={{ sx: { borderRadius: 2 } }}
              />

              <TextField
                label="Email"
                fullWidth
                value={userProfile.email}
                disabled
                helperText="Email привязан к аккаунту и не может быть изменен"
                InputProps={{ sx: { borderRadius: 2, bgcolor: 'action.hover' } }}
              />

              <Box pt={2}>
                <Button
                  variant="contained"
                  onClick={handleSave}
                  disabled={saving || !displayName.trim()}
                  sx={{
                    borderRadius: 2,
                    px: 4,
                    py: 1.5,
                    textTransform: 'none',
                    fontWeight: 600,
                    boxShadow: 2
                  }}
                >
                  {saving ? <CircularProgress size={24} color="inherit" /> : 'Сохранить изменения'}
                </Button>
              </Box>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default ProfilePage;
