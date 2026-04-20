import React, { useState } from 'react';
import {
  Container,
  Typography,
  Box,
  Button,
  Chip,
  Alert,
  IconButton,
  Tooltip,
  InputBase,
  alpha,
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
  ViewModule as GridIcon,
  AutoAwesome as SparkleIcon,
} from '@mui/icons-material';

// Glob all index files inside ideas to extract metadata
const ideaModules: Record<string, any> = import.meta.glob(
  '../../../landings/ideas/*/build/index.tsx',
  { eager: true }
);

// Gradient palette for cards — each card gets a unique accent
const CARD_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
  'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
  'linear-gradient(135deg, #f5576c 0%, #ff6a00 100%)',
];

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  Live: {
    icon: <RocketIcon sx={{ fontSize: 14 }} />,
    color: '#00e676',
    bg: 'rgba(0, 230, 118, 0.12)',
    label: 'Live',
  },
  Draft: {
    icon: <ScienceIcon sx={{ fontSize: 14 }} />,
    color: '#ffab40',
    bg: 'rgba(255, 171, 64, 0.12)',
    label: 'Draft',
  },
  Archived: {
    icon: <ArchiveIcon sx={{ fontSize: 14 }} />,
    color: '#90a4ae',
    bg: 'rgba(144, 164, 174, 0.12)',
    label: 'Archived',
  },
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
      gradient: CARD_GRADIENTS[index % CARD_GRADIENTS.length],
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
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #0f0c29 0%, #1a1a2e 30%, #16213e 100%)',
        pb: 8,
      }}
    >
      {/* ─── Hero Header ─── */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          pt: { xs: 5, md: 7 },
          pb: { xs: 4, md: 6 },
          px: 3,
        }}
      >
        {/* Animated glow orbs */}
        <Box
          sx={{
            position: 'absolute',
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(102,126,234,0.25) 0%, transparent 70%)',
            top: -100,
            left: -50,
            filter: 'blur(60px)',
            animation: 'pulse 6s ease-in-out infinite',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 0.6, transform: 'scale(1)' },
              '50%': { opacity: 1, transform: 'scale(1.15)' },
            },
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(245,87,108,0.2) 0%, transparent 70%)',
            top: -50,
            right: 100,
            filter: 'blur(80px)',
            animation: 'pulse 8s ease-in-out 1s infinite',
          }}
        />

        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                boxShadow: '0 8px 32px rgba(102,126,234,0.35)',
              }}
            >
              <CampaignIcon sx={{ fontSize: 28, color: '#fff' }} />
            </Box>
            <Box>
              <Typography
                variant="h4"
                sx={{
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #fff 0%, #b0b0ff 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  letterSpacing: '-0.5px',
                }}
              >
                Idea Hub
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', mt: -0.3 }}>
                Центр управления лендингами и промо-страницами
              </Typography>
            </Box>
          </Box>

          {/* ─── Stats Row ─── */}
          <Box
            sx={{
              display: 'flex',
              gap: 2,
              mt: 4,
              flexWrap: 'wrap',
            }}
          >
            {[
              { label: 'Всего', value: stats.total, gradient: 'linear-gradient(135deg, #667eea, #764ba2)', glow: 'rgba(102,126,234,0.25)' },
              { label: 'Live', value: stats.live, gradient: 'linear-gradient(135deg, #43e97b, #38f9d7)', glow: 'rgba(67,233,123,0.25)' },
              { label: 'Draft', value: stats.draft, gradient: 'linear-gradient(135deg, #fccb90, #d57eeb)', glow: 'rgba(252,203,144,0.25)' },
              { label: 'Archived', value: stats.archived, gradient: 'linear-gradient(135deg, #90a4ae, #546e7a)', glow: 'rgba(144,164,174,0.15)' },
            ].map((stat) => (
              <Box
                key={stat.label}
                sx={{
                  px: 3,
                  py: 1.5,
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.04)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  minWidth: 100,
                  textAlign: 'center',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    background: 'rgba(255,255,255,0.08)',
                    boxShadow: `0 8px 32px ${stat.glow}`,
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 800,
                    background: stat.gradient,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {stat.value}
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>
                  {stat.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Container>
      </Box>

      {/* ─── Toolbar: Search + Filters ─── */}
      <Container maxWidth="lg">
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            mb: 4,
            flexWrap: 'wrap',
          }}
        >
          {/* Search */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flex: 1,
              minWidth: 220,
              px: 2,
              py: 0.8,
              borderRadius: 3,
              background: 'rgba(255,255,255,0.05)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.08)',
              transition: 'border-color 0.3s',
              '&:focus-within': {
                borderColor: 'rgba(102,126,234,0.5)',
                boxShadow: '0 0 20px rgba(102,126,234,0.15)',
              },
            }}
          >
            <SearchIcon sx={{ color: 'rgba(255,255,255,0.3)', mr: 1 }} />
            <InputBase
              placeholder="Поиск по названию, описанию..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              sx={{
                color: '#fff',
                flex: 1,
                fontSize: '0.95rem',
                '& input::placeholder': { color: 'rgba(255,255,255,0.3)' },
              }}
            />
          </Box>

          {/* Filters */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <FilterIcon sx={{ color: 'rgba(255,255,255,0.3)', fontSize: 20 }} />
            {['all', 'Live', 'Draft', 'Archived'].map((filter) => (
              <Chip
                key={filter}
                label={filter === 'all' ? 'Все' : filter}
                size="small"
                onClick={() => setActiveFilter(filter)}
                sx={{
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  transition: 'all 0.25s ease',
                  color: activeFilter === filter ? '#fff' : 'rgba(255,255,255,0.45)',
                  background:
                    activeFilter === filter
                      ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                      : 'rgba(255,255,255,0.06)',
                  border: activeFilter === filter ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  '&:hover': {
                    background:
                      activeFilter === filter
                        ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                        : 'rgba(255,255,255,0.1)',
                  },
                }}
              />
            ))}
          </Box>
        </Box>

        {/* ─── Bento Grid ─── */}
        {filteredLandings.length === 0 ? (
          <Alert
            severity="info"
            sx={{
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 3,
              '& .MuiAlert-icon': { color: 'rgba(102,126,234,0.7)' },
            }}
          >
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
            {filteredLandings.map((landing, index) => {
              const statusConf = STATUS_CONFIG[landing.status] || STATUS_CONFIG.Draft;

              return (
                <Box
                  key={landing.id}
                  sx={{
                    position: 'relative',
                    borderRadius: 4,
                    overflow: 'hidden',
                    background: 'rgba(255,255,255,0.03)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                    cursor: 'default',
                    display: 'flex',
                    flexDirection: 'column',
                    animation: `fadeInUp 0.5s ease ${index * 0.06}s both`,
                    '@keyframes fadeInUp': {
                      from: { opacity: 0, transform: 'translateY(24px)' },
                      to: { opacity: 1, transform: 'translateY(0)' },
                    },
                    '&:hover': {
                      transform: 'translateY(-6px)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                      '& .card-gradient-bar': {
                        height: 5,
                      },
                      '& .card-glow': {
                        opacity: 0.12,
                      },
                    },
                  }}
                >
                  {/* Top gradient bar */}
                  <Box
                    className="card-gradient-bar"
                    sx={{
                      height: 3,
                      background: landing.gradient,
                      transition: 'height 0.4s ease',
                    }}
                  />

                  {/* Background glow on hover */}
                  <Box
                    className="card-glow"
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 120,
                      background: landing.gradient,
                      opacity: 0.05,
                      transition: 'opacity 0.4s ease',
                      pointerEvents: 'none',
                    }}
                  />

                  {/* Card content */}
                  <Box sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                    {/* Header row */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                      <Typography
                        variant="subtitle1"
                        sx={{
                          fontWeight: 700,
                          color: '#fff',
                          lineHeight: 1.3,
                          pr: 1,
                          fontSize: '1.05rem',
                        }}
                      >
                        {landing.title}
                      </Typography>

                      {/* Status badge */}
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          px: 1.2,
                          py: 0.4,
                          borderRadius: 2,
                          background: statusConf.bg,
                          border: `1px solid ${alpha(statusConf.color, 0.2)}`,
                          flexShrink: 0,
                        }}
                      >
                        {statusConf.icon}
                        <Typography
                          variant="caption"
                          sx={{ color: statusConf.color, fontWeight: 700, fontSize: '0.7rem' }}
                        >
                          {statusConf.label}
                        </Typography>
                      </Box>
                    </Box>

                    {/* Slug / path */}
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'rgba(255,255,255,0.25)',
                        fontFamily: 'monospace',
                        fontSize: '0.72rem',
                        mb: 1.5,
                      }}
                    >
                      /l/{landing.id}
                    </Typography>

                    {/* Description */}
                    <Typography
                      variant="body2"
                      sx={{
                        color: 'rgba(255,255,255,0.5)',
                        mb: 2.5,
                        flexGrow: 1,
                        lineHeight: 1.6,
                        fontSize: '0.85rem',
                      }}
                    >
                      {landing.description}
                    </Typography>

                    {/* Tech pills */}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7, mb: 2.5 }}>
                      {landing.tech.map((t: string) => (
                        <Box
                          key={t}
                          sx={{
                            px: 1.2,
                            py: 0.25,
                            borderRadius: 1.5,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            fontSize: '0.7rem',
                            color: 'rgba(255,255,255,0.45)',
                            fontWeight: 500,
                          }}
                        >
                          {t}
                        </Box>
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
                          fontSize: '0.8rem',
                          py: 1,
                          background: landing.gradient,
                          boxShadow: 'none',
                          transition: 'all 0.3s ease',
                          '&:hover': {
                            boxShadow: `0 8px 24px ${alpha('#000', 0.3)}`,
                            transform: 'scale(1.02)',
                          },
                        }}
                      >
                        Открыть
                      </Button>

                      <Tooltip title={copiedId === landing.id ? '✓ Скопировано!' : 'Копировать ссылку'} arrow>
                        <IconButton
                          size="small"
                          onClick={() => handleCopy(landing.url, landing.id)}
                          sx={{
                            borderRadius: 2.5,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            color: copiedId === landing.id ? '#43e97b' : 'rgba(255,255,255,0.4)',
                            transition: 'all 0.3s ease',
                            px: 1.5,
                            '&:hover': {
                              background: 'rgba(255,255,255,0.1)',
                            },
                          }}
                        >
                          <CopyIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}

        {/* ─── Footer CTA ─── */}
        <Box
          sx={{
            mt: 6,
            p: 4,
            borderRadius: 4,
            background: 'rgba(255,255,255,0.03)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.06)',
            textAlign: 'center',
          }}
        >
          <SparkleIcon sx={{ fontSize: 30, color: 'rgba(102,126,234,0.6)', mb: 1 }} />
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.4)', maxWidth: 480, mx: 'auto' }}>
            Добавьте новый лендинг — создайте папку в{' '}
            <Box
              component="code"
              sx={{
                background: 'rgba(102,126,234,0.15)',
                px: 0.8,
                py: 0.2,
                borderRadius: 1,
                color: '#8e9fff',
                fontSize: '0.78rem',
              }}
            >
              /landings/ideas/your-project/
            </Box>{' '}
            и он автоматически появится здесь.
          </Typography>
        </Box>
      </Container>
    </Box>
  );
};

export default LandingsPage;
