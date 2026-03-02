import React from 'react';
import { Box, Typography, Paper, Alert } from '@mui/material';

export const ExpensesTab: React.FC = () => {
    return (
        <Box sx={{ mt: 3 }}>
            <Alert severity="info" sx={{ mb: 3 }}>
                Модуль расходов (Expenses) находится в разработке. Ожидается полное ТЗ-1.2.
            </Alert>
            <Paper sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="textSecondary" variant="h6">
                    Вскоре здесь появится полноценный учет категорий расходов.
                </Typography>
            </Paper>
        </Box>
    );
};
