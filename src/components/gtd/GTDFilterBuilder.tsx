import React, { useState, useEffect } from 'react';
import {
    Box,
    Button,
    IconButton,
    MenuItem,
    Select,
    Typography,
    Paper,
    FormControl,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import { GTDStatus, GTD_COLUMNS, GTDPriority, PRIORITY_COLORS } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';

// Types
export type FilterProperty = 'status' | 'client' | 'priority' | 'assignee';
export type FilterOperator = 'is' | 'is_not' | 'contains';

export interface FilterConfig {
    id: string;
    property: FilterProperty;
    operator: FilterOperator;
    value: string;
}

interface GTDFilterBuilderProps {
    filters: FilterConfig[];
    onChange: (filters: FilterConfig[]) => void;
    clients: Client[];
}

const PROPERTY_OPTIONS: { value: FilterProperty; label: string }[] = [
    { value: 'status', label: 'Status' },
    { value: 'client', label: 'Client' },
    { value: 'priority', label: 'Priority' },
];

const OPERATOR_OPTIONS: { value: FilterOperator; label: string }[] = [
    { value: 'is', label: 'Is' },
    { value: 'is_not', label: 'Is not' },
];

const GTDFilterBuilder: React.FC<GTDFilterBuilderProps> = ({ filters, onChange, clients }) => {

    const handleAddFilter = () => {
        const newFilter: FilterConfig = {
            id: Math.random().toString(36).substr(2, 9),
            property: 'status',
            operator: 'is',
            value: 'inbox'
        };
        onChange([...filters, newFilter]);
    };

    const handleRemoveFilter = (id: string) => {
        onChange(filters.filter(f => f.id !== id));
    };

    const handleUpdateFilter = (id: string, field: keyof FilterConfig, value: string) => {
        onChange(filters.map(f => {
            if (f.id !== id) return f;

            // Handle property change with proper typing
            if (field === 'property') {
                const newProperty = value as FilterProperty;
                return {
                    ...f,
                    property: newProperty,
                    value: newProperty === 'status' ? 'inbox' : (newProperty === 'priority' ? 'high' : '')
                };
            }

            // Handle operator change
            if (field === 'operator') {
                return { ...f, operator: value as FilterOperator };
            }

            // Handle value change
            return { ...f, value };
        }));
    };

    const renderValueInput = (filter: FilterConfig) => {
        switch (filter.property) {
            case 'status':
                return (
                    <Select
                        value={filter.value}
                        size="small"
                        onChange={(e) => handleUpdateFilter(filter.id, 'value', e.target.value)}
                        sx={{ minWidth: 120, fontSize: '0.875rem' }}
                    >
                        {GTD_COLUMNS.map(col => (
                            <MenuItem key={col.id} value={col.id}>{col.title}</MenuItem>
                        ))}
                    </Select>
                );
            case 'client':
                return (
                    <Select
                        value={filter.value}
                        size="small"
                        displayEmpty
                        onChange={(e) => handleUpdateFilter(filter.id, 'value', e.target.value)}
                        sx={{ minWidth: 120, fontSize: '0.875rem' }}
                    >
                        <MenuItem value=""><em>Select Client</em></MenuItem>
                        {clients.map(client => (
                            <MenuItem key={client.id} value={client.id}>{client.name}</MenuItem>
                        ))}
                    </Select>
                );
            case 'priority':
                return (
                    <Select
                        value={filter.value}
                        size="small"
                        onChange={(e) => handleUpdateFilter(filter.id, 'value', e.target.value)}
                        sx={{ minWidth: 120, fontSize: '0.875rem' }}
                    >
                        <MenuItem value="high">High</MenuItem>
                        <MenuItem value="medium">Medium</MenuItem>
                        <MenuItem value="low">Low</MenuItem>
                        <MenuItem value="none">None</MenuItem>
                    </Select>
                );
            default:
                return null;
        }
    };

    return (
        <Box sx={{ p: 2, minWidth: 400 }}>
            {/* Header */}
            <Typography variant="subtitle2" color="text.secondary" mb={2}>
                {filters.length > 0 ? `Filters applied: ${filters.length}` : 'No active filters'}
            </Typography>

            {/* Filter List */}
            <Box display="flex" flexDirection="column" gap={1.5} mb={2}>
                {filters.map((filter, index) => (
                    <Box key={filter.id} display="flex" alignItems="center" gap={1}>
                        <Typography variant="caption" color="text.disabled" sx={{ minWidth: 30 }}>
                            {index === 0 ? 'Where' : 'And'}
                        </Typography>

                        {/* Property */}
                        <FormControl size="small">
                            <Select
                                value={filter.property}
                                onChange={(e) => handleUpdateFilter(filter.id, 'property', e.target.value as any)}
                                sx={{ minWidth: 100, fontSize: '0.875rem', bgcolor: 'white' }}
                            >
                                {PROPERTY_OPTIONS.map(opt => (
                                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {/* Operator */}
                        <FormControl size="small">
                            <Select
                                value={filter.operator}
                                onChange={(e) => handleUpdateFilter(filter.id, 'operator', e.target.value as any)}
                                sx={{ minWidth: 80, fontSize: '0.875rem', bgcolor: 'white' }}
                            >
                                {OPERATOR_OPTIONS.map(opt => (
                                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {/* Value */}
                        <FormControl size="small" sx={{ flexGrow: 1 }}>
                            {renderValueInput(filter)}
                        </FormControl>

                        {/* Delete */}
                        <IconButton size="small" onClick={() => handleRemoveFilter(filter.id)}>
                            <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                    </Box>
                ))}
            </Box>

            {/* Add Button */}
            <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={handleAddFilter}
                sx={{
                    textTransform: 'none',
                    color: '#6B7280',
                    '&:hover': { bgcolor: '#F3F4F6' }
                }}
            >
                Add filter
            </Button>
        </Box>
    );
};

export default GTDFilterBuilder;
