import React, { useMemo } from 'react';
import { Box, Typography, Button, Divider } from '@mui/material';
import { WorkSession } from '../../types/timeTracking.types';
import { format } from 'date-fns';

interface PayStubProps {
    entries: WorkSession[];
    periodLabel: string; // e.g. "March 2026"
    periodId: string;    // e.g. "2026-03"
    onClose: () => void;
    employeeIdGroups: Map<string, Set<string>>;
    uniqueEmployees: { id: string; name: string }[];
}

interface EmployeeStub {
    employeeId: string;
    employeeName: string;
    // Earnings breakdown by project
    projects: { client: string; hours: number; rate: number; amount: number }[];
    totalHours: number;
    grossPay: number;
    // Deductions
    advanceDeductions: { description: string; amount: number }[];
    totalDeductions: number;
    // Net
    netPay: number;
    // Payments
    payments: { date: string; amount: number; method: string }[];
    totalPaid: number;
    // Balance
    balance: number;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
    cash: 'Cash',
    check: 'Check',
    direct_deposit: 'Direct Deposit',
    zelle: 'Zelle',
};

export const PayStub: React.FC<PayStubProps> = ({
    entries, periodLabel, periodId, onClose, employeeIdGroups, uniqueEmployees
}) => {
    const stubs = useMemo(() => {
        // Build reverse map: raw ID → canonical ID
        const rawToCanonical = new Map<string, string>();
        employeeIdGroups.forEach((allIds, canonicalId) => {
            allIds.forEach(rawId => rawToCanonical.set(rawId, canonicalId));
        });

        const empMap: Record<string, EmployeeStub> = {};

        // Filter entries to this period (by startTime month matching periodId)
        const periodEntries = entries.filter(e => {
            if (e.isVoided) return false;
            const date = e.startTime ? new Date(e.startTime.seconds * 1000) : null;
            if (!date) return false;
            const entryPeriod = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            return entryPeriod === periodId;
        });

        periodEntries.forEach(entry => {
            const rawId = String(entry.employeeId);
            const canonicalId = rawToCanonical.get(rawId) || rawId;
            const canonicalName = uniqueEmployees.find(u => u.id === canonicalId)?.name || entry.employeeName || 'Unknown';

            if (!empMap[canonicalId]) {
                empMap[canonicalId] = {
                    employeeId: canonicalId,
                    employeeName: canonicalName,
                    projects: [],
                    totalHours: 0,
                    grossPay: 0,
                    advanceDeductions: [],
                    totalDeductions: 0,
                    netPay: 0,
                    payments: [],
                    totalPaid: 0,
                    balance: 0,
                };
            }

            const stub = empMap[canonicalId];

            if (entry.type === 'payment') {
                // Payment record
                const date = entry.startTime ? new Date(entry.startTime.seconds * 1000) : new Date();
                stub.payments.push({
                    date: format(date, 'dd.MM.yyyy'),
                    amount: Math.abs(entry.sessionEarnings || 0),
                    method: PAYMENT_METHOD_LABELS[entry.paymentMethod || ''] || 'N/A',
                });
                stub.totalPaid += Math.abs(entry.sessionEarnings || 0);
            } else if (entry.type === 'manual_adjustment' && entry.clientId === 'advance_deduction') {
                // Advance deduction
                stub.advanceDeductions.push({
                    description: entry.description || 'PO Deduction',
                    amount: Math.abs(entry.sessionEarnings || 0),
                });
                stub.totalDeductions += Math.abs(entry.sessionEarnings || 0);
            } else if (entry.type === 'correction' && entry.description?.startsWith('VOID REF:')) {
                // Skip void corrections
            } else if (entry.type === 'manual_adjustment') {
                // Other adjustments count as earnings (positive or negative)
                stub.grossPay += (entry.sessionEarnings || 0);
            } else {
                // Regular work session
                const client = entry.clientName || 'Unknown';
                const hours = (entry.durationMinutes || 0) / 60;
                const amount = entry.sessionEarnings || 0;

                // Aggregate by client
                const existing = stub.projects.find(p => p.client === client);
                if (existing) {
                    existing.hours += hours;
                    existing.amount += amount;
                } else {
                    stub.projects.push({
                        client,
                        hours,
                        rate: entry.hourlyRate || 0,
                        amount,
                    });
                }
                stub.totalHours += hours;
                stub.grossPay += amount;
            }
        });

        // Calculate net and balance
        Object.values(empMap).forEach(stub => {
            stub.netPay = parseFloat((stub.grossPay - stub.totalDeductions).toFixed(2));
            stub.balance = parseFloat((stub.netPay - stub.totalPaid).toFixed(2));
        });

        return Object.values(empMap)
            .filter(s => s.grossPay !== 0 || s.totalPaid !== 0)
            .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    }, [entries, periodId, employeeIdGroups, uniqueEmployees]);

    return (
        <Box sx={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            bgcolor: 'white', zIndex: 9999, overflow: 'auto', p: 4
        }}>
            {/* No-Print Toolbar */}
            <Box sx={{ display: 'flex', gap: 2, mb: 4, '@media print': { display: 'none' } }}>
                <Button variant="contained" onClick={() => window.print()}>Print / Save PDF</Button>
                <Button variant="outlined" onClick={onClose}>Close</Button>
            </Box>

            <Box sx={{ maxWidth: '210mm', mx: 'auto' }}>
                <Typography variant="h5" align="center" gutterBottom>
                    Pay Stubs — {periodLabel}
                </Typography>

                {stubs.map((stub) => (
                    <Box key={stub.employeeId} sx={{
                        border: '2px solid #333',
                        mb: 4,
                        p: 2,
                        pageBreakInside: 'avoid',
                    }}>
                        {/* Header */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                                {stub.employeeName}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Period: {periodLabel} ({periodId})
                            </Typography>
                        </Box>
                        <Divider sx={{ mb: 1 }} />

                        {/* Earnings by Project */}
                        <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 'bold' }}>
                            EARNINGS
                        </Typography>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '8px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #ccc' }}>
                                    <th style={{ textAlign: 'left', padding: '3px 6px' }}>Project</th>
                                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>Hours</th>
                                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>Rate</th>
                                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stub.projects.map((p, i) => (
                                    <tr key={i}>
                                        <td style={{ padding: '2px 6px' }}>{p.client}</td>
                                        <td style={{ textAlign: 'right', padding: '2px 6px' }}>{p.hours.toFixed(1)}</td>
                                        <td style={{ textAlign: 'right', padding: '2px 6px' }}>${p.rate}</td>
                                        <td style={{ textAlign: 'right', padding: '2px 6px' }}>${p.amount.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '1px solid #999', fontWeight: 'bold' }}>
                                    <td style={{ padding: '4px 6px' }}>GROSS PAY</td>
                                    <td style={{ textAlign: 'right', padding: '4px 6px' }}>{stub.totalHours.toFixed(1)}h</td>
                                    <td />
                                    <td style={{ textAlign: 'right', padding: '4px 6px' }}>${stub.grossPay.toFixed(2)}</td>
                                </tr>
                            </tfoot>
                        </table>

                        {/* Deductions */}
                        {stub.advanceDeductions.length > 0 && (
                            <>
                                <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 'bold' }}>
                                    DEDUCTIONS
                                </Typography>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '8px' }}>
                                    <tbody>
                                        {stub.advanceDeductions.map((d, i) => (
                                            <tr key={i}>
                                                <td style={{ padding: '2px 6px' }}>{d.description}</td>
                                                <td style={{ textAlign: 'right', padding: '2px 6px', color: 'red' }}>
                                                    -${d.amount.toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ borderTop: '1px solid #999', fontWeight: 'bold' }}>
                                            <td style={{ padding: '4px 6px' }}>TOTAL DEDUCTIONS</td>
                                            <td style={{ textAlign: 'right', padding: '4px 6px', color: 'red' }}>
                                                -${stub.totalDeductions.toFixed(2)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </>
                        )}

                        {/* Net Pay */}
                        <Box sx={{
                            display: 'flex', justifyContent: 'space-between',
                            bgcolor: '#f5f5f5', p: 1, borderRadius: 1, mb: 1,
                            fontWeight: 'bold', fontSize: '15px',
                        }}>
                            <span>NET PAY</span>
                            <span>${stub.netPay.toFixed(2)}</span>
                        </Box>

                        {/* Payments */}
                        {stub.payments.length > 0 && (
                            <>
                                <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 'bold' }}>
                                    PAYMENTS
                                </Typography>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '8px' }}>
                                    <tbody>
                                        {stub.payments.map((p, i) => (
                                            <tr key={i}>
                                                <td style={{ padding: '2px 6px' }}>{p.date}</td>
                                                <td style={{ padding: '2px 6px' }}>{p.method}</td>
                                                <td style={{ textAlign: 'right', padding: '2px 6px' }}>
                                                    -${p.amount.toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ borderTop: '1px solid #999', fontWeight: 'bold' }}>
                                            <td colSpan={2} style={{ padding: '4px 6px' }}>TOTAL PAID</td>
                                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                                                -${stub.totalPaid.toFixed(2)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </>
                        )}

                        {/* Balance */}
                        <Box sx={{
                            display: 'flex', justifyContent: 'space-between',
                            bgcolor: stub.balance > 0 ? '#fff3e0' : stub.balance === 0 ? '#e8f5e9' : '#fce4ec',
                            p: 1, borderRadius: 1,
                            fontWeight: 'bold', fontSize: '15px',
                        }}>
                            <span>BALANCE DUE</span>
                            <span style={{ color: stub.balance > 0 ? '#e65100' : stub.balance === 0 ? '#2e7d32' : '#c62828' }}>
                                ${stub.balance.toFixed(2)}
                            </span>
                        </Box>
                    </Box>
                ))}

                {stubs.length === 0 && (
                    <Typography align="center" color="text.secondary" sx={{ mt: 4 }}>
                        No data for this period.
                    </Typography>
                )}
            </Box>
        </Box>
    );
};
