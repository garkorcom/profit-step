import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Typography,
  Box,
  LinearProgress,
  Alert,
} from '@mui/material';
import {
  Warning as WarningIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';

/**
 * Cost Warning Dialog - предупреждает пользователя о высоком использовании Firestore
 *
 * Показывается когда:
 * - totalReads > warningThreshold (1000)
 * - До достижения hardLimit (5000)
 *
 * Позволяет:
 * - Продолжить работу (на свой риск)
 * - Сбросить сессию (перезагрузка страницы)
 */

interface CostWarningDialogProps {
  /** Показывать ли диалог */
  open: boolean;
  /** Текущее количество reads */
  currentReads: number;
  /** Оценочная стоимость */
  estimatedCost: number;
  /** Warning threshold (обычно 1000) */
  warningThreshold?: number;
  /** Hard limit (обычно 5000) */
  hardLimit?: number;
  /** Callback при закрытии */
  onClose: () => void;
  /** Callback при сбросе сессии */
  onReset: () => void;
}

export default function CostWarningDialog({
  open,
  currentReads,
  estimatedCost,
  warningThreshold = 1000,
  hardLimit = 5000,
  onClose,
  onReset,
}: CostWarningDialogProps) {
  // Рассчитываем процент использования
  const utilizationPercent = (currentReads / hardLimit) * 100;
  const isNearLimit = utilizationPercent > 80;
  const isCritical = utilizationPercent > 95;

  // Цвет прогресс-бара в зависимости от уровня
  const progressColor = isCritical ? 'error' : isNearLimit ? 'warning' : 'primary';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderTop: `4px solid`,
          borderColor: isCritical ? 'error.main' : 'warning.main',
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningIcon color={isCritical ? 'error' : 'warning'} />
        <Box>
          {isCritical ? 'Critical' : 'High'} Firestore Usage
        </Box>
      </DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {isCritical
            ? 'You are approaching the session read limit. Consider refreshing the page.'
            : 'High Firestore read usage detected in this session.'}
        </DialogContentText>

        {/* Progress Bar */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Session Usage
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {utilizationPercent.toFixed(1)}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.min(utilizationPercent, 100)}
            color={progressColor}
            sx={{ height: 8, borderRadius: 4 }}
          />
        </Box>

        {/* Statistics */}
        <Box
          sx={{
            p: 2,
            bgcolor: 'background.default',
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2">Current Reads:</Typography>
            <Typography variant="body2" fontWeight="bold">
              {currentReads.toLocaleString()} / {hardLimit.toLocaleString()}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2">Estimated Cost:</Typography>
            <Typography variant="body2" fontWeight="bold" color="primary">
              ${estimatedCost.toFixed(4)}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2">Reads Remaining:</Typography>
            <Typography variant="body2" fontWeight="bold">
              {Math.max(0, hardLimit - currentReads).toLocaleString()}
            </Typography>
          </Box>
        </Box>

        {/* Warning Alert */}
        {isCritical && (
          <Alert severity="error" sx={{ mt: 2 }}>
            <Typography variant="body2" fontWeight="bold">
              Critical Threshold Exceeded!
            </Typography>
            <Typography variant="caption">
              Firestore queries will be blocked at {hardLimit.toLocaleString()} reads.
              Please refresh the page to continue.
            </Typography>
          </Alert>
        )}

        {/* Tips */}
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5}>
            <TrendingUpIcon fontSize="small" />
            Tip: Use filters and search to reduce queries. Page caching helps avoid repeated reads.
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={isCritical}>
          Continue
        </Button>
        <Button
          onClick={onReset}
          variant="contained"
          color={isCritical ? 'error' : 'warning'}
          autoFocus={isCritical}
        >
          {isCritical ? 'Reset Now' : 'Reset Session'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
