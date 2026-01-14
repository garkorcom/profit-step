import React from 'react';
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, Box, Typography, Avatar, Chip, Tooltip, IconButton, Link as MuiLink
} from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LockIcon from '@mui/icons-material/Lock';
import { WorkSession } from '../../types/timeTracking.types';
import { formatDuration, formatDate, formatTime, getStatusColor } from '../../utils/dateFormatters';

interface TimeTrackingTableProps {
    sessions: WorkSession[];
    onEditSession: (session: WorkSession) => void;
    onDeleteSession: (session: WorkSession) => void;
    onEmployeeClick: (employee: { id: string; name: string }) => void;
}

/**
 * Gets the start of a day (midnight)
 */
const getStartOfDay = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

/**
 * Checks if a session can still be edited (today or yesterday)
 * Sessions from day-before-yesterday and earlier cannot be edited
 */
const canEditSession = (session: WorkSession): boolean => {
    // Cannot edit correction entries
    if (session.type === 'correction') return false;

    // Cannot edit if already finalized/processed
    if (session.finalizationStatus === 'finalized' || session.finalizationStatus === 'processed') {
        return false;
    }

    // Check if session is from today or yesterday
    if (!session.startTime) return false;

    const sessionDate = new Date(session.startTime.seconds * 1000);
    const today = getStartOfDay(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    return sessionDate >= yesterday;
};

/**
 * Gets row background color based on session state
 */
const getRowStyle = (session: WorkSession): { bgcolor?: string } => {
    // RED for auto-closed or manually edited sessions
    if (session.autoClosed || session.isManuallyEdited) {
        return { bgcolor: '#ffebee' }; // Light red (MUI red[50])
    }
    // Orange for correction entries
    if (session.type === 'correction') {
        return { bgcolor: '#fff3e0' }; // Light orange
    }
    return {};
};

/**
 * Sessions data table with actions
 */
const TimeTrackingTable: React.FC<TimeTrackingTableProps> = ({
    sessions,
    onEditSession,
    onDeleteSession,
    onEmployeeClick
}) => {
    return (
        <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
            <Table sx={{ minWidth: 800 }}>
                <TableHead>
                    <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Employee</TableCell>
                        <TableCell>Client / Object</TableCell>
                        <TableCell>Time Log</TableCell>
                        <TableCell>Duration</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Details</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {sessions.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={8} align="center">No work sessions found for this period</TableCell>
                        </TableRow>
                    ) : (
                        sessions.map((session) => {
                            const isCorrection = session.type === 'correction';
                            const isEditable = canEditSession(session);
                            const rowStyle = getRowStyle(session);

                            return (
                                <TableRow key={session.id} hover sx={rowStyle}>
                                    {/* Date */}
                                    <TableCell>
                                        {formatDate(session.startTime)}
                                        {isCorrection && <Typography variant="caption" display="block" color="textSecondary">Correction</Typography>}
                                        {session.autoClosed && <Typography variant="caption" display="block" color="error">Auto-Closed</Typography>}
                                        {session.isManuallyEdited && !session.autoClosed && <Typography variant="caption" display="block" color="error">Edited</Typography>}
                                    </TableCell>

                                    {/* Employee */}
                                    <TableCell>
                                        <Box
                                            display="flex"
                                            alignItems="center"
                                            gap={1}
                                            onClick={() => onEmployeeClick({ id: String(session.employeeId), name: session.employeeName })}
                                            sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline', color: 'primary.main' }, maxWidth: 200 }}
                                        >
                                            <Avatar sx={{ width: 24, height: 24, fontSize: '0.8rem' }}>
                                                {session.employeeName?.[0] || '?'}
                                            </Avatar>
                                            <Tooltip title={session.employeeName}>
                                                <Typography variant="body2" noWrap>{session.employeeName}</Typography>
                                            </Tooltip>
                                        </Box>
                                    </TableCell>

                                    {/* Client */}
                                    <TableCell>
                                        <Tooltip title={session.clientName}>
                                            <Typography variant="body2" fontWeight="medium" noWrap sx={{ maxWidth: 200 }}>
                                                {session.clientName}
                                            </Typography>
                                        </Tooltip>
                                        {session.startLocation && (
                                            <MuiLink
                                                href={`https://www.google.com/maps?q=${session.startLocation.latitude},${session.startLocation.longitude}`}
                                                target="_blank"
                                                underline="hover"
                                                sx={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem', color: 'gray' }}
                                            >
                                                <LocationOnIcon fontSize="inherit" sx={{ mr: 0.5 }} /> Map
                                            </MuiLink>
                                        )}
                                    </TableCell>

                                    {/* Time Log */}
                                    <TableCell>
                                        <Typography variant="body2">
                                            {isCorrection ? '-' : `${formatTime(session.startTime)} - ${session.status === 'active' ? 'Now' : formatTime(session.endTime)}`}
                                        </Typography>
                                        {session.breaks && session.breaks.length > 0 && (
                                            <Tooltip title={`${session.breaks.length} breaks taken`}>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center' }}>
                                                    <AccessTimeIcon fontSize="inherit" sx={{ mr: 0.5 }} />
                                                    Break: {formatDuration(session.totalBreakMinutes)}
                                                </Typography>
                                            </Tooltip>
                                        )}
                                    </TableCell>

                                    {/* Duration */}
                                    <TableCell sx={{ fontWeight: 'bold' }}>
                                        {formatDuration(session.durationMinutes)}
                                    </TableCell>

                                    {/* Description */}
                                    <TableCell>
                                        {session.description ? (
                                            <Tooltip title={isCorrection ? (session.correctionNote || session.description) : session.description}>
                                                <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                                    {isCorrection ? (session.correctionNote || session.description) : session.description}
                                                </Typography>
                                            </Tooltip>
                                        ) : (
                                            <Typography variant="caption" color="text.secondary">-</Typography>
                                        )}
                                        {/* Show edit note if edited */}
                                        {session.editNote && (
                                            <Tooltip title={`Edit reason: ${session.editNote}`}>
                                                <Typography variant="caption" display="block" color="error" sx={{ fontStyle: 'italic' }}>
                                                    ✏️ {session.editNote.slice(0, 30)}...
                                                </Typography>
                                            </Tooltip>
                                        )}
                                    </TableCell>

                                    {/* Status */}
                                    <TableCell>
                                        <Box display="flex" flexDirection="column" gap={0.5}>
                                            <Chip
                                                label={isCorrection ? 'Correction' : (session.status === 'paused' ? 'On Break' : session.status)}
                                                color={getStatusColor(session.status, session.type) as any}
                                                size="small"
                                                variant="outlined"
                                            />
                                            {/* Additional status chips */}
                                            {session.autoClosed && (
                                                <Chip
                                                    label="Auto-Closed"
                                                    color="error"
                                                    size="small"
                                                    variant="filled"
                                                />
                                            )}
                                            {session.isManuallyEdited && !session.autoClosed && (
                                                <Chip
                                                    label="Edited"
                                                    color="error"
                                                    size="small"
                                                    variant="outlined"
                                                />
                                            )}
                                        </Box>
                                    </TableCell>

                                    {/* Actions */}
                                    <TableCell align="right">
                                        <Box display="flex" justifyContent="flex-end" gap={0.5}>
                                            {!isCorrection && (
                                                <>
                                                    {session.startPhotoUrl ? (
                                                        <MuiLink href={session.startPhotoUrl} target="_blank">
                                                            <Chip icon={<PhotoCameraIcon />} label="Start" size="small" clickable color="primary" variant="outlined" />
                                                        </MuiLink>
                                                    ) : session.startPhotoId && (
                                                        <Tooltip title="Photo ID only (Old)">
                                                            <Chip icon={<PhotoCameraIcon />} label="Start" size="small" />
                                                        </Tooltip>
                                                    )}

                                                    {session.endPhotoUrl ? (
                                                        <MuiLink href={session.endPhotoUrl} target="_blank">
                                                            <Chip icon={<PhotoCameraIcon />} label="End" size="small" clickable color="primary" variant="outlined" />
                                                        </MuiLink>
                                                    ) : session.endPhotoId && (
                                                        <Tooltip title="Photo ID only (Old)">
                                                            <Chip icon={<PhotoCameraIcon />} label="End" size="small" />
                                                        </Tooltip>
                                                    )}
                                                </>
                                            )}

                                            {/* Edit Button - disabled if outside 48h window */}
                                            <Tooltip title={isEditable ? "Edit session" : "Correction window expired (48h)"}>
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => onEditSession(session)}
                                                        disabled={!isEditable}
                                                        color={isEditable ? "default" : "default"}
                                                    >
                                                        {isEditable ? <EditIcon fontSize="small" /> : <LockIcon fontSize="small" />}
                                                    </IconButton>
                                                </span>
                                            </Tooltip>

                                            <IconButton size="small" color="error" onClick={() => onDeleteSession(session)}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Box>
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default TimeTrackingTable;
