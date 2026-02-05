/**
 * AI Reports Page
 * 
 * Standalone page for AI-powered analytics:
 * - Итоги недели (Work Summary)
 * - План на сегодня (AI Day Plan)  
 * - Время (Active Session / Today)
 */

import React from 'react';
import { Container, Typography, Box, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import AIReportsSection from '../components/dashboard/AIReportsSection';

const AIReportsPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <Box sx={{ py: 3 }}>
            <Container maxWidth="lg">
                {/* Header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <Button
                        startIcon={<ArrowBackIcon />}
                        onClick={() => navigate(-1)}
                        sx={{ minWidth: 'auto' }}
                    >
                        Назад
                    </Button>
                    <Typography variant="h4" fontWeight="bold">
                        🤖 AI Отчёты
                    </Typography>
                </Box>

                {/* AI Reports Section */}
                <AIReportsSection />

                {/* Additional Info */}
                <Box sx={{ mt: 4, p: 3, bgcolor: 'background.paper', borderRadius: 2 }}>
                    <Typography variant="h6" gutterBottom>
                        💡 Подсказки
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        • <strong>Итоги</strong> — суммарные часы за последние 7 дней
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        • <strong>Планы</strong> — AI-генерированный план на день из ваших задач
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        • <strong>Время</strong> — текущая активная сессия или сегодняшнее время
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        📱 Также доступно в Telegram: отправьте <code>/plan</code> боту
                    </Typography>
                </Box>
            </Container>
        </Box>
    );
};

export default AIReportsPage;
