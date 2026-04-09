import React, { useMemo, useState } from 'react';
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Typography,
    Chip,
    TablePagination,
    TableSortLabel
} from '@mui/material';
import { format, parseISO } from 'date-fns';
import { GTDTask, GTDStatus, PRIORITY_COLORS } from '../../types/gtd.types';

const STATUS_LABELS: Record<GTDStatus, string> = {
    inbox: 'Inbox',
    next_action: 'Next Action',
    waiting: 'Waiting For',
    projects: 'Projects',
    estimate: 'Estimate Needed',
    someday: 'Someday/Maybe',
    done: 'Done'
};

const STATUS_COLORS: Record<GTDStatus, { bg: string; text: string }> = {
    inbox: { bg: '#F1F1EF', text: '#37352F' },
    next_action: { bg: '#FBEDD6', text: '#4A3712' },
    projects: { bg: '#E3EFFD', text: '#183347' },
    waiting: { bg: '#F9E6EC', text: '#4C2337' },
    estimate: { bg: '#FDECC8', text: '#402C1B' },
    someday: { bg: '#EFE9F5', text: '#302841' },
    done: { bg: '#DBEDDB', text: '#1C3829' },
};

interface TasksTableViewProps {
    tasks: GTDTask[];
    onTaskClick?: (task: GTDTask) => void;
}

type Order = 'asc' | 'desc';

export const TasksTableView: React.FC<TasksTableViewProps> = ({ tasks, onTaskClick }) => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [order, setOrder] = useState<Order>('desc');
    const [orderBy, setOrderBy] = useState<keyof GTDTask | 'createdAt'>('createdAt');

    const handleSort = (property: keyof GTDTask | 'createdAt') => {
        const isAsc = orderBy === property && order === 'asc';
        setOrder(isAsc ? 'desc' : 'asc');
        setOrderBy(property);
    };

    const handleChangePage = (event: unknown, newPage: number) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    const getTaskDate = (d: unknown): Date | null => {
        if (!d) return null;
        if (typeof d === 'string') return parseISO(d);
        if (
            typeof d === 'object' &&
            d !== null &&
            'toDate' in d &&
            typeof (d as { toDate: unknown }).toDate === 'function'
        ) {
            return (d as { toDate: () => Date }).toDate();
        }
        return new Date(d as string | number | Date);
    };

    const sortedTasks = useMemo(() => {
        return [...tasks].sort((a, b) => {
            const rawA: unknown = a[orderBy as keyof GTDTask];
            const rawB: unknown = b[orderBy as keyof GTDTask];
            let valA: string | number = '';
            let valB: string | number = '';

            if (orderBy === 'createdAt' || orderBy === 'dueDate') {
                valA = getTaskDate(rawA)?.getTime() || 0;
                valB = getTaskDate(rawB)?.getTime() || 0;
            } else if (typeof rawA === 'string' && typeof rawB === 'string') {
                valA = rawA.toLowerCase();
                valB = rawB.toLowerCase();
            } else {
                valA = String(rawA ?? '');
                valB = String(rawB ?? '');
            }

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });
    }, [tasks, order, orderBy]);

    const paginatedTasks = sortedTasks.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    return (
        <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <TableContainer component={Paper} sx={{ flex: 1, overflow: 'auto', borderRadius: 0, boxShadow: 'none' }}>
                <Table stickyHeader size="small" sx={{ minWidth: 800 }}>
                    <TableHead>
                        <TableRow>
                            <TableCell>
                                <TableSortLabel
                                    active={orderBy === 'title'}
                                    direction={orderBy === 'title' ? order : 'asc'}
                                    onClick={() => handleSort('title')}
                                >
                                    Task Name
                                </TableSortLabel>
                            </TableCell>
                            <TableCell width="12%">
                                <TableSortLabel
                                    active={orderBy === 'status'}
                                    direction={orderBy === 'status' ? order : 'asc'}
                                    onClick={() => handleSort('status')}
                                >
                                    Status
                                </TableSortLabel>
                            </TableCell>
                            <TableCell width="10%">Priority</TableCell>
                            <TableCell width="12%">Context</TableCell>
                            <TableCell width="15%">Client / Project</TableCell>
                            <TableCell width="12%">
                                <TableSortLabel
                                    active={orderBy === 'dueDate'}
                                    direction={orderBy === 'dueDate' ? order : 'asc'}
                                    onClick={() => handleSort('dueDate')}
                                >
                                    Due Date
                                </TableSortLabel>
                            </TableCell>
                            <TableCell width="12%">
                                <TableSortLabel
                                    active={orderBy === 'createdAt'}
                                    direction={orderBy === 'createdAt' ? order : 'asc'}
                                    onClick={() => handleSort('createdAt')}
                                >
                                    Created
                                </TableSortLabel>
                            </TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {paginatedTasks.length > 0 ? paginatedTasks.map((task) => {
                            const dueDate = getTaskDate(task.dueDate);
                            const createdDate = getTaskDate(task.createdAt);
                            const statusStyle = STATUS_COLORS[task.status] || STATUS_COLORS.inbox;

                            return (
                                <TableRow
                                    key={task.id}
                                    hover
                                    onClick={() => onTaskClick?.(task)}
                                    sx={{ cursor: 'pointer', '&:last-child td, &:last-child th': { border: 0 } }}
                                >
                                    <TableCell sx={{ fontWeight: 500 }}>
                                        {task.title}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={STATUS_LABELS[task.status] || task.status}
                                            size="small"
                                            sx={{
                                                bgcolor: statusStyle.bg,
                                                color: statusStyle.text,
                                                fontWeight: 600,
                                                fontSize: '0.75rem',
                                                height: 22
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {task.priority && task.priority !== 'none' && (
                                            <Box sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 0.5,
                                                color: PRIORITY_COLORS[task.priority],
                                                fontSize: '0.8rem',
                                                fontWeight: 600,
                                                textTransform: 'capitalize'
                                            }}>
                                                • {task.priority}
                                            </Box>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {task.context && (
                                            <Typography variant="body2" color="text.secondary">
                                                {task.context}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {task.clientName && (
                                            <Chip label={task.clientName} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.75rem' }} />
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {dueDate && (
                                            <Typography variant="body2" sx={{ color: dueDate < new Date() && task.status !== 'done' ? '#D83A3A' : 'text.primary', fontWeight: dueDate < new Date() && task.status !== 'done' ? 600 : 400 }}>
                                                {format(dueDate, 'MMM d, yyyy')}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {createdDate && (
                                            <Typography variant="body2" color="text.secondary">
                                                {format(createdDate, 'MMM d, yyyy')}
                                            </Typography>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        }) : (
                            <TableRow>
                                <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                    No tasks found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
            <Box sx={{ borderTop: '1px solid #E0E0E0', bgcolor: '#fff' }}>
                <TablePagination
                    rowsPerPageOptions={[25, 50, 100]}
                    component="div"
                    count={tasks.length}
                    rowsPerPage={rowsPerPage}
                    page={page}
                    onPageChange={handleChangePage}
                    onRowsPerPageChange={handleChangeRowsPerPage}
                />
            </Box>
        </Box>
    );
};

export default TasksTableView;
