import React, { useState } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Button,
  Chip,
  Alert,
  IconButton,
  Tooltip,
  InputBase,
  Divider,
  Avatar,
} from '@mui/material';
import {
  Campaign as CampaignIcon,
  OpenInNew as OpenInNewIcon,
  ContentCopy as CopyIcon,
  Search as SearchIcon,
  RocketLaunch as RocketIcon,
  Science as ScienceIcon,
  Archive as ArchiveIcon,
  FilterList as FilterIcon,
  AutoAwesome as SparkleIcon,
  Language as GlobeIcon,
  Code as CodeIcon,
  CheckCircle as CheckIcon,
} from '@mui/icons-material';

// Glob all index files inside ideas to extract metadata
const ideaModules: Record<string, any> = import.meta.glob(
  '../../../landings/ideas/*/build/index.tsx',
  { eager: true }
);

// Soft gradient accent per card
const CARD_ACCENTS = [
  { bg: 'linear-gradient(135deg, #e8eaf6 0%, #c5cae9 100%)', color: '#3949ab', icon: '🚀' },
  { bg: 'linear-gradient(135deg, #fce4ec 0%, #f8bbd0 100%)', color: '#c62828', icon: '🎯' },
  { bg: 'linear-gradient(135deg, #e0f7fa 0%, #b2ebf2 100%)', color: '#00838f', icon: '⚡' },
  { bg: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)', color: '#2e7d32', icon: '🌿' },
  { bg: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)', color: '#e65100', icon: '🔥' },
  { bg: 'linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%)', color: '#7b1fa2', icon: '💎' },
  { bg: 'linear-gradient(135deg, #ede7f6 0%, #d1c4e9 100%)', color: '#4527a0', icon: '✨' },
  { bg: 'linear-gradient(135deg, #e1f5fe 0%, #b3e5fc 100%)', color: '#0277bd', icon: '🌊' },
  { bg: 'linear-gradient(135deg, #fbe9e7 0%, #ffccbc 100%)', color: '#bf360c', icon: '🎨' },
];

const STATUS_MAP: Record<string, { icon: React.ReactElement; chipColor: 'success' | 'warning' | 'default'; label: string }> = {
  Live: { icon: <RocketIcon sx={{ fontSize: 14 }} />, chipColor: 'success', label: 'Live' },
  Draft: { icon: <ScienceIcon sx={{ fontSize: 14 }} />, chipColor: 'warning', label: 'Draft' },
  Archived: { icon: <ArchiveIcon sx={{ fontSize: 14 }} />, chipColor: 'default', label: 'Archived' },
};

const LandingsPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Extract landings from modules
  const landings = Object.entries(ideaModules).map(([path, module], index) => {
    const match = path.match(/ideas\/([^/]+)\/build/);
    const ideaName = match ? match[1] : 'unknown';
    const meta = module.metadata || {};

    return {
      id: ideaName,
      title: meta.title || ideaName,
      description: meta.description || 'Нет описания',
      status: (meta.status as string) || 'Draft',
      url: `/l/${ideaName}`,
      tech: (meta.tech as string[]) || ['React'],
      accent: CARD_ACCENTS[index % CARD_ACCENTS.length],
    };
  });

  // Filter & search
  const filteredLandings = landings.filter((l) => {
    const matchesSearch =
      l.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === 'all' || l.status === activeFilter;
    return matchesSearch && matchesFilter;
  });

  // Stats
  const stats = {
    total: landings.length,
    live: landings.filter((l) => l.status === 'Live').length,
    draft: landings.filter((l) => l.status === 'Draft').length,
    archived: landings.filter((l) => l.status === 'Archived').length,
  };

  const handleCopy = (url: string, id: string) => {
    const fullUrl = `${window.location.origin}${url}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* ─── Header ─── */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <Avatar
            sx={{
              width: 48,
              height: 48,
              bgcolor: 'primary.main',
              borderRadius: 3,
            }}
          >
            <CampaignIcon sx={{ fontSize: 26 }} />
          </Avatar>
          <Box>
            <Typography variant="h4" fontWeight={800} color="text.primary" sx={{ letterSpacing: '-0.5px' }}>
              Idea Hub
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Центр управления лендингами и промо-страницами
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* ─── Stats Row ─── */}
      <Box sx={{ display: 'flex', gap: 2, mb: 4, flexWrap: 'wrap' }}>
        {[
          { label: 'Всего', value: stats.total, color: 'primary.main', bgColor: 'primary.lighter' },
          { label: 'Live', value: stats.live, color: 'success.main', bgColor: '#e8f5e9' },
          { label: 'Draft', value: stats.draft, color: 'warning.main', bgColor: '#fff8e1' },
          { label: 'Archived', value: stats.archived, color: 'text.secondary', bgColor: '#f5f5f5' },
        ].map((stat) => (
          <Paper
            key={stat.label}
            variant="outlined"
            sx={{
              px: 3,
              py: 1.5,
              borderRadius: 3,
              minWidth: 100,
              textAlign: 'center',
              borderColor: 'divider',
              transition: 'all 0.2s ease',
              '&:hover': {
                boxShadow: 2,
                transform: 'translateY(-2px)',
              },
            }}
          >
            <Typography variant="h5" fontWeight={800} color={stat.color}>
              {stat.value}
            </Typography>
            <Typography variant="caption" color="text.secondary" fontWeight={500}>
              {stat.label}
            </Typography>
          </Paper>
        ))}
      </Box>

      {/* ─── Toolbar: Search + Filters ─── */}
      <Paper
        variant="outlined"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          mb: 4,
          px: 2,
          py: 1,
          borderRadius: 3,
          flexWrap: 'wrap',
        }}
      >
        {/* Search */}
        <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 200 }}>
          <SearchIcon sx={{ color: 'text.disabled', mr: 1 }} />
          <InputBase
            placeholder="Поиск по названию, описанию..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ flex: 1, fontSize: '0.95rem' }}
          />
        </Box>

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        {/* Filters */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <FilterIcon sx={{ color: 'text.disabled', fontSize: 20 }} />
          {['all', 'Live', 'Draft', 'Archived'].map((filter) => (
            <Chip
              key={filter}
              label={filter === 'all' ? 'Все' : filter}
              size="small"
              variant={activeFilter === filter ? 'filled' : 'outlined'}
              color={activeFilter === filter ? 'primary' : 'default'}
              onClick={() => setActiveFilter(filter)}
              sx={{
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            />
          ))}
        </Box>
      </Paper>

      {/* ─── Card Grid ─── */}
      {filteredLandings.length === 0 ? (
        <Alert severity="info" sx={{ borderRadius: 3 }}>
          {searchQuery || activeFilter !== 'all'
            ? 'Нет лендингов по заданным фильтрам'
            : 'Нет доступных лендингов. Создайте папку в /landings/ideas/'}
        </Alert>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              md: 'repeat(3, 1fr)',
            },
            gap: 3,
          }}
        >
          {filteredLandings.map((landing) => {
            const statusConf = STATUS_MAP[landing.status] || STATUS_MAP.Draft;

            return (
              <Paper
                key={landing.id}
                variant="outlined"
                sx={{
                  borderRadius: 4,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                    borderColor: 'primary.light',
                  },
                }}
              >
                {/* Accent header strip */}
                <Box
                  sx={{
                    background: landing.accent.bg,
                    px: 3,
                    py: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Typography fontSize="1.5rem">{landing.accent.icon}</Typography>
                    <Box>
                      <Typography
                        variant="subtitle1"
                        fontWeight={700}
                        sx={{
                          color: landing.accent.color,
                          lineHeight: 1.3,
                          fontSize: '1rem',
                        }}
                      >
                        {landing.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: landing.accent.color,
                          opacity: 0.6,
                          fontFamily: 'monospace',
                          fontSize: '0.7rem',
                        }}
                      >
                        /l/{landing.id}
                      </Typography>
                    </Box>
                  </Box>

                  <Chip
                    icon={statusConf.icon}
                    label={statusConf.label}
                    size="small"
                    color={statusConf.chipColor}
                    sx={{ fontWeight: 700, fontSize: '0.72rem' }}
                  />
                </Box>

                {/* Body */}
                <Box sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2.5, flexGrow: 1, lineHeight: 1.6 }}
                  >
                    {landing.description}
                  </Typography>

                  {/* Tech tags */}
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7, mb: 2.5 }}>
                    {landing.tech.map((t: string) => (
                      <Chip
                        key={t}
                        label={t}
                        size="small"
                        variant="outlined"
                        icon={<CodeIcon sx={{ fontSize: '14px !important' }} />}
                        sx={{
                          fontSize: '0.72rem',
                          height: 24,
                          '& .MuiChip-icon': { ml: 0.5 },
                        }}
                      />
                    ))}
                  </Box>

                  {/* Actions */}
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <Button
                      variant="contained"
                      size="small"
                      endIcon={<OpenInNewIcon sx={{ fontSize: '16px !important' }} />}
                      href={landing.url}
                      target="_blank"
                      sx={{
                        flex: 1,
                        borderRadius: 2.5,
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        py: 1,
                        boxShadow: 1,
                        '&:hover': {
                          boxShadow: 3,
                        },
                      }}
                    >
                      Открыть сайт
                    </Button>

                    <Tooltip title={copiedId === landing.id ? '✓ Скопировано!' : 'Копировать ссылку'} arrow>
                      <IconButton
                        size="small"
                        onClick={() => handleCopy(landing.url, landing.id)}
                        sx={{
                          borderRadius: 2.5,
                          border: '1px solid',
                          borderColor: 'divider',
                          color: copiedId === landing.id ? 'success.main' : 'text.secondary',
                          px: 1.5,
                          transition: 'all 0.2s',
                          '&:hover': {
                            borderColor: 'primary.main',
                            color: 'primary.main',
                          },
                        }}
                      >
                        {copiedId === landing.id ? (
                          <CheckIcon sx={{ fontSize: 18 }} />
                        ) : (
                          <CopyIcon sx={{ fontSize: 16 }} />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}

      {/* ─── Footer Hint ─── */}
      <Paper
        variant="outlined"
        sx={{
          mt: 5,
          p: 3,
          borderRadius: 3,
          textAlign: 'center',
          borderStyle: 'dashed',
          borderColor: 'divider',
        }}
      >
        <SparkleIcon sx={{ fontSize: 28, color: 'primary.light', mb: 0.5 }} />
        <Typography variant="body2" color="text.secondary">
          Создайте новую папку в{' '}
          <Box
            component="code"
            sx={{
              bgcolor: 'action.hover',
              px: 1,
              py: 0.3,
              borderRadius: 1,
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            /landings/ideas/your-project/
          </Box>{' '}
          — лендинг появится здесь автоматически
        </Typography>
      </Paper>
    </Container>
  );
};

export default LandingsPage;
