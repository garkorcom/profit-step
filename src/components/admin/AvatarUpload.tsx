import React, { useState } from 'react';
import {
  Box,
  Avatar,
  IconButton,
  CircularProgress,
  Alert,
  LinearProgress,
  Typography,
} from '@mui/material';
import { PhotoCamera, Delete as DeleteIcon } from '@mui/icons-material';
import { uploadAvatar, deleteAvatar } from '../../api/avatarApi';
import { useAuth } from '../../auth/AuthContext';

const AvatarUpload: React.FC = () => {
  const { userProfile } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setSuccess(null);
    setProgress(0);

    try {
      const result = await uploadAvatar(file, (progress) => {
        setProgress(progress);
      });

      if (result.success) {
        setSuccess(result.message);
        // Обновление UI произойдет автоматически через AuthContext
        // когда функция обновит Firestore
      } else {
        setError(result.error || 'Ошибка загрузки');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Удалить аватар?')) return;

    setUploading(true);
    setError(null);

    try {
      const result = await deleteAvatar();
      if (result.success) {
        setSuccess('Аватар удален');
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      {/* Avatar */}
      <Box sx={{ position: 'relative' }}>
        <Avatar
          src={userProfile?.photoURL || undefined}
          alt={userProfile?.displayName}
          sx={{ width: 120, height: 120 }}
        >
          {userProfile?.displayName?.charAt(0).toUpperCase()}
        </Avatar>

        {/* Overlay с кнопками */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            display: 'flex',
            gap: 1,
          }}
        >
          {/* Кнопка загрузки */}
          <IconButton
            component="label"
            disabled={uploading}
            sx={{
              bgcolor: 'primary.main',
              color: 'white',
              '&:hover': { bgcolor: 'primary.dark' },
            }}
          >
            <PhotoCamera />
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={handleFileSelect}
            />
          </IconButton>

          {/* Кнопка удаления */}
          {userProfile?.photoURL && (
            <IconButton
              onClick={handleDelete}
              disabled={uploading}
              sx={{
                bgcolor: 'error.main',
                color: 'white',
                '&:hover': { bgcolor: 'error.dark' },
              }}
            >
              <DeleteIcon />
            </IconButton>
          )}
        </Box>

        {/* Индикатор загрузки */}
        {uploading && (
          <CircularProgress
            size={120}
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          />
        )}
      </Box>

      {/* Прогресс бар */}
      {uploading && progress > 0 && (
        <Box sx={{ width: '100%' }}>
          <LinearProgress variant="determinate" value={progress} />
          <Typography variant="caption" sx={{ textAlign: 'center', display: 'block', mt: 1 }}>
            {progress}%
          </Typography>
        </Box>
      )}

      {/* Сообщения */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ width: '100%' }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ width: '100%' }}>
          {success}
        </Alert>
      )}
    </Box>
  );
};

export default AvatarUpload;
