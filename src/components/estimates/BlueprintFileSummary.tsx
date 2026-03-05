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
    selectedAgents: string[];
    onToggleAgent: (agent: string) => void;

    // Custom Prompt Props
    projectType: string;
    setProjectType: (p: string) => void;
    squareFootage: string;
    setSquareFootage: (sq: string) => void;
    facilityUse: string;
    setFacilityUse: (fu: string) => void;
    customPrompt: string;
    setCustomPrompt: (p: string) => void;

    onStartAnalysis: () => void;
    onGoBackToFile: (fileIndex: number) => void;
}

const BlueprintFileSummary: React.FC<BlueprintFileSummaryProps> = ({
    approvedFiles, allFileNames, selectedAgents, onToggleAgent,
    projectType, setProjectType, squareFootage, setSquareFootage, facilityUse, setFacilityUse, customPrompt, setCustomPrompt,
    onStartAnalysis, onGoBackToFile,
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

            {/* AI Agent Selection */}
            <Box mb={2} p={2} bgcolor="background.paper" borderRadius={2} border="1px solid" borderColor="divider">
                <Typography variant="subtitle2" fontWeight={600} mb={1}>
                    🤖 Выберите AI Агентов для анализа:
                </Typography>
                <Box display="flex" gap={1} flexWrap="wrap">
                    {['gemini', 'claude', 'openai'].map(agent => (
                        <Chip
                            key={agent}
                            label={agent === 'gemini' ? '✨ Gemini 2.0' : agent === 'claude' ? '🧠 Claude 3.5' : '💬 OpenAI GPT-4o'}
                            onClick={() => onToggleAgent(agent)}
                            color={selectedAgents.includes(agent) ? 'primary' : 'default'}
                            variant={selectedAgents.includes(agent) ? 'filled' : 'outlined'}
                            sx={{ fontWeight: 600, px: 1 }}
                        />
                    ))}
                </Box>
                {selectedAgents.length < 2 && (
                    <Typography variant="caption" color="error" display="block" mt={1}>
                        ⚠️ Рекомендуется выбрать минимум 2 агентов для перекрестной сверки.
                    </Typography>
                )}
            </Box>

            {/* AI Configuration / Custom Prompt */}
            <Box mb={2} p={2} bgcolor="background.paper" borderRadius={2} border="1px solid" borderColor="divider">
                <Typography variant="subtitle2" fontWeight={600} mb={2}>
                    🔧 Опции Анализа (Защита от галлюцинаций):
                </Typography>
                <Box display="flex" gap={2} mb={2} flexWrap="wrap">
                    <Box flex={1} minWidth={200}>
                        <Typography variant="body2" color="text.secondary" mb={0.5}>Тип проекта</Typography>
                        <Box display="flex" gap={1} flexWrap="wrap">
                            {['residential', 'commercial', 'multifamily'].map(type => (
                                <Chip
                                    key={type}
                                    label={type === 'residential' ? '🏠 Жилой Дом' : type === 'commercial' ? '🏢 Коммерция' : '🏙 Многоквартирный'}
                                    onClick={() => setProjectType(type)}
                                    color={projectType === type ? 'primary' : 'default'}
                                    variant={projectType === type ? 'filled' : 'outlined'}
                                    sx={{ fontWeight: 600 }}
                                />
                            ))}
                        </Box>
                    </Box>
                    <Box flex={1} minWidth={150}>
                        <Typography variant="body2" color="text.secondary" mb={0.5}>Прим. площадь (кв.футы)</Typography>
                        <input
                            type="number"
                            value={squareFootage}
                            onChange={(e) => setSquareFootage(e.target.value)}
                            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%', boxSizing: 'border-box' }}
                            placeholder="Например, 2500"
                        />
                    </Box>
                    <Box flex={1} minWidth={150}>
                        <Typography variant="body2" color="text.secondary" mb={0.5}>Тип Использования (Опц.)</Typography>
                        <input
                            type="text"
                            value={facilityUse}
                            onChange={(e) => setFacilityUse(e.target.value)}
                            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%', boxSizing: 'border-box' }}
                            placeholder="Напр. Склад, Дата-центр..."
                        />
                    </Box>
                </Box>

                <Typography variant="body2" color="text.secondary" mb={0.5}>Дополнительные инструкции для AI (Промпт)</Typography>
                <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '6px',
                        border: '1px solid #ccc',
                        minHeight: '80px',
                        fontFamily: 'inherit',
                        fontSize: '14px',
                        resize: 'vertical',
                        boxSizing: 'border-box'
                    }}
                    placeholder="Пример: Убедись, что считаешь только розетки, а не выключатели..."
                />
            </Box>

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
                    disabled={totalSelectedPages === 0 || selectedAgents.length === 0}
                    sx={{ fontWeight: 600 }}
                >
                    🔍 Отправить на AI анализ ({totalSelectedPages} стр.)
                </Button>
            </Box>
        </Box>
    );
};

export default BlueprintFileSummary;
