import React from 'react';
import { Box, Paper, Typography, Chip, Stack, alpha, useTheme } from '@mui/material';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

import { ClientRow } from '../../../hooks/useClientDashboard';
import { LifecycleStage } from '../../../types/crm.types';
import {
    LIFECYCLE_LABELS,
    LIFECYCLE_CHIP_COLOR,
    SEGMENT_COLOR,
    HEALTH_BAND_COLOR,
    formatUsd,
    daysSinceTs,
} from './designTokens';

interface Props {
    byLifecycle: {
        lead: ClientRow[];
        prospect: ClientRow[];
        active: ClientRow[];
        repeat: ClientRow[];
    };
    onMove: (clientId: string, to: LifecycleStage) => void;
    onNavigate: (id: string) => void;
}

type KanbanStage = keyof Props['byLifecycle'];

const COLUMNS: KanbanStage[] = ['lead', 'prospect', 'active', 'repeat'];

const ClientsKanbanLifecycle: React.FC<Props> = ({ byLifecycle, onMove, onNavigate }) => {
    const theme = useTheme();

    const handleDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        const src = result.source.droppableId as KanbanStage;
        const dst = result.destination.droppableId as KanbanStage;
        if (src === dst) return;
        onMove(result.draggableId, dst);
    };

    return (
        <DragDropContext onDragEnd={handleDragEnd}>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'repeat(4, minmax(260px, 1fr))', md: 'repeat(4, 1fr)' },
                    gap: 2,
                    overflowX: 'auto',
                    pb: 2,
                    alignItems: 'start',
                    minHeight: 480,
                }}
            >
                {COLUMNS.map(stage => (
                    <Column
                        key={stage}
                        stage={stage}
                        clients={byLifecycle[stage]}
                        onNavigate={onNavigate}
                        bgTint={alpha(theme.palette.primary.main, 0.03)}
                        dividerColor={theme.palette.divider}
                    />
                ))}
            </Box>
        </DragDropContext>
    );
};

interface ColumnProps {
    stage: KanbanStage;
    clients: ClientRow[];
    onNavigate: (id: string) => void;
    bgTint: string;
    dividerColor: string;
}

const Column: React.FC<ColumnProps> = ({ stage, clients, onNavigate, bgTint, dividerColor }) => {
    return (
        <Box
            sx={{
                border: `1px solid ${dividerColor}`,
                borderRadius: 2,
                bgcolor: bgTint,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 200,
            }}
        >
            <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${dividerColor}` }}
            >
                <Typography variant="subtitle2" fontWeight={700}>
                    {LIFECYCLE_LABELS[stage as LifecycleStage]}
                </Typography>
                <Chip
                    label={clients.length}
                    size="small"
                    color={LIFECYCLE_CHIP_COLOR[stage as LifecycleStage]}
                    sx={{ height: 20, fontSize: '0.7rem' }}
                />
            </Stack>
            <Droppable droppableId={stage}>
                {(provided, snapshot) => (
                    <Box
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        sx={{
                            flex: 1,
                            p: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                            bgcolor: snapshot.isDraggingOver ? 'action.hover' : 'transparent',
                            transition: 'background-color 0.15s ease',
                        }}
                    >
                        {clients.map((client, index) => (
                            <Draggable key={client.id} draggableId={client.id} index={index}>
                                {(drag, snap) => (
                                    <Box
                                        ref={drag.innerRef}
                                        {...drag.draggableProps}
                                        {...drag.dragHandleProps}
                                        style={{
                                            ...drag.draggableProps.style,
                                            boxShadow: snap.isDragging ? '0 8px 24px rgba(0,0,0,0.12)' : undefined,
                                            borderRadius: 8,
                                        }}
                                    >
                                        <MiniCard client={client} onNavigate={onNavigate} />
                                    </Box>
                                )}
                            </Draggable>
                        ))}
                        {provided.placeholder}
                    </Box>
                )}
            </Droppable>
        </Box>
    );
};

const MiniCard: React.FC<{ client: ClientRow; onNavigate: (id: string) => void }> = ({ client, onNavigate }) => {
    const segment = client.segment ?? 'B';
    const days = daysSinceTs(client.effectiveLastContactAt);
    const ltv = client.ltv ?? client.totalRevenue ?? 0;
    return (
        <Paper
            variant="outlined"
            elevation={0}
            onClick={() => onNavigate(client.id)}
            sx={{
                p: 1.25,
                borderRadius: 1.5,
                cursor: 'pointer',
                '&:hover': { borderColor: 'primary.main' },
            }}
        >
            <Stack direction="row" alignItems="center" spacing={0.75} mb={0.5}>
                <Box
                    sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: SEGMENT_COLOR[segment],
                    }}
                />
                {client.healthScore !== undefined && client.healthBand && (
                    <Chip
                        label={client.healthScore}
                        size="small"
                        sx={{
                            height: 18,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            bgcolor: HEALTH_BAND_COLOR[client.healthBand],
                            color: 'white',
                            minWidth: 32,
                        }}
                    />
                )}
                {client.churnRisk === 'high' && (
                    <Chip label="Риск" size="small" color="error" sx={{ height: 18, fontSize: '0.6rem' }} />
                )}
            </Stack>
            <Typography variant="body2" fontWeight={600} noWrap gutterBottom>
                {client.name}
            </Typography>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="caption" color="text.secondary">
                    {days !== null ? `${days}д` : 'нов'}
                </Typography>
                {ltv > 0 && (
                    <Typography variant="caption" fontWeight={600}>
                        {formatUsd(ltv, true)}
                    </Typography>
                )}
            </Stack>
        </Paper>
    );
};

export default ClientsKanbanLifecycle;
