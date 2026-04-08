import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  Typography,
} from '@mui/material';
import { ContentCopy as ContentCopyIcon } from '@mui/icons-material';
import { UserRole } from '../../types/user.types';
import { inviteUser } from '../../api/userManagementApi';
import { errorMessage } from '../../utils/errorMessage';

interface InviteUserDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Диалог приглашения нового пользователя в команду
 */
const InviteUserDialog: React.FC<InviteUserDialogProps> = ({ open, onClose, onSuccess }) => {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('estimator');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [passwordResetLink, setPasswordResetLink] = useState('');
  const [invitedUserEmail, setInvitedUserEmail] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Cleanup таймера при размонтировании компонента
  useEffect(() => {
    let timerId: NodeJS.Timeout;

    if (copySuccess) {
      timerId = setTimeout(() => setCopySuccess(false), 2000);
    }

    return () => {
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [copySuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Валидация обязательных полей
    if (!email || !displayName) {
      setError('Email и имя обязательны для заполнения');
      return;
    }

    // Валидация формата email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Некорректный формат email адреса');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Вызываем Cloud Function для создания пользователя
      const result = await inviteUser(email, displayName, role, title);

      console.log('✅ Пользователь приглашен:', result);
      console.log('🔗 Ссылка для установки пароля:', result.passwordResetLink);

      // Показываем диалог с ссылкой для копирования
      setPasswordResetLink(result.passwordResetLink);
      setInvitedUserEmail(email);
      setEmailSent(result.emailSent || false);
      setEmailError(result.emailError || null);
      setSuccessDialogOpen(true);

      // Успех - обновляем список пользователей
      onSuccess();
    } catch (err: unknown) {
      console.error('Error inviting user:', err);
      setError(errorMessage(err) || 'Не удалось пригласить пользователя');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setDisplayName('');
    setRole('estimator');
    setTitle('');
    setError(null);
    onClose();
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(passwordResetLink);
      setCopySuccess(true);
      // Таймер для сброса copySuccess обрабатывается в useEffect
    } catch (err) {
      console.error('Failed to copy link:', err);
      setError('Не удалось скопировать ссылку');
    }
  };

  const handleSuccessDialogClose = () => {
    setSuccessDialogOpen(false);
    setPasswordResetLink('');
    setInvitedUserEmail('');
    setCopySuccess(false);
    setEmailSent(false);
    setEmailError(null);
    handleClose();
  };

  return (
    <>
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Пригласить участника команды</DialogTitle>

        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
              autoFocus
              helperText="На этот email будет отправлено приглашение"
            />

            <TextField
              label="Имя и фамилия"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              fullWidth
              helperText="Как обращаться к пользователю"
            />

            <TextField
              label="Должность"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
              helperText="Например: Сметчик, Прораб (опционально)"
            />

            <FormControl fullWidth required>
              <InputLabel>Роль</InputLabel>
              <Select
                value={role}
                label="Роль"
                onChange={(e) => setRole(e.target.value as UserRole)}
              >
                <MenuItem value="admin">
                  <Box>
                    <Box sx={{ fontWeight: 600 }}>Администратор</Box>
                    <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                      Полный доступ к управлению командой
                    </Box>
                  </Box>
                </MenuItem>
                <MenuItem value="manager">
                  <Box>
                    <Box sx={{ fontWeight: 600 }}>Менеджер</Box>
                    <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                      Управление проектами и задачами
                    </Box>
                  </Box>
                </MenuItem>
                <MenuItem value="estimator">
                  <Box>
                    <Box sx={{ fontWeight: 600 }}>Сметчик</Box>
                    <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                      Создание и редактирование смет
                    </Box>
                  </Box>
                </MenuItem>
                <MenuItem value="guest">
                  <Box>
                    <Box sx={{ fontWeight: 600 }}>Гость</Box>
                    <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                      Только просмотр
                    </Box>
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>

            <Alert severity="info">
              Пользователь получит email с инструкциями для входа в систему.
            </Alert>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} disabled={loading}>
            Отмена
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} /> : null}
          >
            {loading ? 'Отправка...' : 'Пригласить'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>

    {/* Диалог успешного приглашения с ссылкой */}
    <Dialog open={successDialogOpen} onClose={handleSuccessDialogClose} maxWidth="sm" fullWidth>
      <DialogTitle>Пользователь успешно приглашен!</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Alert severity="success">
            Пользователь <strong>{invitedUserEmail}</strong> успешно добавлен в команду.
          </Alert>

          {/* Статус отправки email */}
          {emailSent ? (
            <Alert severity="success" icon="📧">
              Email с инструкциями отправлен на <strong>{invitedUserEmail}</strong>
            </Alert>
          ) : emailError ? (
            <Alert severity="warning">
              ⚠️ Email не был отправлен: {emailError}
              <br />
              Пожалуйста, скопируйте ссылку ниже и отправьте ее пользователю вручную.
            </Alert>
          ) : (
            <Alert severity="info">
              Email отправка не настроена. Скопируйте ссылку ниже и отправьте ее пользователю
              вручную.
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary">
            {emailSent
              ? 'Резервная ссылка (на случай проблем с email):'
              : 'Скопируйте ссылку ниже и отправьте ее пользователю для установки пароля и входа в систему:'}
          </Typography>

          <TextField
            fullWidth
            multiline
            rows={3}
            value={passwordResetLink}
            InputProps={{
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={handleCopyLink} edge="end">
                    <ContentCopyIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          {copySuccess && (
            <Alert severity="info" sx={{ mt: 1 }}>
              Ссылка скопирована в буфер обмена!
            </Alert>
          )}

          <Alert severity="info">
            Эта ссылка позволит пользователю установить свой пароль и войти в систему.
          </Alert>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleSuccessDialogClose} variant="contained">
          Готово
        </Button>
      </DialogActions>
    </Dialog>
    </>
  );
};

export default InviteUserDialog;
