/**
 * @fileoverview Компонент выбора пользователя с отображением иерархии
 * 
 * Показывает древовидную структуру организации с отступами,
 * позволяя выбрать пользователя из списка.
 */

import React, { useState, useEffect } from 'react';
import {
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ListItemText,
    ListItemIcon,
    Avatar,
    Box,
    CircularProgress,
    Chip,
    SelectChangeEvent,
} from '@mui/material';
import {
    Person as PersonIcon,
    Group as GroupIcon,
} from '@mui/icons-material';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { UserProfile } from '../../types/user.types';
import { buildOrgTree, flattenOrgTree } from '../../utils/hierarchyUtils';
interface OrgChartSelectProps {
    /** Выбранный пользователь ID */
    value: string;

    /** Callback при изменении */
    onChange: (userId: string) => void;

    /** Label для FormControl */
    label?: string;

    /** Показывать только активных */
    activeOnly?: boolean;

    /** Показывать только пользователей с подчинёнными (менеджеров) */
    managersOnly?: boolean;

    /** Исключить этих пользователей */
    excludeIds?: string[];

    /** Показывать опцию "Все" */
    showAllOption?: boolean;

    /** Disabled */
    disabled?: boolean;

    /** Размер */
    size?: 'small' | 'medium';
}

/**
 * Компонент выбора пользователя с иерархией
 */
const OrgChartSelect: React.FC<OrgChartSelectProps> = ({
    value,
    onChange,
    label = 'Сотрудник',
    activeOnly = true,
    managersOnly = false,
    excludeIds = [],
    showAllOption = false,
    disabled = false,
    size = 'medium',
}) => {
    const { userProfile } = useAuth();
    const [loading, setLoading] = useState(true);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [flatList, setFlatList] = useState<Array<{ id: string; displayName: string; depth: number }>>([]);

    // Загрузка данных
    useEffect(() => {
        const loadUsers = async () => {
            if (!userProfile?.companyId) {
                setLoading(false);
                return;
            }

            setLoading(true);
            try {
                const usersRef = collection(db, 'users');
                let q = query(usersRef, where('companyId', '==', userProfile.companyId));

                if (activeOnly) {
                    q = query(q, where('status', '==', 'active'));
                }

                const snapshot = await getDocs(q);
                let allUsers = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as UserProfile));

                // Фильтруем по excludeIds
                if (excludeIds.length > 0) {
                    allUsers = allUsers.filter(u => !excludeIds.includes(u.id));
                }

                // Фильтруем только менеджеров (у кого есть подчинённые)
                if (managersOnly) {
                    const managerIds = new Set(
                        allUsers
                            .filter(u => u.reportsTo)
                            .map(u => u.reportsTo!)
                    );
                    allUsers = allUsers.filter(u => managerIds.has(u.id));
                }

                setUsers(allUsers);

                // Строим дерево и плоский список
                const tree = buildOrgTree(allUsers);
                const flat = flattenOrgTree(tree);
                setFlatList(flat);

            } catch (err) {
                console.error('Error loading users for OrgChartSelect:', err);
            } finally {
                setLoading(false);
            }
        };

        loadUsers();
    }, [userProfile?.companyId, activeOnly, managersOnly, excludeIds]);

    const handleChange = (event: SelectChangeEvent<string>) => {
        onChange(event.target.value);
    };

    // Получаем данные выбранного пользователя
    const selectedUser = users.find(u => u.id === value);

    return (
        <FormControl fullWidth size={size} disabled={disabled || loading}>
            <InputLabel>{label}</InputLabel>
            <Select
                value={value}
                onChange={handleChange}
                label={label}
                renderValue={(selected) => {
                    if (selected === 'all') return 'Все сотрудники';
                    if (!selectedUser) return selected;
                    return (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Avatar
                                src={selectedUser.photoURL}
                                sx={{ width: 24, height: 24 }}
                            >
                                {selectedUser.displayName?.charAt(0)}
                            </Avatar>
                            {selectedUser.displayName}
                        </Box>
                    );
                }}
            >
                {loading && (
                    <MenuItem disabled>
                        <CircularProgress size={20} sx={{ mr: 1 }} />
                        Загрузка...
                    </MenuItem>
                )}

                {showAllOption && (
                    <MenuItem value="all">
                        <ListItemIcon>
                            <GroupIcon />
                        </ListItemIcon>
                        <ListItemText primary="Все сотрудники" />
                    </MenuItem>
                )}

                {!loading && flatList.map((item) => {
                    const user = users.find(u => u.id === item.id);
                    const hasSubordinates = (user?.subordinateCount || 0) > 0;

                    return (
                        <MenuItem
                            key={item.id}
                            value={item.id}
                            sx={{ pl: 2 + item.depth * 2 }}
                        >
                            <ListItemIcon>
                                {user?.photoURL ? (
                                    <Avatar src={user.photoURL} sx={{ width: 32, height: 32 }}>
                                        {item.displayName.charAt(0)}
                                    </Avatar>
                                ) : (
                                    <Avatar sx={{ width: 32, height: 32 }}>
                                        {hasSubordinates ? <GroupIcon /> : <PersonIcon />}
                                    </Avatar>
                                )}
                            </ListItemIcon>
                            <ListItemText
                                primary={item.displayName}
                                secondary={user?.title}
                            />
                            {hasSubordinates && (
                                <Chip
                                    label={`${user?.subordinateCount}`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ ml: 1 }}
                                />
                            )}
                        </MenuItem>
                    );
                })}

                {!loading && flatList.length === 0 && (
                    <MenuItem disabled>
                        <ListItemText primary="Сотрудники не найдены" />
                    </MenuItem>
                )}
            </Select>
        </FormControl>
    );
};

export default OrgChartSelect;
