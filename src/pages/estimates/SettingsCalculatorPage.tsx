import React from 'react';
import { Container, Typography, Paper, Box, Alert, Button } from '@mui/material';
import { Settings as SettingsIcon, ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

const SettingsCalculatorPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
            <Box display="flex" alignItems="center" gap={2} mb={3}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} variant="outlined">
                    Назад
                </Button>
                <Typography variant="h4" display="flex" alignItems="center" gap={1}>
                    <SettingsIcon fontSize="large" color="primary" />
                    Calculator Settings
                </Typography>
            </Box>

            <Paper sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="h6" gutterBottom color="text.secondary">
                    Mapping Rules Configuration
                </Typography>

                <Alert severity="info" sx={{ mt: 2, textAlign: 'left' }}>
                    <strong>Note:</strong> Advanced dictionary mapping and custom AI overrides will be fully implemented in Sprint 3.
                    For now, any unmatched AI items will trigger an interactive mapping dialog directly inside the Estimator.
                </Alert>
            </Paper>
        </Container>
    );
};

export default SettingsCalculatorPage;
