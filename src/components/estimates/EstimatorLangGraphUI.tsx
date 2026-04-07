import React, { useState, useRef } from 'react';
import { 
    Box, Button, Typography, Paper, Table, TableBody, 
    TableCell, TableHead, TableRow, CircularProgress, Alert, Chip,
    MenuItem, Select, Divider, Accordion, AccordionSummary, AccordionDetails,
    LinearProgress, Tabs, Tab
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { SelectChangeEvent } from '@mui/material';

/** LangGraph API response types */
interface BomItem { item: string; category?: string; qty: number; unit: string; unit_price?: number; total_price?: number }
interface CircuitItem { circuit_id: string; room: string; devices?: string[]; wire_gauge?: string; wire_calc?: { home_run_ft: number; daisy_chain_ft: number; drops_ft: number; waste_ft: number }; total_wire_length: number; dedicated?: boolean; zone_type?: string }
interface PanelItem { circuit_id: string; breaker_type: string; amps: number; poles: number }
interface BlueprintDevice { id: string; type: string }
interface BlueprintRoom { name: string; zone_type: string; devices?: BlueprintDevice[] }
interface ParsedBlueprint { rooms?: BlueprintRoom[] }

export const EstimatorLangGraphUI: React.FC = () => {
    const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'review' | 'pricing' | 'completed'>('idle');
    const [bom, setBom] = useState<BomItem[]>([]);
    const [circuits, setCircuits] = useState<CircuitItem[]>([]);
    const [panelSchedule, setPanelSchedule] = useState<PanelItem[]>([]);
    const [threadId, setThreadId] = useState<string>('');
    const [totalCost, setTotalCost] = useState<number>(0);
    const [blueprintType, setBlueprintType] = useState<string>('P');
    const [blueprintFile, setBlueprintFile] = useState<string>('plumbing_layout_P1.pdf');
    const [parsedJson, setParsedJson] = useState<ParsedBlueprint | null>(null);
    const [error, setError] = useState<string>('');
    const [tabValue, setTabValue] = useState<number>(0); // 0 = Upload PDF, 1 = Sample
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: SelectChangeEvent<string>) => {
        const val = e.target.value;
        setBlueprintFile(val);
        setBlueprintType(val.includes('electrical') ? 'E' : 'P');
    };

    // --- Upload PDF flow (Phase 10) ---
    const handlePdfUpload = async (file: File) => {
        setStatus('uploading');
        setError('');
        setParsedJson(null);
        const newThread = 'thread_' + Date.now();
        setThreadId(newThread);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('thread_id', newThread);

        try {
            const res = await fetch('http://localhost:8000/api/upload-blueprint', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (data.status === 'paused_for_review') {
                setBom(data.pending_bom || []);
                setCircuits(data.circuits || []);
                setPanelSchedule(data.panel_schedule || []);
                setParsedJson(data.blueprint_json || null);
                setBlueprintType(data.blueprint_type || 'E');
                setStatus('review');
            } else if (data.status === 'error') {
                setError(data.message);
                setStatus('idle');
            } else {
                setStatus('completed');
            }
        } catch (e) {
            console.error(e);
            setError("Failed to connect to LangGraph API (port 8000). Is the server running?");
            setStatus('idle');
        }
    };

    const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handlePdfUpload(file);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && file.type === 'application/pdf') handlePdfUpload(file);
    };

    // --- Sample blueprint flow (legacy) ---
    const startPipeline = async () => {
        setStatus('processing');
        setError('');
        const newThread = 'thread_' + Date.now();
        setThreadId(newThread);
        
        try {
            const res = await fetch('http://localhost:8000/api/estimate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blueprint_path: blueprintFile, thread_id: newThread })
            });
            const data = await res.json();
            
            if (data.status === 'paused_for_review') {
                setBom(data.pending_bom);
                setCircuits(data.circuits || []);
                setPanelSchedule(data.panel_schedule || []);
                setStatus('review');
            } else {
                setStatus('completed');
            }
        } catch (e) {
            console.error(e);
            setError("Failed to connect to LangGraph API (port 8000).");
            setStatus('idle');
        }
    };

    const approvePipeline = async () => {
        setStatus('pricing');
        setError('');
        try {
            const res = await fetch('http://localhost:8000/api/estimate/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thread_id: threadId, approve: true })
            });
            const data = await res.json();
            if (data.bom) setBom(data.bom); // Update BOM with prices
            setTotalCost(data.total_cost || 0.0);
            setStatus('completed');
        } catch (e) {
            console.error(e);
            setError("Failed to resume pipeline.");
            setStatus('review');
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 4, mb: 4, bgcolor: '#fbfbfb', borderLeft: '4px solid #3f51b5' }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h5" fontWeight="bold">Multi-Agent AI Estimator (LangGraph)</Typography>
                <Chip label="Phase 10 — Vision + Deterministic Tools" color="primary" size="small" />
            </Box>
            
            <Typography variant="body2" color="textSecondary" mb={3}>
                Upload a PDF blueprint and GPT-4o Vision will extract rooms, devices, and coordinates.
                Then <strong>deterministic geometry tools</strong> calculate circuits, wire lengths, and panel schedule
                — zero LLM math errors, 100% reproducible results.
            </Typography>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                    {error}
                </Alert>
            )}

            {status === 'idle' && (
                <Box>
                    <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mb: 2 }}>
                        <Tab label="📄 Upload PDF Blueprint" />
                        <Tab label="🧪 Sample Blueprints" />
                    </Tabs>
                    
                    {tabValue === 0 && (
                        <Box
                            onDrop={onDrop}
                            onDragOver={(e) => e.preventDefault()}
                            onClick={() => fileInputRef.current?.click()}
                            sx={{
                                border: '2px dashed #90caf9',
                                borderRadius: 2,
                                p: 5,
                                textAlign: 'center',
                                cursor: 'pointer',
                                bgcolor: '#f5f9ff',
                                transition: 'all 0.2s',
                                '&:hover': { bgcolor: '#e3f2fd', borderColor: '#42a5f5' }
                            }}
                        >
                            <CloudUploadIcon sx={{ fontSize: 48, color: '#42a5f5', mb: 1 }} />
                            <Typography variant="h6" color="primary">
                                Drop PDF Blueprint Here
                            </Typography>
                            <Typography variant="body2" color="textSecondary">
                                or click to browse — GPT-4o Vision will analyze the floor plan
                            </Typography>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf"
                                onChange={onFileInputChange}
                                style={{ display: 'none' }}
                            />
                        </Box>
                    )}

                    {tabValue === 1 && (
                        <Box display="flex" gap={2} alignItems="center">
                            <Select value={blueprintFile} onChange={handleFileChange} size="small" sx={{ minWidth: 250, bgcolor: 'white' }}>
                                <MenuItem value="plumbing_layout_P1.pdf">Plumbing Blueprint (P-1)</MenuItem>
                                <MenuItem value="plumbing_flawed_P2.pdf">Plumbing Blueprint w/ Error (P-2)</MenuItem>
                                <MenuItem value="electrical_plan_E1.pdf">Electrical Blueprint (E-1) — Kitchen + Bedroom</MenuItem>
                            </Select>
                            <Button variant="contained" onClick={startPipeline} color="primary" disableElevation>
                                Analyze Blueprint
                            </Button>
                        </Box>
                    )}
                </Box>
            )}

            {status === 'uploading' && (
                <Box p={3} bgcolor="white" borderRadius={2} border="1px dashed #ccc">
                    <Box display="flex" alignItems="center" gap={2} mb={2}>
                        <CircularProgress size={24} />
                        <Typography><strong>👁️ Vision Agent analyzing blueprint...</strong></Typography>
                    </Box>
                    <LinearProgress variant="indeterminate" sx={{ borderRadius: 1 }} />
                    <Typography variant="body2" color="textSecondary" mt={1}>
                        GPT-4o is reading rooms, devices, and coordinates from the floor plan (10-15 sec)
                    </Typography>
                </Box>
            )}

            {status === 'processing' && (
                <Box display="flex" alignItems="center" gap={2} p={3} bgcolor="white" borderRadius={2} border="1px dashed #ccc">
                    <CircularProgress size={24} />
                    <Typography><strong>Agents working...</strong> Orchestrator &rarr; {blueprintType === 'E' ? 'Circuit Designer → Panel Builder' : 'Plumbing Agent'} &rarr; Code Compliance &rarr; ⏸</Typography>
                </Box>
            )}

            {status === 'review' && (
                <Box>
                    <Alert severity="warning" sx={{ mb: 3 }}>
                        <strong>Human-in-the-Loop Review Required:</strong> The Code Compliance Inspector APPROVED the design. Review the circuits and BOM below.
                    </Alert>

                    {parsedJson && (
                        <Accordion sx={{ mb: 2, bgcolor: '#f3e5f5' }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography fontWeight="bold">
                                    👁️ Vision Parser Output — {parsedJson.rooms?.length || 0} rooms, {
                                        parsedJson.rooms?.reduce((sum: number, r: BlueprintRoom) => sum + (r.devices?.length || 0), 0) || 0
                                    } devices detected
                                </Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                {parsedJson.rooms?.map((room: BlueprintRoom, ri: number) => (
                                    <Box key={ri} mb={1}>
                                        <Typography variant="subtitle2">
                                            {room.name} 
                                            <Chip 
                                                label={room.zone_type} 
                                                size="small" 
                                                color={room.zone_type === 'wet' ? 'info' : 'default'} 
                                                sx={{ ml: 1, height: 18, fontSize: 10 }} 
                                            />
                                            {' — '}{room.devices?.length || 0} devices
                                        </Typography>
                                        <Typography variant="body2" color="textSecondary" sx={{ pl: 2, fontSize: 11 }}>
                                            {room.devices?.map((d) => `${d.id} (${d.type})`).join(', ')}
                                        </Typography>
                                    </Box>
                                ))}
                            </AccordionDetails>
                        </Accordion>
                    )}
                    
                    {circuits.length > 0 && (
                        <Accordion defaultExpanded sx={{ mb: 2 }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography fontWeight="bold">⚡ Circuit Routing Details ({circuits.length} circuits)</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Table size="small">
                                    <TableHead sx={{ bgcolor: '#e8f5e9' }}>
                                        <TableRow>
                                            <TableCell><strong>Circuit</strong></TableCell>
                                            <TableCell><strong>Room</strong></TableCell>
                                            <TableCell><strong>Devices</strong></TableCell>
                                            <TableCell><strong>Wire</strong></TableCell>
                                            <TableCell align="right"><strong>HomeRun</strong></TableCell>
                                            <TableCell align="right"><strong>Chain</strong></TableCell>
                                            <TableCell align="right"><strong>Drops</strong></TableCell>
                                            <TableCell align="right"><strong>+15% Waste</strong></TableCell>
                                            <TableCell align="right"><strong>Total ft</strong></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {circuits.map((c, idx) => (
                                            <TableRow key={idx} sx={c.dedicated ? { bgcolor: '#fff3e0' } : {}}>
                                                <TableCell>
                                                    {c.circuit_id}
                                                    {c.dedicated && <Chip label="DEDICATED" size="small" color="warning" sx={{ ml: 1, height: 18, fontSize: 10 }} />}
                                                </TableCell>
                                                <TableCell>
                                                    {c.room}
                                                    {c.zone_type === 'wet' && <Chip label="WET" size="small" color="info" sx={{ ml: 1, height: 18, fontSize: 10 }} />}
                                                </TableCell>
                                                <TableCell>{(c.devices || []).join(', ')}</TableCell>
                                                <TableCell sx={{ fontSize: 11 }}>{c.wire_gauge?.substring(0, 15)}...</TableCell>
                                                <TableCell align="right">{c.wire_calc?.home_run_ft}</TableCell>
                                                <TableCell align="right">{c.wire_calc?.daisy_chain_ft}</TableCell>
                                                <TableCell align="right">{c.wire_calc?.drops_ft}</TableCell>
                                                <TableCell align="right">{c.wire_calc?.waste_ft}</TableCell>
                                                <TableCell align="right"><strong>{c.total_wire_length}</strong></TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </AccordionDetails>
                        </Accordion>
                    )}

                    {panelSchedule.length > 0 && (
                        <Accordion sx={{ mb: 2 }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography fontWeight="bold">🔌 Panel Schedule ({panelSchedule.length} breakers)</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Table size="small">
                                    <TableHead sx={{ bgcolor: '#e3f2fd' }}>
                                        <TableRow>
                                            <TableCell><strong>Circuit ID</strong></TableCell>
                                            <TableCell><strong>Breaker Type</strong></TableCell>
                                            <TableCell align="right"><strong>Amps</strong></TableCell>
                                            <TableCell align="right"><strong>Poles</strong></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {panelSchedule.map((p, idx) => (
                                            <TableRow key={idx}>
                                                <TableCell>{p.circuit_id}</TableCell>
                                                <TableCell>
                                                    {p.breaker_type}
                                                    {p.breaker_type?.includes('RCBO') && <Chip label="GFCI" size="small" color="error" sx={{ ml: 1, height: 18, fontSize: 10 }} />}
                                                </TableCell>
                                                <TableCell align="right">{p.amps}A</TableCell>
                                                <TableCell align="right">{p.poles}P</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </AccordionDetails>
                        </Accordion>
                    )}

                    <Divider sx={{ my: 2 }} />
                    
                    <Typography fontWeight="bold" mb={1}>📋 Bill of Materials</Typography>
                    <Paper variant="outlined" sx={{ bgcolor: 'white' }}>
                        <Table size="small">
                            <TableHead sx={{ bgcolor: '#f5f5f5' }}>
                                <TableRow>
                                    <TableCell><strong>Material / Labor</strong></TableCell>
                                    <TableCell><strong>Category</strong></TableCell>
                                    <TableCell align="right"><strong>Qty</strong></TableCell>
                                    <TableCell><strong>Unit</strong></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {bom.map((item, idx) => (
                                    <TableRow key={idx}>
                                        <TableCell>{item.item}</TableCell>
                                        <TableCell>
                                            <Chip label={item.category || 'general'} size="small" sx={{ height: 20 }} />
                                        </TableCell>
                                        <TableCell align="right">{item.qty}</TableCell>
                                        <TableCell>{item.unit}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Paper>

                    <Box display="flex" gap={2} mt={3}>
                        <Button variant="contained" color="success" onClick={approvePipeline} disableElevation>
                            Looks Good, Get Prices
                        </Button>
                        <Button variant="outlined" color="error" onClick={() => { setStatus('idle'); setError(''); setParsedJson(null); }}>
                            Reject
                        </Button>
                    </Box>
                </Box>
            )}

            {status === 'pricing' && (
                <Box p={3} bgcolor="white" borderRadius={2} border="1px dashed #ccc">
                    <Box display="flex" alignItems="center" gap={2} mb={2}>
                        <CircularProgress size={24} />
                        <Typography><strong>💰 Pricing Agent querying Qdrant Vector DB...</strong></Typography>
                    </Box>
                    <LinearProgress variant="indeterminate" sx={{ borderRadius: 1 }} />
                </Box>
            )}

            {status === 'completed' && (
                <Box>
                    <Alert severity="success" sx={{ mb: 3 }}>
                        <strong>Pipeline Completed!</strong> The Pricing Agent queried the Qdrant Vector DB for material costs.
                    </Alert>
                    <Paper variant="outlined" sx={{ p: 3, bgcolor: '#f4fbf5', borderColor: '#cce8d2' }}>
                        <Typography variant="h6">Total Computed Cost: <strong>${totalCost.toFixed(2)}</strong></Typography>
                        <Typography variant="body2" color="textSecondary">
                            Detailed BOM with prices has been exported to <code>bom_export.csv</code>.
                        </Typography>
                    </Paper>

                    {bom.some(item => item.unit_price !== undefined) && (
                        <Accordion sx={{ mt: 2 }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography fontWeight="bold">📊 Priced BOM ({bom.length} items)</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Table size="small">
                                    <TableHead sx={{ bgcolor: '#e8f5e9' }}>
                                        <TableRow>
                                            <TableCell><strong>Item</strong></TableCell>
                                            <TableCell align="right"><strong>Qty</strong></TableCell>
                                            <TableCell><strong>Unit</strong></TableCell>
                                            <TableCell align="right"><strong>Unit $</strong></TableCell>
                                            <TableCell align="right"><strong>Total $</strong></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {bom.map((item, idx) => (
                                            <TableRow key={idx}>
                                                <TableCell>{item.item}</TableCell>
                                                <TableCell align="right">{item.qty}</TableCell>
                                                <TableCell>{item.unit}</TableCell>
                                                <TableCell align="right">${item.unit_price?.toFixed(2) || '0.00'}</TableCell>
                                                <TableCell align="right"><strong>${item.total_price?.toFixed(2) || '0.00'}</strong></TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </AccordionDetails>
                        </Accordion>
                    )}

                    <Button variant="outlined" sx={{ mt: 3 }} onClick={() => { setStatus('idle'); setError(''); setParsedJson(null); setTotalCost(0); setBom([]); setCircuits([]); setPanelSchedule([]); }}>Run Another Blueprint</Button>
                </Box>
            )}
        </Paper>
    );
};
