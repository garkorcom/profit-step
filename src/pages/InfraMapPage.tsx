import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  LinearProgress,
  TextField,
  InputAdornment,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Collapse,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Circle as CircleIcon,
  Search as SearchIcon,
  Memory as MemoryIcon,
  Storage as StorageIcon,
  Speed as SpeedIcon,
  Dns as DnsIcon,
  SmartToy as BotIcon,
  AccountTree as TopologyIcon,
  ViewModule as CardsIcon,
  Send as SendIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  MiscellaneousServices as ServicesIcon,
} from '@mui/icons-material';
import * as d3 from 'd3';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ServerMetrics {
  cpu: number;
  ram: number;
  disk: number;
  load: number;
}

interface Server {
  id: string;
  name: string;
  emoji: string;
  ip: string;
  os: string;
  metrics: ServerMetrics;
  agent_count: number;
  service_count: number;
}

interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  model: string;
  provider: string;
  api_key: string;
  status: string;
  server_id: string;
  server_name: string;
  server_emoji: string;
  today_input: number;
  today_output: number;
  today_cost: number;
}

interface TopologyLink {
  source: string;
  target: string;
  type: string;
}

interface Service {
  id: string;
  name: string;
  status: string;
  port: number;
  server_id: string;
  server_name: string;
  server_emoji: string;
}

// ─── API Config ──────────────────────────────────────────────────────────────

const INFRA_API = import.meta.env.VITE_INFRA_API_URL || 'http://localhost:8001';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'active': case 'running': return '#4caf50';
    case 'idle': return '#ff9800';
    case 'error': case 'stopped': return '#f44336';
    default: return '#9e9e9e';
  }
};

const getMetricColor = (value: number) => {
  if (value < 50) return '#4caf50';
  if (value < 80) return '#ff9800';
  return '#f44336';
};

const providerColors: Record<string, string> = {
  'claude-web': '#D97706',
  'anthropic': '#D97706',
  'google': '#1a73e8',
  'openai': '#10a37f',
  'deepseek': '#6366f1',
};

const providerGradients: Record<string, string> = {
  'claude-web': 'linear-gradient(135deg, #D97706 0%, #92400E 100%)',
  'anthropic': 'linear-gradient(135deg, #D97706 0%, #92400E 100%)',
  'google': 'linear-gradient(135deg, #1a73e8 0%, #0d47a1 100%)',
  'openai': 'linear-gradient(135deg, #10a37f 0%, #0e7c60 100%)',
  'deepseek': 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
};

// ─── D3 Topology Map ────────────────────────────────────────────────────────

interface TopologyMapProps {
  agents: Agent[];
  servers: Server[];
  links: TopologyLink[];
  onAgentClick: (agent: Agent) => void;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  emoji: string;
  role: string;
  model: string;
  provider: string;
  server_id: string;
  status: string;
  is_coordinator: boolean;
  today_input: number;
  today_output: number;
  today_cost: number;
}

const TopologyMap: React.FC<TopologyMapProps> = ({ agents, servers, links, onAgentClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || agents.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = Math.max(500, Math.min(700, window.innerHeight * 0.6));

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);

    // Build nodes
    const coordinatorIds = new Set(links.map(l => l.source));
    const nodes: D3Node[] = agents.map(a => ({
      id: a.id,
      name: a.name,
      emoji: a.emoji,
      role: a.role,
      model: a.model,
      provider: a.provider,
      server_id: a.server_id,
      status: a.status,
      is_coordinator: coordinatorIds.has(a.id) && !links.some(l => l.target === a.id),
      today_input: a.today_input,
      today_output: a.today_output,
      today_cost: a.today_cost,
    }));

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const simLinks = links
      .filter(l => nodeMap.has(l.source) && nodeMap.has(l.target))
      .map(l => ({ source: l.source, target: l.target, type: l.type }));

    // Defs
    const defs = svg.append('defs');
    // Glow filter
    const filter = defs.append('filter').attr('id', 'glow');
    filter.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'blur');
    filter.append('feMerge')
      .selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic'])
      .join('feMergeNode')
      .attr('in', d => d);

    // Server cluster groups (background)
    const clusterLayer = svg.append('g').attr('class', 'clusters');
    const serverGroups: Record<string, d3.Selection<SVGGElement, unknown, null, undefined>> = {};
    servers.forEach(s => {
      serverGroups[s.id] = clusterLayer.append('g');
    });

    // Links
    const linkLayer = svg.append('g').attr('class', 'links');
    const link = linkLayer.selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', d => {
        const src = nodeMap.get(d.source as string);
        const tgt = nodeMap.get(d.target as string);
        return src?.server_id !== tgt?.server_id ? 'rgba(245,158,11,0.3)' : 'rgba(99,102,241,0.15)';
      })
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', d => {
        const src = nodeMap.get(d.source as string);
        const tgt = nodeMap.get(d.target as string);
        return src?.server_id !== tgt?.server_id ? '4,4' : 'none';
      });

    // Animated particles on cross-server links
    const crossLinks = simLinks.filter(l => {
      const s = nodeMap.get(l.source as string);
      const t = nodeMap.get(l.target as string);
      return s?.server_id !== t?.server_id;
    });

    const particleLayer = svg.append('g').attr('class', 'particles');
    const particles = particleLayer.selectAll('circle')
      .data(crossLinks)
      .join('circle')
      .attr('r', 2.5)
      .attr('fill', '#f59e0b')
      .attr('opacity', 0.7);

    // Nodes
    const nodeLayer = svg.append('g').attr('class', 'nodes');
    const node = nodeLayer.selectAll<SVGGElement, D3Node>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (_, d) => {
        const agent = agents.find(a => a.id === d.id);
        if (agent) onAgentClick(agent);
      })
      .call(d3.drag<SVGGElement, D3Node>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x; d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
      );

    // Pulse ring
    node.append('circle')
      .attr('r', d => d.is_coordinator ? 32 : 24)
      .attr('fill', 'none')
      .attr('stroke', d => providerColors[d.provider] || '#6366f1')
      .attr('stroke-width', 2)
      .attr('opacity', 0.3)
      .style('animation', 'pulse 2s ease-in-out infinite');

    // Main circle
    node.append('circle')
      .attr('r', d => d.is_coordinator ? 26 : 20)
      .attr('fill', d => {
        const c = providerColors[d.provider] || '#6366f1';
        return c + '33';
      })
      .attr('stroke', d => providerColors[d.provider] || '#6366f1')
      .attr('stroke-width', 2)
      .attr('filter', 'url(#glow)');

    // Emoji
    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', d => d.is_coordinator ? 20 : 16)
      .attr('pointer-events', 'none')
      .text(d => d.emoji);

    // Label
    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => d.is_coordinator ? 42 : 34)
      .attr('fill', 'rgba(255,255,255,0.85)')
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .attr('font-family', "'Inter', sans-serif")
      .attr('pointer-events', 'none')
      .style('text-shadow', '0 1px 3px rgba(0,0,0,0.8)')
      .text(d => d.name);

    // Tooltip
    const tooltip = d3.select(container).append('div')
      .attr('class', 'topology-tooltip')
      .style('position', 'absolute')
      .style('display', 'none')
      .style('background', 'rgba(15,15,20,0.95)')
      .style('border', '1px solid rgba(99,102,241,0.3)')
      .style('border-radius', '12px')
      .style('padding', '12px 16px')
      .style('font-size', '13px')
      .style('font-family', "'Inter', sans-serif")
      .style('color', '#e0e0e0')
      .style('pointer-events', 'none')
      .style('z-index', 1000)
      .style('backdrop-filter', 'blur(10px)')
      .style('box-shadow', '0 8px 32px rgba(0,0,0,0.5)');

    node.on('mouseenter', function(event, d) {
      const rect = container.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      tooltip
        .html(`
          <div style="font-size:20px;margin-bottom:4px">${d.emoji} <strong>${d.name}</strong></div>
          <div style="color:#999;margin-bottom:6px">${d.role}</div>
          <div>🧠 ${d.model}</div>
          <div>📤 ${formatTokens(d.today_input)} ↗ &nbsp; 📥 ${formatTokens(d.today_output)} ↙</div>
          <div>${d.today_cost > 0 ? `💰 $${d.today_cost.toFixed(4)}` : '🆓 FREE'}</div>
        `)
        .style('left', (mx + 16) + 'px')
        .style('top', (my - 20) + 'px')
        .style('display', 'block');
    })
    .on('mouseleave', () => tooltip.style('display', 'none'));

    // Simulation
    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink(simLinks).id((d: any) => d.id).distance(90).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('x', d3.forceX(width / 2).strength(0.08))
      .force('y', d3.forceY(height / 2).strength(0.08))
      .force('collision', d3.forceCollide((d: D3Node) => d.is_coordinator ? 50 : 35))
      .on('tick', () => {
        link
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y);

        node.attr('transform', d => `translate(${d.x},${d.y})`);

        // Particles
        const t = (Date.now() % 3000) / 3000;
        particles
          .attr('cx', (d: any) => d.source.x + (d.target.x - d.source.x) * t)
          .attr('cy', (d: any) => d.source.y + (d.target.y - d.source.y) * t);

        // Cluster circles
        servers.forEach(s => {
          const sAgents = nodes.filter(n => n.server_id === s.id);
          if (!sAgents.length) return;
          const cx = d3.mean(sAgents, a => a.x!) || 0;
          const cy = d3.mean(sAgents, a => a.y!) || 0;
          const maxR = (d3.max(sAgents, a =>
            Math.sqrt((a.x! - cx) ** 2 + (a.y! - cy) ** 2)) || 0) + 55;

          const cluster = serverGroups[s.id];
          cluster.selectAll('*').remove();
          cluster.append('circle')
            .attr('cx', cx).attr('cy', cy).attr('r', maxR)
            .attr('fill', 'none')
            .attr('stroke', s.id === 'mac' ? 'rgba(99,102,241,0.15)' : 'rgba(245,158,11,0.15)')
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '6,4');
          cluster.append('text')
            .attr('x', cx).attr('y', cy - maxR - 10)
            .attr('text-anchor', 'middle')
            .attr('fill', 'rgba(255,255,255,0.45)')
            .attr('font-size', 13)
            .attr('font-weight', 600)
            .attr('font-family', "'Inter', sans-serif")
            .text(`${s.emoji} ${s.name}`);
        });
      });

    // CSS for pulse
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 0.4; transform: scale(1); }
        50% { opacity: 0.15; transform: scale(1.12); }
      }
    `;
    document.head.appendChild(style);

    return () => {
      simulation.stop();
      tooltip.remove();
      style.remove();
    };
  }, [agents, servers, links, onAgentClick]);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        borderRadius: 3,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, rgba(15,15,25,1) 0%, rgba(20,20,35,1) 100%)',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />
    </Box>
  );
};

// ─── MetricBar ───────────────────────────────────────────────────────────────

const MetricBar: React.FC<{ label: string; value: number; icon: React.ReactNode }> = ({ label, value, icon }) => (
  <Box sx={{ mb: 1 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {icon}
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>{label}</Typography>
      </Box>
      <Typography variant="caption" sx={{ fontWeight: 600, color: getMetricColor(value), fontSize: '0.7rem' }}>
        {value.toFixed(0)}%
      </Typography>
    </Box>
    <LinearProgress
      variant="determinate"
      value={Math.min(value, 100)}
      sx={{
        height: 4,
        borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.06)',
        '& .MuiLinearProgress-bar': { bgcolor: getMetricColor(value), borderRadius: 2 },
      }}
    />
  </Box>
);

// ─── AgentCard ───────────────────────────────────────────────────────────────

const AgentCard: React.FC<{ agent: Agent; onClick: (a: Agent) => void }> = ({ agent, onClick }) => (
  <Paper
    elevation={0}
    onClick={() => onClick(agent)}
    sx={{
      p: 1.5,
      borderRadius: 2,
      border: '1px solid',
      borderColor: 'divider',
      cursor: 'pointer',
      transition: 'all 0.2s',
      '&:hover': {
        borderColor: getStatusColor(agent.status),
        transform: 'translateY(-2px)',
        boxShadow: `0 4px 12px ${getStatusColor(agent.status)}22`,
      },
    }}
  >
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <Typography sx={{ fontSize: '1.3rem' }}>{agent.emoji}</Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{agent.name}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>{agent.role}</Typography>
      </Box>
      <CircleIcon sx={{ fontSize: 8, color: getStatusColor(agent.status) }} />
    </Box>
    <Chip
      label={agent.model}
      size="small"
      sx={{
        height: 20, fontSize: '0.6rem', fontWeight: 600, mb: 0.8,
        background: providerGradients[agent.provider] || 'rgba(128,128,128,0.2)',
        color: '#fff',
      }}
    />
    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem' }}>
        ↗ {formatTokens(agent.today_input)}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem' }}>
        ↙ {formatTokens(agent.today_output)}
      </Typography>
      {agent.today_cost > 0 && (
        <Typography variant="caption" sx={{ color: '#ff9800', fontSize: '0.6rem', fontWeight: 600 }}>
          ${agent.today_cost.toFixed(2)}
        </Typography>
      )}
    </Box>
  </Paper>
);

// ─── ServerCard ──────────────────────────────────────────────────────────────

const ServerCard: React.FC<{ server: Server; agents: Agent[]; onAgentClick: (a: Agent) => void }> = ({ server, agents, onAgentClick }) => (
  <Paper
    elevation={0}
    sx={{
      borderRadius: 3,
      border: '1px solid',
      borderColor: 'divider',
      overflow: 'hidden',
      transition: 'all 0.3s',
      '&:hover': { borderColor: 'primary.main' },
    }}
  >
    <Box
      sx={{
        background: 'linear-gradient(135deg, rgba(25,118,210,0.08) 0%, rgba(25,118,210,0.02) 100%)',
        p: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Typography sx={{ fontSize: '2rem' }}>{server.emoji}</Typography>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{server.name}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {server.ip} · {server.os} · {server.agent_count} агентов
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        <MetricBar label="CPU" value={server.metrics.cpu} icon={<SpeedIcon sx={{ fontSize: 12, color: 'text.secondary' }} />} />
        <MetricBar label="RAM" value={server.metrics.ram} icon={<MemoryIcon sx={{ fontSize: 12, color: 'text.secondary' }} />} />
        <MetricBar label="Disk" value={server.metrics.disk} icon={<StorageIcon sx={{ fontSize: 12, color: 'text.secondary' }} />} />
        <MetricBar label="Load" value={Math.min(server.metrics.load * 25, 100)} icon={<DnsIcon sx={{ fontSize: 12, color: 'text.secondary' }} />} />
      </Box>
    </Box>
    <Box sx={{ p: 1.5 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          gap: 1,
        }}
      >
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onClick={onAgentClick} />
        ))}
      </Box>
    </Box>
  </Paper>
);

// ─── Task Modal ──────────────────────────────────────────────────────────────

interface TaskModalProps {
  agent: Agent | null;
  open: boolean;
  onClose: () => void;
}

const TaskModal: React.FC<TaskModalProps> = ({ agent, open, onClose }) => {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!agent || !message.trim()) return;
    setSending(true);
    setResponse(null);
    setError(null);

    try {
      const res = await fetch(`${INFRA_API}/api/agents/${agent.id}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setResponse(typeof data.response === 'string' ? data.response : JSON.stringify(data.response, null, 2));
      } else {
        setError(data.error || 'Ошибка');
      }
    } catch (e) {
      setError(`Сеть: ${e instanceof Error ? e.message : 'Ошибка'}`);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSend();
  };

  useEffect(() => {
    if (!open) {
      setMessage('');
      setResponse(null);
      setError(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: '1.5rem' }}>{agent?.emoji}</Typography>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{agent?.name}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {agent?.model} · {agent?.server_name}
          </Typography>
        </Box>
        <IconButton onClick={onClose} sx={{ ml: 'auto' }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          multiline
          rows={3}
          placeholder="Введите задачу для агента... (Ctrl+Enter для отправки)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          sx={{ mt: 1 }}
        />
        {error && <Alert severity="error" sx={{ mt: 1 }}>❌ {error}</Alert>}
        {response && (
          <Paper
            elevation={0}
            sx={{
              mt: 2, p: 2,
              bgcolor: 'rgba(76,175,80,0.05)',
              border: '1px solid rgba(76,175,80,0.2)',
              borderRadius: 2,
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            <Typography variant="caption" sx={{ color: '#4caf50', fontWeight: 600 }}>✅ Результат:</Typography>
            <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.8rem' }}>
              {response}
            </Typography>
          </Paper>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
        <Button
          variant="contained"
          startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
          onClick={handleSend}
          disabled={sending || !message.trim()}
        >
          {sending ? 'Отправляю...' : '🚀 Отправить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────────

const InfraMapPage: React.FC = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [links, setLinks] = useState<TopologyLink[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'map' | 'cards'>('map');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [servicesOpen, setServicesOpen] = useState(false);

  // Task modal
  const [taskAgent, setTaskAgent] = useState<Agent | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);

  const handleAgentClick = useCallback((agent: Agent) => {
    setTaskAgent(agent);
    setTaskOpen(true);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [agentsRes, serversRes, topologyRes, servicesRes] = await Promise.all([
        fetch(`${INFRA_API}/api/agents`),
        fetch(`${INFRA_API}/api/servers`),
        fetch(`${INFRA_API}/api/topology`),
        fetch(`${INFRA_API}/api/services`),
      ]);

      if (!agentsRes.ok || !serversRes.ok) throw new Error('Сервер инфраструктуры недоступен');

      const [agentsData, serversData] = await Promise.all([agentsRes.json(), serversRes.json()]);

      setAgents(agentsData);
      setServers(serversData);
      if (topologyRes.ok) setLinks((await topologyRes.json()).links || []);
      if (servicesRes.ok) setServices(await servicesRes.json());
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRefresh = () => { setLoading(true); fetchData(); };

  const filteredAgents = agents.filter(
    (a) =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.role.toLowerCase().includes(search.toLowerCase()) ||
      a.model.toLowerCase().includes(search.toLowerCase()),
  );

  const totalInput = agents.reduce((sum, a) => sum + a.today_input, 0);
  const totalOutput = agents.reduce((sum, a) => sum + a.today_output, 0);
  const totalCost = agents.reduce((sum, a) => sum + a.today_cost, 0);
  const activeAgents = agents.filter((a) => a.status === 'active').length;

  // Provider breakdown
  const providerBreakdown = agents.reduce<Record<string, { count: number; tokens: number; cost: number }>>((acc, a) => {
    const p = a.provider;
    if (!acc[p]) acc[p] = { count: 0, tokens: 0, cost: 0 };
    acc[p].count++;
    acc[p].tokens += a.today_input + a.today_output;
    acc[p].cost += a.today_cost;
    return acc;
  }, {});

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
            <BotIcon sx={{ fontSize: 36, color: 'primary.main' }} />
            AI Инфраструктура
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {lastUpdate ? `Обновлено ${lastUpdate.toLocaleTimeString('ru-RU')} · авто-обновление 30 сек` : 'Загрузка...'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
            size="small"
          >
            <ToggleButton value="map"><Tooltip title="Карта"><TopologyIcon /></Tooltip></ToggleButton>
            <ToggleButton value="cards"><Tooltip title="Карточки"><CardsIcon /></Tooltip></ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title="Обновить">
            <IconButton onClick={handleRefresh} disabled={loading}>
              <RefreshIcon sx={{
                animation: loading ? 'spin 1s linear infinite' : 'none',
                '@keyframes spin': { '100%': { transform: 'rotate(360deg)' } }
              }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error}. Убедитесь что Infra Dashboard запущен на {INFRA_API}
        </Alert>
      )}

      {/* Stats Summary */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 2, mb: 3 }}>
        {[
          { label: 'Серверов', value: String(servers.length), icon: '🖥️' },
          { label: 'AI Агентов', value: `${activeAgents}/${agents.length}`, icon: '🤖' },
          { label: 'Токенов ↗', value: formatTokens(totalInput), icon: '📤' },
          { label: 'Токенов ↙', value: formatTokens(totalOutput), icon: '📥' },
          { label: 'Стоимость', value: totalCost > 0 ? `$${totalCost.toFixed(2)}` : 'FREE', icon: '💰' },
        ].map((stat) => (
          <Paper
            key={stat.label}
            elevation={0}
            sx={{ p: 1.5, textAlign: 'center', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
          >
            <Typography sx={{ fontSize: '1.3rem', mb: 0.3 }}>{stat.icon}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.1rem' }}>{stat.value}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{stat.label}</Typography>
          </Paper>
        ))}
      </Box>

      {/* Provider breakdown chips */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        {Object.entries(providerBreakdown).map(([provider, data]) => (
          <Chip
            key={provider}
            label={`${provider} · ${data.count} агентов · ${formatTokens(data.tokens)} tok${data.cost > 0 ? ` · $${data.cost.toFixed(2)}` : ''}`}
            size="small"
            sx={{
              background: providerGradients[provider] || 'rgba(128,128,128,0.2)',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.7rem',
            }}
          />
        ))}
      </Box>

      {/* Search */}
      <TextField
        fullWidth
        size="small"
        placeholder="Поиск по агентам, моделям, ролям..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 3 }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: 'text.secondary' }} /></InputAdornment>,
        }}
      />

      {/* Loading */}
      {loading && agents.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      )}

      {/* Map or Cards */}
      {viewMode === 'map' && agents.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <TopologyMap agents={filteredAgents} servers={servers} links={links} onAgentClick={handleAgentClick} />
        </Box>
      )}

      {viewMode === 'cards' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mb: 3 }}>
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              agents={filteredAgents.filter((a) => a.server_id === server.id)}
              onAgentClick={handleAgentClick}
            />
          ))}
        </Box>
      )}

      {/* Services Section */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Box
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            p: 2, cursor: 'pointer',
          }}
          onClick={() => setServicesOpen(!servicesOpen)}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ServicesIcon sx={{ color: 'text.secondary' }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Сервисы ({services.length})
            </Typography>
          </Box>
          {servicesOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </Box>
        <Collapse in={servicesOpen}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Сервис</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Порт</TableCell>
                <TableCell>Сервер</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {services.map((svc) => (
                <TableRow key={svc.id}>
                  <TableCell sx={{ fontWeight: 600 }}>{svc.name}</TableCell>
                  <TableCell>
                    <Chip
                      icon={<CircleIcon sx={{ fontSize: '8px !important' }} />}
                      label={svc.status}
                      size="small"
                      sx={{
                        height: 22,
                        bgcolor: svc.status === 'running' ? 'rgba(76,175,80,0.1)' : 'rgba(244,67,54,0.1)',
                        color: getStatusColor(svc.status),
                        fontWeight: 600,
                        fontSize: '0.7rem',
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{svc.port}</TableCell>
                  <TableCell>{svc.server_emoji} {svc.server_name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Collapse>
      </Paper>

      {/* Task Modal */}
      <TaskModal agent={taskAgent} open={taskOpen} onClose={() => setTaskOpen(false)} />
    </Container>
  );
};

export default InfraMapPage;
