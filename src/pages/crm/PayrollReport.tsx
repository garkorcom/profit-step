import React, { useMemo } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { WorkSession } from '../../types/timeTracking.types';
import { format } from 'date-fns';

interface PayrollReportProps {
    entries: WorkSession[];
    onClose: () => void;
    employeeIdGroups: Map<string, Set<string>>;
    uniqueEmployees: { id: string; name: string }[];
}

interface ProjectStats {
    client: string;
    hours: number;
    hourlyRate: number;
    money: number;
}

interface EmployeeMonthStats {
    employeeId: string;
    employeeName: string;
    projects: Record<string, ProjectStats>; // Keyed by ClientName
    totalHours: number;
    totalMoney: number;
}

interface MonthGroup {
    monthLabel: string; // e.g. "Nov.25"
    employees: Record<string, EmployeeMonthStats>;
}

export const PayrollReport: React.FC<PayrollReportProps> = ({ entries, onClose, employeeIdGroups, uniqueEmployees }) => {

    const reportData = useMemo(() => {
        // Build reverse map: any raw ID → canonical ID
        const rawToCanonical = new Map<string, string>();
        employeeIdGroups.forEach((allIds, canonicalId) => {
            allIds.forEach(rawId => rawToCanonical.set(rawId, canonicalId));
        });

        const months: Record<string, MonthGroup> = {};

        entries.forEach(entry => {
            if (entry.isVoided) return; // Skip voided in report

            const date = entry.startTime ? new Date(entry.startTime.seconds * 1000) : new Date();
            const monthKey = format(date, 'yyyy-MM'); // Sortable key
            const monthLabel = format(date, 'MMM.yy').toLowerCase();
            const rawId = String(entry.employeeId);
            const canonicalId = rawToCanonical.get(rawId) || rawId;
            const canonicalName = uniqueEmployees.find(u => u.id === canonicalId)?.name || entry.employeeName || 'Unknown';
            const client = entry.clientName || 'Unknown';

            if (!months[monthKey]) {
                months[monthKey] = { monthLabel, employees: {} };
            }

            const monthGroup = months[monthKey];

            if (!monthGroup.employees[canonicalId]) {
                monthGroup.employees[canonicalId] = {
                    employeeId: canonicalId,
                    employeeName: canonicalName,
                    projects: {},
                    totalHours: 0,
                    totalMoney: 0
                };
            }

            const empStats = monthGroup.employees[canonicalId];

            if (!empStats.projects[client]) {
                empStats.projects[client] = {
                    client,
                    hours: 0,
                    hourlyRate: entry.hourlyRate || 0,
                    money: 0
                };
            }

            const projStats = empStats.projects[client];

            const duration = (entry.durationMinutes || 0) / 60;
            const money = entry.sessionEarnings || 0;

            projStats.hours += duration;
            projStats.money += money;

            if (projStats.hourlyRate === 0 && entry.hourlyRate) {
                projStats.hourlyRate = entry.hourlyRate;
            }

            empStats.totalHours += duration;
            empStats.totalMoney += money;
        });

        // Sort by chronological key (yyyy-MM)
        return Object.entries(months)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, group]) => group);

    }, [entries, employeeIdGroups, uniqueEmployees]);

    const handlePrint = () => {
        window.print();
    };

    return (
        <Box sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'white',
            zIndex: 9999,
            overflow: 'auto',
            p: 4
        }}>
            {/* No-Print Toolbar */}
            <Box sx={{ display: 'flex', gap: 2, mb: 4, '@media print': { display: 'none' } }}>
                <Button variant="contained" onClick={handlePrint}>Print / Save PDF</Button>
                <Button variant="outlined" onClick={onClose}>Close</Button>
            </Box>

            <Box sx={{ maxWidth: '210mm', mx: 'auto' }}>
                {reportData.map((month) => (
                    <Box key={month.monthLabel} sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, mb: 4 }}>
                        {Object.values(month.employees).sort((a, b) => a.employeeName.localeCompare(b.employeeName)).map(emp => (
                            <Box key={emp.employeeId} sx={{
                                width: 'calc(50% - 16px)', // 2 columns
                                minWidth: 300,
                                border: '1px solid black',
                                p: 0,
                                mb: 2,
                                pageBreakInside: 'avoid'
                            }}>
                                {/* Header: Month | Name | ID/Total? */}
                                <Box sx={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    p: 1,
                                    borderBottom: '2px solid black'
                                }}>
                                    <Typography variant="body1" sx={{ textDecoration: 'underline' }}>{month.monthLabel}</Typography>
                                    <Box sx={{ border: '2px solid black', px: 1, fontWeight: 'bold' }}>
                                        {emp.employeeName.toUpperCase()}
                                    </Box>
                                    <Typography variant="body1">{/* ID or just empty? Photo has '25' */}</Typography>
                                </Box>

                                {/* Table */}
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid black' }}>
                                            <th style={{ textAlign: 'left', padding: '4px' }}>Проект</th>
                                            <th style={{ textAlign: 'right', padding: '4px' }}>Часов</th>
                                            <th style={{ textAlign: 'right', padding: '4px' }}>Тариф</th>
                                            <th style={{ textAlign: 'right', padding: '4px' }}>Начисления</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.values(emp.projects).map(proj => (
                                            <tr key={proj.client}>
                                                <td style={{ padding: '4px' }}>{proj.client}</td>
                                                <td style={{ textAlign: 'right', padding: '4px' }}>{Number(proj.hours).toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>
                                                <td style={{ textAlign: 'right', padding: '4px' }}>{proj.hourlyRate}</td>
                                                <td style={{ textAlign: 'right', padding: '4px' }}>{Math.round(proj.money).toLocaleString()} $</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ borderTop: '2px solid black', fontWeight: 'bold' }}>
                                            <td style={{ padding: '8px 4px' }}>ИТОГО:</td>
                                            <td style={{ textAlign: 'right', padding: '8px 4px' }}>{emp.totalHours.toFixed(1)} час</td>
                                            <td />
                                            <td style={{ textAlign: 'right', padding: '8px 4px' }}>{Math.round(emp.totalMoney).toLocaleString()} $</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </Box>
                        ))}
                    </Box>
                ))}
            </Box>
        </Box>
    );
};
