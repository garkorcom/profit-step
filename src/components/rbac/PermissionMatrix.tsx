/**
 * @fileoverview Компонент матрицы прав доступа
 * 
 * Отображает таблицу: строки = сущности (deals, tasks, etc),
 * колонки = действия (read, create, update, delete, export)
 */

import React from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Select,
    MenuItem,
    Checkbox,
    Typography,
    Chip,
} from '@mui/material';
import {
    Permission,
    PermissionEntity,
    AccessLevel,
} from '../../types/rbac.types';

interface PermissionMatrixProps {
    /** Текущие разрешения */
    permissions: Permission[];

    /** Callback при изменении */
    onChange: (permissions: Permission[]) => void;

    /** Только чтение */
    readOnly?: boolean;
}

const ENTITY_LABELS: Record<PermissionEntity, string> = {
    deals: 'Сделки',
    contacts: 'Контакты',
    tasks: 'Задачи',
    estimates: 'Сметы',
    finance: 'Финансы',
    team: 'Команда',
    reports: 'Отчёты',
};

const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
    none: 'Нет',
    own: 'Свои',
    department: 'Отдел',
    team: 'Команда',
    all: 'Все',
};

const ACCESS_LEVEL_COLORS: Record<AccessLevel, 'default' | 'primary' | 'secondary' | 'success' | 'error'> = {
    none: 'error',
    own: 'default',
    department: 'secondary',
    team: 'primary',
    all: 'success',
};

const PermissionMatrix: React.FC<PermissionMatrixProps> = ({
    permissions,
    onChange,
    readOnly = false,
}) => {
    const handleAccessChange = (entity: PermissionEntity, field: 'read' | 'update', value: AccessLevel) => {
        const updated = permissions.map(p =>
            p.entity === entity ? { ...p, [field]: value } : p
        );
        onChange(updated);
    };

    const handleBooleanChange = (entity: PermissionEntity, field: 'create' | 'delete' | 'export', value: boolean) => {
        const updated = permissions.map(p =>
            p.entity === entity ? { ...p, [field]: value } : p
        );
        onChange(updated);
    };

    const getPermission = (entity: PermissionEntity): Permission => {
        return permissions.find(p => p.entity === entity) || {
            entity,
            read: 'none',
            create: false,
            update: 'none',
            delete: false,
            export: false,
        };
    };

    return (
        <TableContainer component={Paper} variant="outlined">
            <Table size="small">
                <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.100' }}>
                        <TableCell><strong>Сущность</strong></TableCell>
                        <TableCell align="center"><strong>Просмотр</strong></TableCell>
                        <TableCell align="center"><strong>Создание</strong></TableCell>
                        <TableCell align="center"><strong>Редактирование</strong></TableCell>
                        <TableCell align="center"><strong>Удаление</strong></TableCell>
                        <TableCell align="center"><strong>Экспорт</strong></TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {(Object.keys(ENTITY_LABELS) as PermissionEntity[]).map((entity) => {
                        const perm = getPermission(entity);

                        return (
                            <TableRow key={entity} hover>
                                <TableCell>
                                    <Typography variant="body2" fontWeight={500}>
                                        {ENTITY_LABELS[entity]}
                                    </Typography>
                                </TableCell>

                                {/* Read */}
                                <TableCell align="center">
                                    {readOnly ? (
                                        <Chip
                                            label={ACCESS_LEVEL_LABELS[perm.read]}
                                            size="small"
                                            color={ACCESS_LEVEL_COLORS[perm.read]}
                                        />
                                    ) : (
                                        <Select
                                            value={perm.read}
                                            onChange={(e) => handleAccessChange(entity, 'read', e.target.value as AccessLevel)}
                                            size="small"
                                            sx={{ minWidth: 100 }}
                                        >
                                            {(Object.keys(ACCESS_LEVEL_LABELS) as AccessLevel[]).map((level) => (
                                                <MenuItem key={level} value={level}>
                                                    {ACCESS_LEVEL_LABELS[level]}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    )}
                                </TableCell>

                                {/* Create */}
                                <TableCell align="center">
                                    <Checkbox
                                        checked={perm.create}
                                        onChange={(e) => handleBooleanChange(entity, 'create', e.target.checked)}
                                        disabled={readOnly}
                                        size="small"
                                    />
                                </TableCell>

                                {/* Update */}
                                <TableCell align="center">
                                    {readOnly ? (
                                        <Chip
                                            label={ACCESS_LEVEL_LABELS[perm.update]}
                                            size="small"
                                            color={ACCESS_LEVEL_COLORS[perm.update]}
                                        />
                                    ) : (
                                        <Select
                                            value={perm.update}
                                            onChange={(e) => handleAccessChange(entity, 'update', e.target.value as AccessLevel)}
                                            size="small"
                                            sx={{ minWidth: 100 }}
                                        >
                                            {(Object.keys(ACCESS_LEVEL_LABELS) as AccessLevel[]).map((level) => (
                                                <MenuItem key={level} value={level}>
                                                    {ACCESS_LEVEL_LABELS[level]}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    )}
                                </TableCell>

                                {/* Delete */}
                                <TableCell align="center">
                                    <Checkbox
                                        checked={perm.delete}
                                        onChange={(e) => handleBooleanChange(entity, 'delete', e.target.checked)}
                                        disabled={readOnly}
                                        size="small"
                                    />
                                </TableCell>

                                {/* Export */}
                                <TableCell align="center">
                                    <Checkbox
                                        checked={perm.export}
                                        onChange={(e) => handleBooleanChange(entity, 'export', e.target.checked)}
                                        disabled={readOnly}
                                        size="small"
                                    />
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default PermissionMatrix;
