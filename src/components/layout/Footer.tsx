import React from 'react';
import { Box, Container, Typography, Link as MuiLink, Grid, IconButton, Divider, Stack } from '@mui/material';
import { Link } from 'react-router-dom';
import {
  Facebook,
  Twitter,
  Instagram,
  LinkedIn,
  Email as EmailIcon,
  Phone as PhoneIcon,
  LocationOn as LocationIcon
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';

// Updated Footer for MUI v6+
const Footer: React.FC = () => {
  const { userProfile } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isAdmin = userProfile?.role === 'admin';

  const footerSections = [
    {
      title: 'Продукт',
      links: [
        { label: 'Возможности', path: '/features' },
        { label: 'Цены', path: '/pricing' },
        { label: 'Интеграции', path: '/integrations' },
        { label: 'Обновления', path: '/changelog' },
        { label: 'Электрокалькулятор', path: '/estimates/electrical' },
        { label: 'Сделки (CRM)', path: '/crm/deals' },
      ]
    },
    {
      title: 'Компания',
      links: [
        { label: 'О нас', path: '/about' },
        { label: 'Карьера', path: '/careers' },
        { label: 'Блог', path: '/blog' },
        { label: 'Контакты', path: '/contact' },
      ]
    },
    {
      title: 'Ресурсы',
      links: [
        { label: 'Документация', path: '/docs' },
        { label: 'Помощь', path: '/help' },
        { label: 'Сообщество', path: '/community' },
        { label: 'Статус', path: '/status' },
      ]
    },
    {
      title: 'Разработчикам',
      links: [
        { label: 'Platform & API', path: '/platform/', external: true },
        { label: 'Python SDK', path: 'https://github.com/garkorcom/profit-step/tree/main/sdk/python', external: true },
        { label: 'OpenAPI спец', path: '/api/docs/spec.json', external: true },
        { label: 'Bot docs', path: '/bot-docs/', external: true },
      ]
    }
  ];

  return (
    <Box
      component="footer"
      sx={{
        bgcolor: '#0f172a', // Deep dark blue/slate
        color: '#94a3b8', // Slate-400 for text
        pt: 8,
        pb: 4,
        mt: 'auto',
        borderTop: '1px solid #1e293b',
      }}
    >
      <Container maxWidth="lg">
        <Grid container spacing={4} sx={{ mb: 8 }}>
          {/* Brand & Newsletter */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ mb: 4 }}>
              <Typography variant="h5" sx={{ color: '#f8fafc', fontWeight: 700, mb: 2, letterSpacing: '-0.025em' }}>
                Profit Step
              </Typography>
              <Typography variant="body2" sx={{ mb: 3, maxWidth: 300, lineHeight: 1.6 }}>
                Современная платформа для управления строительным бизнесом. Сметы, проекты и CRM в одном месте.
              </Typography>

              <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
                <IconButton size="small" sx={{ color: '#94a3b8', '&:hover': { color: '#38bdf8', bgcolor: 'rgba(56, 189, 248, 0.1)' } }}>
                  <Twitter fontSize="small" />
                </IconButton>
                <IconButton size="small" sx={{ color: '#94a3b8', '&:hover': { color: '#38bdf8', bgcolor: 'rgba(56, 189, 248, 0.1)' } }}>
                  <Facebook fontSize="small" />
                </IconButton>
                <IconButton size="small" sx={{ color: '#94a3b8', '&:hover': { color: '#38bdf8', bgcolor: 'rgba(56, 189, 248, 0.1)' } }}>
                  <Instagram fontSize="small" />
                </IconButton>
                <IconButton size="small" sx={{ color: '#94a3b8', '&:hover': { color: '#38bdf8', bgcolor: 'rgba(56, 189, 248, 0.1)' } }}>
                  <LinkedIn fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          </Grid>

          {/* Links Sections */}
          {footerSections.map((section) => (
            <Grid size={{ xs: 6, sm: 4, md: 2 }} key={section.title}>
              <Typography variant="subtitle2" sx={{ color: '#f8fafc', fontWeight: 600, mb: 3, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
                {section.title}
              </Typography>
              <Stack spacing={2}>
                {section.links.map((link) => {
                  const commonSx = {
                    color: 'inherit',
                    textDecoration: 'none',
                    fontSize: '0.875rem',
                    transition: 'color 0.2s',
                    '&:hover': {
                      color: '#38bdf8',
                    },
                  } as const;
                  const isExternal = 'external' in link && link.external;
                  return isExternal ? (
                    <MuiLink
                      key={link.path}
                      href={link.path}
                      target={link.path.startsWith('http') ? '_blank' : undefined}
                      rel={link.path.startsWith('http') ? 'noopener noreferrer' : undefined}
                      sx={commonSx}
                    >
                      {link.label}
                    </MuiLink>
                  ) : (
                    <MuiLink
                      key={link.path}
                      component={Link}
                      to={link.path}
                      sx={commonSx}
                    >
                      {link.label}
                    </MuiLink>
                  );
                })}
              </Stack>
            </Grid>
          ))}

          {/* Contact Info */}
          <Grid size={{ xs: 12, md: 2 }}>
            <Typography variant="subtitle2" sx={{ color: '#f8fafc', fontWeight: 600, mb: 3, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
              Контакты
            </Typography>
            <Stack spacing={2}>
              <Box display="flex" alignItems="center" gap={1}>
                <EmailIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>hello@profitstep.com</Typography>
              </Box>
              <Box display="flex" alignItems="center" gap={1}>
                <PhoneIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>+1 (555) 123-4567</Typography>
              </Box>
              <Box display="flex" alignItems="start" gap={1}>
                <LocationIcon sx={{ fontSize: 16, mt: 0.5 }} />
                <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                  123 Business Ave,<br />Tech City, TC 90210
                </Typography>
              </Box>
            </Stack>
          </Grid>
        </Grid>

        <Divider sx={{ borderColor: '#1e293b', mb: 4 }} />

        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
          <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
            © {new Date().getFullYear()} Profit Step. Все права защищены.
          </Typography>
          <Stack direction="row" spacing={3}>
            <MuiLink href="#" sx={{ color: 'inherit', textDecoration: 'none', fontSize: '0.875rem', '&:hover': { color: '#f8fafc' } }}>
              Политика конфиденциальности
            </MuiLink>
            <MuiLink href="#" sx={{ color: 'inherit', textDecoration: 'none', fontSize: '0.875rem', '&:hover': { color: '#f8fafc' } }}>
              Условия использования
            </MuiLink>
          </Stack>
        </Box>
      </Container>
    </Box>
  );
};

export default Footer;
