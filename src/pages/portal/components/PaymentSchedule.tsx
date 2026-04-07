import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from '@mui/material';

export interface PaymentItem {
  stage: string;
  amount: number;
  percentage: number;
  status: 'paid' | 'pending' | 'upcoming' | 'overdue';
  dueDate: string;
}

interface PaymentScheduleProps {
  payments: PaymentItem[];
  totalEstimate: string;
}

const getPaymentStatusColor = (status: string) => {
  switch (status) {
    case 'paid': return '#4caf50';
    case 'pending': return '#ff9800';
    case 'upcoming': return '#9e9e9e';
    case 'overdue': return '#f44336';
    default: return '#9e9e9e';
  }
};

const PaymentSchedule: React.FC<PaymentScheduleProps> = ({ payments, totalEstimate }) => {
  const totalPaid = payments
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0);
  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  const paidPercent = totalAmount > 0 ? (totalPaid / totalAmount) * 100 : 0;

  const nextPayment = payments.find(p => p.status === 'pending' || p.status === 'upcoming');

  return (
    <Card elevation={2} sx={{ borderRadius: 2 }}>
      <CardContent>
        <Typography variant="h5" gutterBottom fontWeight="bold">
          Payment Schedule
        </Typography>

        {/* Payment progress bar */}
        <Box sx={{ mb: 3, p: 2, backgroundColor: '#f5f7fa', borderRadius: 1 }}>
          <Box display="flex" justifyContent="space-between" mb={1}>
            <Typography variant="body2" fontWeight="medium">
              Paid: ${totalPaid.toLocaleString()}
            </Typography>
            <Typography variant="body2" fontWeight="medium">
              Total: {totalEstimate}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={paidPercent}
            sx={{ height: 12, borderRadius: 6, backgroundColor: '#e0e0e0' }}
            color="success"
          />
          <Box display="flex" justifyContent="space-between" mt={0.5}>
            <Typography variant="caption" color="text.secondary">
              {paidPercent.toFixed(0)}% paid
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ${(totalAmount - totalPaid).toLocaleString()} remaining
            </Typography>
          </Box>
        </Box>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Payment Stage</TableCell>
                <TableCell align="center">Percentage</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="center" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Due Date</TableCell>
                <TableCell align="center">Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {payments.map((payment, index) => (
                <TableRow key={index}>
                  <TableCell>{payment.stage}</TableCell>
                  <TableCell align="center">{payment.percentage}%</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    ${payment.amount.toLocaleString()}
                  </TableCell>
                  <TableCell align="center" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    {payment.dueDate}
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={payment.status}
                      size="small"
                      sx={{
                        backgroundColor: getPaymentStatusColor(payment.status),
                        color: 'white',
                        textTransform: 'capitalize',
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {nextPayment && (
          <Box mt={3} p={2} sx={{ backgroundColor: '#f0f9f0', borderRadius: 1 }}>
            <Typography variant="body1" fontWeight="bold" color="success.dark">
              Next Payment Due: ${nextPayment.amount.toLocaleString()} on {nextPayment.dueDate}
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={1}>
              {nextPayment.stage}
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default PaymentSchedule;
