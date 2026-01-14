import React from 'react';
import { Box, Paper, TextField, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { format } from 'date-fns';

interface TimeTrackingFiltersProps {
    startDate: Date;
    endDate: Date;
    filterStatus: string;
    filterEmployee: string;
    filterClient: string;
    uniqueEmployees: string[];
    uniqueClients: string[];
    onStartDateChange: (date: Date) => void;
    onEndDateChange: (date: Date) => void;
    onStatusChange: (status: string) => void;
    onEmployeeChange: (employee: string) => void;
    onClientChange: (client: string) => void;
}

/**
 * Filter bar for Time Tracking page
 * Contains date range, status, employee, and client filters
 */
const TimeTrackingFilters: React.FC<TimeTrackingFiltersProps> = ({
    startDate,
    endDate,
    filterStatus,
    filterEmployee,
    filterClient,
    uniqueEmployees,
    uniqueClients,
    onStartDateChange,
    onEndDateChange,
    onStatusChange,
    onEmployeeChange,
    onClientChange
}) => {
    return (
        <Paper sx={{ p: 2, mb: 4 }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                {/* Start Date */}
                <Box sx={{ flex: '1 1 200px' }}>
                    <TextField
                        label="Start Date"
                        type="date"
                        fullWidth
                        size="small"
                        value={format(startDate, 'yyyy-MM-dd')}
                        onChange={(e) => onStartDateChange(e.target.value ? new Date(e.target.value) : new Date())}
                        InputLabelProps={{ shrink: true }}
                    />
                </Box>

                {/* End Date */}
                <Box sx={{ flex: '1 1 200px' }}>
                    <TextField
                        label="End Date"
                        type="date"
                        fullWidth
                        size="small"
                        value={format(endDate, 'yyyy-MM-dd')}
                        onChange={(e) => onEndDateChange(e.target.value ? new Date(e.target.value) : new Date())}
                        InputLabelProps={{ shrink: true }}
                    />
                </Box>

                {/* Status Filter */}
                <Box sx={{ flex: '1 1 150px' }}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Status</InputLabel>
                        <Select
                            value={filterStatus}
                            label="Status"
                            onChange={(e) => onStatusChange(e.target.value)}
                        >
                            <MenuItem value="all">All Statuses</MenuItem>
                            <MenuItem value="active">🟢 Active</MenuItem>
                            <MenuItem value="completed">✅ Completed</MenuItem>
                            <MenuItem value="paused">⏸️ Paused</MenuItem>
                            <MenuItem value="awaiting_review">⏳ Awaiting Review</MenuItem>
                            <MenuItem value="auto_closed">🔴 Auto-Closed</MenuItem>
                            <MenuItem value="edited">🔴 Edited</MenuItem>
                        </Select>
                    </FormControl>
                </Box>

                {/* Employee Filter */}
                <Box sx={{ flex: '1 1 150px' }}>
                    <TextField
                        select
                        label="Employee"
                        fullWidth
                        size="small"
                        value={filterEmployee}
                        onChange={(e) => onEmployeeChange(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        SelectProps={{ displayEmpty: true }}
                    >
                        <MenuItem value="">All Employees</MenuItem>
                        {uniqueEmployees.map(name => (
                            <MenuItem key={name} value={name}>{name}</MenuItem>
                        ))}
                    </TextField>
                </Box>

                {/* Client Filter */}
                <Box sx={{ flex: '1 1 150px' }}>
                    <TextField
                        select
                        label="Client / Project"
                        fullWidth
                        size="small"
                        value={filterClient}
                        onChange={(e) => onClientChange(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        SelectProps={{ displayEmpty: true }}
                    >
                        <MenuItem value="">All Clients</MenuItem>
                        {uniqueClients.map(name => (
                            <MenuItem key={name} value={name}>{name}</MenuItem>
                        ))}
                    </TextField>
                </Box>
            </Box>
        </Paper>
    );
};

export default TimeTrackingFilters;
