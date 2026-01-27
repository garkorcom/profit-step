/**
 * @fileoverview GTD Page
 * 
 * Lookahead Schedule page - tasks board only.
 * Shopping functionality moved to dedicated /crm/shopping page.
 */

import React from 'react';
import {
    Box,
    Typography,
    Container,
    Button,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import GTDBoard from '../../components/gtd/GTDBoard';

const GTDPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <Container maxWidth={false} sx={{ height: '100vh', display: 'flex', flexDirection: 'column', py: 2 }}>
            {/* Header */}
            <Box mb={2} display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                    <Typography variant="h4" fontWeight="bold">Lookahead Schedule</Typography>
                    <Typography variant="body2" color="text.secondary">
                        GTD Planning: Drag tasks across stages. Move to 'Next Actions' to start working.
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Button
                        variant="contained"
                        color="success"
                        startIcon={<ShoppingCartIcon />}
                        onClick={() => navigate('/crm/shopping')}
                    >
                        Закупки
                    </Button>

                    <Button
                        variant="outlined"
                        startIcon={<CalendarMonthIcon />}
                        onClick={() => navigate('/crm/calendar')}
                    >
                        Calendar
                    </Button>
                </Box>
            </Box>

            {/* Content */}
            <Box flexGrow={1} sx={{ overflow: 'hidden' }}>
                <GTDBoard />
            </Box>
        </Container>
    );
};

export default GTDPage;

