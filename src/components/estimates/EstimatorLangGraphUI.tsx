import React, { useState } from 'react';
import { 
    Box, Button, Typography, Paper, Table, TableBody, 
    TableCell, TableHead, TableRow, CircularProgress, Alert, Chip,
    MenuItem, Select, Divider, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

export const EstimatorLangGraphUI: React.FC = () => {
    const [status, setStatus] = useState<'idle' | 'processing' | 'review' | 'completed'>('idle');
    const [bom, setBom] = useState<any[]>([]);
    const [circuits, setCircuits] = useState<any[]>([]);
    const [panelSchedule, setPanelSchedule] = useState<any[]>([]);
    const [threadId, setThreadId] = useState<string>('');
    const [totalCost, setTotalCost] = useState<number>(0);
    const [blueprintType, setBlueprintType] = useState<string>('P');
    const [blueprintFile, setBlueprintFile] = useState<string>('plumbing_layout_P1.pdf');

    const handleFileChange = (e: any) => {
        const val = e.target.value;
        setBlueprintFile(val);
        setBlueprintType(val.includes('electrical') ? 'E' : 'P');
    };

    const startPipeline = async () => {
        setStatus('processing');
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
            setStatus('idle');
            alert("Failed to connect to local LangGraph API on port 8000.");
        }
    };

    const approvePipeline = async () => {
        setStatus('processing');
        try {
            const res = await fetch('http://localhost:8000/api/estimate/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thread_id: threadId, approve: true })
            });
            const data = await res.json();
            setTotalCost(data.total_cost || 0.0);
            setStatus('completed');
        } catch (e) {
            console.error(e);
            setStatus('review');
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 4, mb: 4, bgcolor: '#fbfbfb', borderLeft: '4px solid #3f51b5' }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h5" fontWeight="bold">Multi-Agent AI Estimator (LangGraph)</Typography>
                <Chip label="Phase 9 — Deterministic Tools" color="primary" size="small" />
            </Box>
            
            <Typography variant="body2" color="textSecondary" mb={3}>
                This panel connects directly to the local Python LangGraph Orchestrator. 
                Electrical estimates use <strong>deterministic geometry tools</strong> (Manhattan distance, daisy-chaining, NEC code compliance)
                — zero LLM math errors, 100% reproducible results.
            </Typography>
            
            {status === 'idle' && (
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
                                        {circuits.map((c: any, idx: number) => (
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
                                        {panelSchedule.map((p: any, idx: number) => (
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
                        <Button variant="outlined" color="error" onClick={() => setStatus('idle')}>
                            Reject
                        </Button>
                    </Box>
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
                    <Button variant="outlined" sx={{ mt: 3 }} onClick={() => setStatus('idle')}>Run Another Blueprint</Button>
                </Box>
            )}
        </Paper>
    );
};
