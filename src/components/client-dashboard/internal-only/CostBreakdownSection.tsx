/**
 * Internal-only Cost/Inventory breakdown section for client dashboard.
 * Shows materials table with aggregated quantities and costs.
 */

import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  Chip,
  Table,
  TableContainer,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Build as BuildIcon } from '@mui/icons-material';

export interface InventoryRow {
  name: string;
  category: string;
  totalQty: number;
  unitPrice: number;
  totalAmount: number;
}

interface CostBreakdownSectionProps {
  loading: boolean;
  summary: InventoryRow[];
}

const CostBreakdownSection: React.FC<CostBreakdownSectionProps> = ({ loading, summary }) => {
  const total = summary.reduce((sum, i) => sum + i.totalAmount, 0);

  return (
    <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
      <Typography variant="h5" gutterBottom fontWeight="bold" color="primary">
        <BuildIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
        Materials & Inventory
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        Internal only — materials allocated and used for this client's project.
        Real-time data from inventory transactions.
      </Alert>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : summary.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h6" color="text.secondary">
            No materials allocated to this project yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Materials will appear here when inventory transactions reference this client
          </Typography>
        </Box>
      ) : (
        <>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Qty Used</TableCell>
                  <TableCell align="right">Unit Price</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summary.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>
                      <Chip label={item.category} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="right">{item.totalQty}</TableCell>
                    <TableCell align="right">${item.unitPrice.toFixed(2)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                      ${item.totalAmount.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={4} sx={{ fontWeight: 'bold', fontSize: '1.1rem', borderTop: 2 }}>
                    TOTAL MATERIALS COST
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontWeight: 'bold', fontSize: '1.1rem', borderTop: 2, color: 'error.main' }}
                  >
                    ${total.toFixed(2)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          <Paper variant="outlined" sx={{ p: 2, mt: 3, backgroundColor: '#f8f9fa' }}>
            <Typography variant="h6" gutterBottom>
              Materials Cost Summary
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="body2" color="text.secondary">
                  Total Materials Spent
                </Typography>
                <Typography variant="h6" fontWeight="bold" color="error.main">
                  ${total.toFixed(2)}
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="body2" color="text.secondary">
                  Unique Items
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {summary.length}
                </Typography>
              </Grid>
            </Grid>
          </Paper>
        </>
      )}
    </Card>
  );
};

export default CostBreakdownSection;
