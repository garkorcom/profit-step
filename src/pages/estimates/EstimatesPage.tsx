import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Typography,
    Button,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    IconButton,
    Container,
    CircularProgress
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useAuth } from '../../auth/AuthContext';
import { estimatesApi } from '../../api/estimatesApi';
import { Estimate, EstimateStatus } from '../../types/estimate.types';

const statusColors: Record<EstimateStatus, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
    draft: 'default',
    sent: 'info',
    approved: 'success',
    rejected: 'error',
    converted: 'primary'
};

const EstimatesPage: React.FC = () => {
    const navigate = useNavigate();
    const { userProfile } = useAuth();
    const [estimates, setEstimates] = useState<Estimate[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchEstimates = async () => {
            if (!userProfile?.companyId) {
                setLoading(false);
                return;
            }
            try {
                setLoading(true);
                const data = await estimatesApi.getEstimates(userProfile.companyId);
                setEstimates(data);
            } catch (error) {
                console.error('Error loading estimates:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchEstimates();
    }, [userProfile?.companyId]);

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4">Estimates</Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => navigate('/estimates/new')}
                >
                    Create Estimate
                </Button>
            </Box>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Number</TableCell>
                            <TableCell>Client</TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell align="right">Total</TableCell>
                            <TableCell align="center">Status</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {estimates.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} align="center">
                                    <Typography variant="body1" sx={{ py: 3, color: 'text.secondary' }}>
                                        No estimates found. Create your first one!
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            estimates.map((estimate) => (
                                <TableRow key={estimate.id} hover>
                                    <TableCell>{estimate.number}</TableCell>
                                    <TableCell>{estimate.clientName}</TableCell>
                                    <TableCell>
                                        {estimate.createdAt?.toDate().toLocaleDateString()}
                                    </TableCell>
                                    <TableCell align="right">
                                        ${estimate.total.toFixed(2)}
                                    </TableCell>
                                    <TableCell align="center">
                                        <Chip
                                            label={estimate.status.toUpperCase()}
                                            color={statusColors[estimate.status]}
                                            size="small"
                                        />
                                    </TableCell>
                                    <TableCell align="right">
                                        <IconButton
                                            size="small"
                                            onClick={() => navigate(`/estimates/${estimate.id}`)}
                                            title="View/Edit"
                                        >
                                            {estimate.status === 'draft' ? <EditIcon /> : <VisibilityIcon />}
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Container>
    );
};

export default EstimatesPage;
