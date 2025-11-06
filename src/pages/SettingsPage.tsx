import React, { useState } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Button,
  Divider,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Email as EmailIcon } from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/firebase';
import { useAuth } from '../auth/AuthContext';

/**
 * Страница настроек приложения
 * Доступна для всех пользователей, но некоторые функции только для админов
 */
const SettingsPage: React.FC = () => {
  const { userProfile } = useAuth();
  const [testingEmail, setTestingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isAdmin = userProfile?.role === 'admin';

  // Тестирование email интеграции
  const handleTestEmail = async () => {
    setTestingEmail(true);
    setError(null);
    setSuccess(null);

    try {
      // Используем централизованный functions из firebase.ts
      const testEmail = httpsCallable(functions, 'testEmail');

      console.log('📤 Отправка тестового email...');
      const result = await testEmail();

      console.log('✅ Результат:', result.data);
      setSuccess('✅ Тестовое письмо успешно отправлено! Проверьте ваш email (включая папку SPAM).');
    } catch (err: any) {
      console.error('❌ Ошибка:', err);
      setError('Ошибка отправки тестового email: ' + err.message);
    } finally {
      setTestingEmail(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Настройки
      </Typography>

      {/* Email настройки */}
      {isAdmin && (
        <Paper sx={{ p: 3, mt: 3 }}>
          <Typography variant="h6" gutterBottom>
            Email интеграция
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Тестирование отправки email через Brevo SMTP
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

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={testingEmail ? <CircularProgress size={20} /> : <EmailIcon />}
              onClick={handleTestEmail}
              disabled={testingEmail}
            >
              {testingEmail ? 'Отправка...' : 'Отправить тестовое письмо'}
            </Button>

            <Button
              variant="text"
              onClick={() => window.open('https://app.brevo.com/campaign/listing/sent', '_blank')}
            >
              Открыть Brevo Dashboard
            </Button>

            <Button
              variant="text"
              onClick={() =>
                window.open('https://console.firebase.google.com/project/profit-step/functions/logs', '_blank')
              }
            >
              Открыть логи Firebase
            </Button>
          </Box>

          <Divider sx={{ my: 3 }} />

          <Typography variant="body2" color="text.secondary">
            <strong>Конфигурация:</strong>
            <br />
            • SMTP сервер: smtp-relay.brevo.com:587
            <br />
            • Отправитель: info@garkor.com
            <br />
            • Получатель тестового письма: garkorusa@gmail.com
            <br />
            <br />
            <strong>Использование:</strong>
            <br />
            Тестовое письмо отправляется на garkorusa@gmail.com для проверки работы email интеграции. Проверьте папку SPAM, если письмо не пришло в течение минуты.
          </Typography>
        </Paper>
      )}

      {/* Общие настройки */}
      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" gutterBottom>
          Общие настройки
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Раздел в разработке...
        </Typography>
      </Paper>

      {/* Уведомления */}
      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" gutterBottom>
          Уведомления
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Раздел в разработке...
        </Typography>
      </Paper>

      {/* Информация о приложении */}
      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" gutterBottom>
          О приложении
        </Typography>
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            <strong>Версия:</strong> 1.0.0
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <strong>Пользователь:</strong> {userProfile?.displayName} ({userProfile?.email})
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <strong>Роль:</strong> {userProfile?.role}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <strong>Компания ID:</strong> {userProfile?.companyId}
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
};

export default SettingsPage;
