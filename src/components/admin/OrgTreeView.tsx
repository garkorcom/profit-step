/**
 * @fileoverview Дерево организационной структуры
 * Визуализация иерархии сотрудников с expand/collapse
 */

import React, { useState } from 'react';
import {
    Box,
    Typography,
    Avatar,
    Chip,
    IconButton,
    Collapse,
    Paper,
} from '@mui/material';
import {
    ExpandMore as ExpandMoreIcon,
    ChevronRight as ChevronRightIcon,
    } from '@mui/icons-material';
import { UserProfile, DEPARTMENT_LABELS, Department } from '../../types/user.types';
import { OrgTreeNode } from '../../types/rbac.types';
import StatusIndicator, { type StatusIndicatorStatus } from '../common/StatusIndicator';
import { Timestamp } from 'firebase/firestore';

interface OrgTreeViewProps {
    nodes: OrgTreeNode[];
    users: UserProfile[];
    onUserClick: (user: UserProfile) => void;
}

interface TreeNodeProps {
    node: OrgTreeNode;
    users: UserProfile[];
    depth: number;
    onUserClick: (user: UserProfile) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({ node, users, depth, onUserClick }) => {
    const [expanded, setExpanded] = useState(depth < 2); // Auto-expand first 2 levels
    const hasChildren = node.children && node.children.length > 0;
    const user = users.find(u => u.id === node.id);

    // Handle both Timestamp and string for lastSeen
    const getIsOnline = (): boolean => {
        if (!user?.lastSeen) return false;
        const lastSeenDate = user.lastSeen instanceof Timestamp
            ? user.lastSeen.toDate()
            : new Date(user.lastSeen);
        return (new Date().getTime() - lastSeenDate.getTime()) < 5 * 60 * 1000;
    };

    const isOnline = getIsOnline();

    return (
        <Box>
            <Box
                onClick={() => user && onUserClick(user)}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    py: 1,
                    px: 2,
                    ml: depth * 3,
                    borderRadius: 1,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    '&:hover': {
                        bgcolor: 'action.hover',
                    },
                }}
            >
                {/* Expand/Collapse button */}
                {hasChildren ? (
                    <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                        sx={{ p: 0.5 }}
                    >
                        {expanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                    </IconButton>
                ) : (
                    <Box sx={{ width: 28 }} /> // Spacer
                )}

                {/* Avatar */}
                <Avatar
                    src={node.photoURL}
                    sx={{ width: 32, height: 32, fontSize: 14 }}
                >
                    {node.displayName?.charAt(0).toUpperCase()}
                </Avatar>

                {/* Name & Role */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={500} noWrap>
                        {node.displayName}
                    </Typography>
                    {user?.title && (
                        <Typography variant="caption" color="text.secondary" noWrap>
                            {user.title}
                        </Typography>
                    )}
                </Box>

                {/* Role Badge */}
                <Chip
                    label={node.role}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: 11 }}
                />

                {/* Status */}
                {user && (
                    <StatusIndicator
                        status={user.status as StatusIndicatorStatus}
                        isOnline={isOnline}
                        showLabel={false}
                        size="small"
                    />
                )}

                {/* Subordinates count */}
                {hasChildren && (
                    <Typography variant="caption" color="text.secondary">
                        {node.children.length}
                    </Typography>
                )}
            </Box>

            {/* Children */}
            <Collapse in={expanded}>
                {node.children.map(child => (
                    <TreeNode
                        key={child.id}
                        node={child}
                        users={users}
                        depth={depth + 1}
                        onUserClick={onUserClick}
                    />
                ))}
            </Collapse>
        </Box>
    );
};

// Group users by department
interface _DepartmentGroup {
    department: Department | 'none';
    label: string;
    users: OrgTreeNode[];
}

const OrgTreeView: React.FC<OrgTreeViewProps> = ({ nodes, users, onUserClick }) => {
    const [_expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set(['none']));

    // Group by department
    const _groupedByDept = React.useMemo(() => {
        const groups: Map<Department | 'none', OrgTreeNode[]> = new Map();

        const collectNodes = (nodeList: OrgTreeNode[]) => {
            for (const node of nodeList) {
                const user = users.find(u => u.id === node.id);
                const dept = user?.department || 'none';

                if (!groups.has(dept)) {
                    groups.set(dept, []);
                }
                groups.get(dept)!.push(node);
            }
        };

        collectNodes(nodes);

        return Array.from(groups.entries()).map(([dept, nodeList]) => ({
            department: dept,
            label: dept === 'none' ? 'Без отдела' : DEPARTMENT_LABELS[dept],
            users: nodeList,
        }));
    }, [nodes, users]);

    const _toggleDept = (dept: string) => {
        setExpandedDepts(prev => {
            const next = new Set(prev);
            if (next.has(dept)) {
                next.delete(dept);
            } else {
                next.add(dept);
            }
            return next;
        });
    };

    return (
        <Paper
            elevation={0}
            sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                overflow: 'hidden',
            }}
        >
            {/* Flat hierarchy view with tree lines */}
            {nodes.length > 0 && (
                <Box sx={{ py: 1 }}>
                    {nodes.map(node => (
                        <TreeNode
                            key={node.id}
                            node={node}
                            users={users}
                            depth={0}
                            onUserClick={onUserClick}
                        />
                    ))}
                </Box>
            )}

            {nodes.length === 0 && (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        Нет сотрудников для отображения
                    </Typography>
                </Box>
            )}
        </Paper>
    );
};

export default OrgTreeView;
