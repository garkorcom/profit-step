import React from 'react';
import { Box, Typography, Container, Button } from '@mui/material';
import GTDBoard from '../../components/gtd/GTDBoard';

const GTDPage: React.FC = () => {
    return (
        <Container maxWidth="xl" sx={{ height: '100vh', display: 'flex', flexDirection: 'column', py: 2 }}>
            <Box mb={2} display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                    <Typography variant="h4" fontWeight="bold">Lookahead Schedule</Typography>
                    <Typography variant="body2" color="text.secondary">
                        GTD Planning: Drag tasks across stages. Move to 'Next Actions' to start working.
                    </Typography>
                </Box>
            </Box>

            <Box flexGrow={1} sx={{ overflow: 'hidden' }}>
                <GTDBoard />
            </Box>
        </Container>
    );
};

export default GTDPage;
