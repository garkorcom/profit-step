import React from 'react';
import {
    Box, Typography, Button, Paper, Chip, List, ListItem,
    ListItemIcon, ListItemText, Divider
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BoltIcon from '@mui/icons-material/Bolt';
import { FilePages } from './BlueprintPagesGrid';

interface BlueprintFileSummaryProps {
    approvedFiles: Map<number, { filePages: FilePages; selectedPages: Set<string> }>;
    allFileNames: string[];  // All original file names (to show skipped ones too)
    onStartAnalysis: () => void;
    onGoBackToFile: (fileIndex: number) => void;
}

const BlueprintFileSummary: React.FC<BlueprintFileSummaryProps> = ({
    approvedFiles, allFileNames, onStartAnalysis, onGoBackToFile,
}) => {
    const totalApproved = approvedFiles.size;
    const totalSelectedPages = Array.from(approvedFiles.values())
        .reduce((sum, af) => sum + af.selectedPages.size, 0);

    return (
        <Box>
            {/* Header */}
            <Box mb={2}>
                <Typography variant="h6" fontWeight={700}>
                    📋 Сводка: {totalApproved} из {allFileNames.length} файлов, {totalSelectedPages} стр.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Проверьте перед отправкой на AI анализ
                </Typography>
            </Box>

            {/* File List */}
            <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
                <List disablePadding>
                    {allFileNames.map((fileName, idx) => {
                        const approved = approvedFiles.get(idx);
                        const isApproved = !!approved;
                        const selectedCount = approved?.selectedPages.size || 0;
                        const totalPages = approved?.filePages.pages.length || 0;

                        return (
                            <React.Fragment key={idx}>
                                {idx > 0 && <Divider />}
                                <ListItem
                                    sx={{
                                        cursor: 'pointer',
                                        '&:hover': { bgcolor: 'action.hover' },
                                        opacity: isApproved ? 1 : 0.6,
                                    }}
                                    onClick={() => onGoBackToFile(idx)}
                                >
                                    <ListItemIcon sx={{ minWidth: 36 }}>
                                        {isApproved ? (
                                            <CheckCircleIcon color="success" fontSize="small" />
                                        ) : (
                                            <SkipNextIcon color="disabled" fontSize="small" />
                                        )}
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={
                                            <Typography variant="body2" fontWeight={600} noWrap>
                                                {fileName}
                                            </Typography>
                                        }
                                        secondary={
                                            isApproved
                                                ? `${selectedCount}/${totalPages} стр. выбрано`
                                                : 'пропущен'
                                        }
                                    />
                                    <Chip
                                        label={isApproved ? `${selectedCount} стр.` : 'пропущен'}
                                        size="small"
                                        color={isApproved ? 'primary' : 'default'}
                                        variant={isApproved ? 'filled' : 'outlined'}
                                    />
                                </ListItem>
                            </React.Fragment>
                        );
                    })}
                </List>
            </Paper>

            {/* Actions */}
            <Box display="flex" justifyContent="space-between" mt={2} flexWrap="wrap" gap={1}>
                <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<ArrowBackIcon />}
                    onClick={() => {
                        // Go back to the last file
                        const lastIdx = allFileNames.length - 1;
                        onGoBackToFile(lastIdx);
                    }}
                    size="small"
                >
                    ← Вернуться к файлам
                </Button>
                <Button
                    variant="contained"
                    color="primary"
                    startIcon={<BoltIcon />}
                    onClick={onStartAnalysis}
                    disabled={totalSelectedPages === 0}
                    sx={{ fontWeight: 600 }}
                >
                    🔍 Отправить на AI анализ ({totalSelectedPages} стр.)
                </Button>
            </Box>
        </Box>
    );
};

export default BlueprintFileSummary;
