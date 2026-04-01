import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Container, Box, Typography, Paper, Button, IconButton,
    CircularProgress, Chip, Tabs, Tab, Grid, CardActionArea,
    Select, MenuItem, FormControl, InputLabel, Table, TableBody,
    TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FolderIcon from '@mui/icons-material/Folder';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { projectsApi } from '../../api/projectsApi';
import { savedEstimateApi } from '../../api/savedEstimateApi';
import { Project } from '../../types/project.types';
import { SavedEstimate } from '../../types/savedEstimate.types';
import { ProjectGanttChart } from '../../components/projects/ProjectGanttChart';
import { ProjectTimeLapse } from '../../components/projects/ProjectTimeLapse';

/**
 * PROJECT WORKSPACE PAGE
 * 
 * Implements the "Project Library" and "Estimate Versioning" (QA) features.
 * Features:
 * - Tab 1: AI Estimates (Versions) - Lists all AI analysis runs (v1, v2, etc.) associated with this project.
 * - Tab 2: Comparison (QA) - Side-by-side table to compare quantities between a baseline "Эталон" and a "Новый прогон".
 * - Tab 3: Files - Library for uploaded blueprints (PDFs).
 *
 * This acts as the central hub for managing a job/project, replacing the old 1-to-1 blueprint-to-estimate model.
 */
const ProjectWorkspacePage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [project, setProject] = useState<Project | null>(null);
    const [versions, setVersions] = useState<SavedEstimate[]>([]);
    const [loading, setLoading] = useState(true);
    const [tabIndex, setTabIndex] = useState(0);

    const [baseVersionId, setBaseVersionId] = useState<string>('');
    const [compareVersionId, setCompareVersionId] = useState<string>('');

    useEffect(() => {
        if (!id) return;
        (async () => {
            setLoading(true);
            try {
                const proj = await projectsApi.getById(id);
                setProject(proj);
                if (proj) {
                    const companyId = proj.companyId;
                    const allEstimates = await savedEstimateApi.getAll(companyId);
                    // Filter estimates belonging to this project
                    const projVersions = allEstimates.filter(e => e.projectId === id || e.batchId?.startsWith('v2_')); // temporarily include some older ones if needed, but strict is better.
                    setVersions(projVersions);

                    if (projVersions.length >= 2) {
                        // Attempt to find an approved baseline. Otherwise pick the earliest.
                        const baseline = projVersions.find(v => v.isBaseline) || projVersions[projVersions.length - 1];
                        setBaseVersionId(baseline.id);
                        setCompareVersionId(projVersions[0].id !== baseline.id ? projVersions[0].id : (projVersions[1]?.id || ''));
                    }
                }
            } catch (err) {
                console.error("Failed to load project details", err);
            }
            setLoading(false);
        })();
    }, [id]);

    const baseVersion = versions.find(v => v.id === baseVersionId);
    const compareVersion = versions.find(v => v.id === compareVersionId);

    const getComparisonRows = () => {
        if (!baseVersion || !compareVersion) return [];
        const keys = new Set([...Object.keys(baseVersion.quantities || {}), ...Object.keys(compareVersion.quantities || {})]);
        const rows: { name: string; baseQty: number; compQty: number; diff: number }[] = [];
        keys.forEach(key => {
            const baseQty = baseVersion.quantities?.[key] || 0;
            const compQty = compareVersion.quantities?.[key] || 0;
            if (baseQty > 0 || compQty > 0) {
                // Formatting name: e.g. "recessed_ic" -> "Recessed Ic"
                const fmtName = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                rows.push({ name: fmtName, baseQty, compQty, diff: compQty - baseQty });
            }
        });
        return rows.sort((a, b) => b.diff - a.diff); // Sort by largest change
    };

    if (loading) return <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px"><CircularProgress /></Box>;
    if (!project) return <Box p={4}><Typography>Проект не найден</Typography></Box>;

    return (
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
            {/* Header */}
            <Box display="flex" alignItems="center" gap={2} mb={3}>
                <IconButton onClick={() => navigate('/estimates/projects')} sx={{ bgcolor: 'background.paper', boxShadow: 1 }}>
                    <ArrowBackIcon />
                </IconButton>
                <Box flex={1}>
                    <Typography variant="h4" fontWeight={800}>{project.name}</Typography>
                    <Box display="flex" gap={2} mt={1}>
                        <Typography variant="body2" color="text.secondary">
                            📍 {project.address || 'Адрес не указан'}
                        </Typography>
                        {project.areaSqft && (
                            <Typography variant="body2" color="text.secondary">
                                📏 {project.areaSqft} sqft
                            </Typography>
                        )}
                    </Box>
                </Box>
                <Chip
                    label={project.status === 'completed' ? 'Завершен' : 'В работе'}
                    color={project.status === 'completed' ? 'success' : 'primary'}
                />
            </Box>

            <Paper sx={{ mb: 3 }}>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} sx={{ px: 2, pt: 1 }}>
                    <Tab label={`Оценки ИИ (${versions.length})`} sx={{ fontWeight: 600 }} />
                    <Tab label="Сравнение (QA)" sx={{ fontWeight: 600 }} disabled={versions.length < 2} />
                    <Tab label={`Файлы (${project.files?.length || 0})`} sx={{ fontWeight: 600 }} />
                    <Tab label="График (Gantt)" sx={{ fontWeight: 600 }} />
                    <Tab label="Хроника (Time-Lapse)" sx={{ fontWeight: 600 }} />
                </Tabs>
            </Paper>

            {/* TAB 1: Estimates */}
            {tabIndex === 0 && (
                <Box>
                    <Box display="flex" justifyContent="space-between" mb={2}>
                        <Typography variant="h6">Версии расчетов</Typography>
                        <Button variant="contained" startIcon={<CloudUploadIcon />} onClick={() => navigate(`/estimates/electrical?projectId=${project.id}`)}>
                            Запустить ИИ Анализ
                        </Button>
                    </Box>
                    <Grid container spacing={2}>
                        {versions.length === 0 ? (
                            <Grid size={{ xs: 12 }}>
                                <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
                                    <Typography color="text.secondary">Нет проведенных оценок для этого проекта.</Typography>
                                </Paper>
                            </Grid>
                        ) : (
                            versions.map(v => (
                                <Grid size={{ xs: 12, md: 4 }} key={v.id}>
                                    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                                        <CardActionArea sx={{ p: 2 }} onClick={() => navigate(`/estimates/projects/${project.id}/versions/${v.id}`)}>
                                            <Box display="flex" justifyContent="space-between" mb={1}>
                                                <Typography variant="subtitle1" fontWeight={700}>
                                                    {v.versionName || 'Draft Version'}
                                                </Typography>
                                                <Chip size="small" label={`$${v.grandTotal?.toLocaleString() || 0}`} color="success" />
                                            </Box>
                                            <Typography variant="caption" color="text.secondary">
                                                ID: {v.id.slice(0, 8)}
                                            </Typography>
                                        </CardActionArea>
                                    </Paper>
                                </Grid>
                            ))
                        )}
                    </Grid>
                </Box>
            )}

            {/* TAB 2: Compare */}
            {tabIndex === 1 && (
                <Box>
                    <Box display="flex" justifyContent="space-between" mb={3}>
                        <Typography variant="h6">Сравнение версий</Typography>
                    </Box>

                    <Grid container spacing={4} mb={3}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Эталон (Baseline)</InputLabel>
                                <Select value={baseVersionId} onChange={e => setBaseVersionId(e.target.value)} label="Эталон (Baseline)">
                                    {versions.map(v => (
                                        <MenuItem key={v.id} value={v.id}>
                                            {v.versionName || v.id.slice(0, 8)} {v.isBaseline && '★'}
                                            ({new Date(v.createdAt?.toMillis ? v.createdAt.toMillis() : Date.now()).toLocaleDateString()})
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Новый прогон (Compare)</InputLabel>
                                <Select value={compareVersionId} onChange={e => setCompareVersionId(e.target.value)} label="Новый прогон (Compare)">
                                    {versions.map(v => (
                                        <MenuItem key={v.id} value={v.id}>
                                            {v.versionName || v.id.slice(0, 8)} {v.isBaseline && '★'}
                                            ({new Date(v.createdAt?.toMillis ? v.createdAt.toMillis() : Date.now()).toLocaleDateString()})
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>

                    {baseVersion && compareVersion && (
                        <Box>
                            {/* Financial Delta Summary Cards */}
                            <Grid container spacing={2} mb={3}>
                                {[
                                    { label: 'Total Estimate Price', key: 'grandTotal' as const },
                                    { label: 'Labor Cost', key: 'totalLabor' as const },
                                    { label: 'Materials Cost', key: 'totalMaterials' as const },
                                ].map(stat => {
                                    const baseVal = baseVersion[stat.key] || 0;
                                    const compVal = compareVersion[stat.key] || 0;
                                    const diff = compVal - baseVal;
                                    const isIncrease = diff > 0;
                                    const isDecrease = diff < 0;
                                    const color = isIncrease ? 'success.main' : (isDecrease ? 'error.main' : 'text.secondary');

                                    // Handle cases where totalLabor or totalMaterials might be missing in older version payloads
                                    if (baseVal === 0 && compVal === 0) return null;

                                    return (
                                        <Grid size={{ xs: 12, md: 4 }} key={stat.key}>
                                            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', bgcolor: 'grey.50' }}>
                                                <Typography variant="caption" color="text.secondary" fontWeight={600} textTransform="uppercase">
                                                    {stat.label}
                                                </Typography>
                                                <Box display="flex" justifyContent="center" alignItems="center" gap={2} mt={1}>
                                                    <Typography variant="h6">${baseVal.toLocaleString()}</Typography>
                                                    <ArrowForwardIcon color="action" fontSize="small" />
                                                    <Typography variant="h6" color={diff !== 0 ? color : 'inherit'}>
                                                        ${compVal.toLocaleString()}
                                                    </Typography>
                                                </Box>
                                                <Typography variant="subtitle2" color={color} mt={0.5} fontWeight={700}>
                                                    Δ {isIncrease ? '+' : ''}{diff.toLocaleString()}
                                                </Typography>
                                            </Paper>
                                        </Grid>
                                    );
                                })}
                            </Grid>

                            <TableContainer component={Paper} variant="outlined">
                                <Table size="small">
                                    <TableHead sx={{ bgcolor: 'grey.50' }}>
                                        <TableRow>
                                            <TableCell sx={{ fontWeight: 600 }}>Позиция (Device)</TableCell>
                                            <TableCell align="center" sx={{ fontWeight: 600 }}>{baseVersion.versionName} (Эталон)</TableCell>
                                            <TableCell align="center" sx={{ fontWeight: 600 }}>{compareVersion.versionName} (Новый)</TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 600 }}>Разница (Δ) Кол-во</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {getComparisonRows().map((row, i) => (
                                            <TableRow key={i} sx={{ '&:last-child td, &:last-child th': { border: 0 }, bgcolor: row.diff !== 0 ? (row.diff > 0 ? 'success.50' : 'error.50') : 'inherit' }}>
                                                <TableCell component="th" scope="row">{row.name}</TableCell>
                                                <TableCell align="center">{row.baseQty}</TableCell>
                                                <TableCell align="center" sx={{ fontWeight: row.diff !== 0 ? 'bold' : 'normal' }}>{row.compQty}</TableCell>
                                                <TableCell align="right">
                                                    <Chip
                                                        size="small"
                                                        label={row.diff > 0 ? `+${row.diff}` : row.diff}
                                                        color={row.diff === 0 ? 'default' : (row.diff > 0 ? 'success' : 'error')}
                                                        variant={row.diff === 0 ? 'outlined' : 'filled'}
                                                        sx={{ minWidth: 50, fontWeight: 700 }}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>
                    )}
                </Box>
            )}

            {/* TAB 3: Files */}
            {tabIndex === 2 && (
                <Box>
                    <Box display="flex" justifyContent="space-between" mb={2}>
                        <Typography variant="h6">Библиотека файлов</Typography>
                        <Button variant="outlined" startIcon={<CloudUploadIcon />}>
                            Загрузить файлы
                        </Button>
                    </Box>
                    <Grid container spacing={2}>
                        {!project.files || project.files.length === 0 ? (
                            <Grid size={{ xs: 12 }}>
                                <Paper sx={{ p: 6, textAlign: 'center', borderStyle: 'dashed', bgcolor: 'transparent' }}>
                                    <FolderIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                                    <Typography color="text.secondary">Перетащите PDF чертежи сюда</Typography>
                                    <Typography variant="caption" display="block" color="text.disabled" mt={1}>(Здесь будет папка проекта Firebase Storage)</Typography>
                                </Paper>
                            </Grid>
                        ) : (
                            project.files.map((f, i) => (
                                <Grid size={{ xs: 12, sm: 6, md: 3 }} key={i}>
                                    <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <InsertDriveFileIcon color="primary" />
                                        <Box overflow="hidden">
                                            <Typography variant="body2" noWrap>{f.name}</Typography>
                                            <Typography variant="caption" color="text.secondary">{(f.size / 1024 / 1024).toFixed(1)} MB</Typography>
                                        </Box>
                                    </Paper>
                                </Grid>
                            ))
                        )}
                    </Grid>
                </Box>
            )}

            {/* TAB 4: Gantt Chart */}
            {tabIndex === 3 && (
                <Box>
                    <ProjectGanttChart projectId={project.id} companyId={project.companyId} />
                </Box>
            )}

            {/* TAB 5: Time-Lapse */}
            {tabIndex === 4 && (
                <Box>
                    <ProjectTimeLapse projectId={project.id} companyId={project.companyId} />
                </Box>
            )}
        </Container>
    );
};

export default ProjectWorkspacePage;
