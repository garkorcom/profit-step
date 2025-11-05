import React, { useState } from 'react';
import {
  Container,
  Typography,
  Box,
  Tabs,
  Tab,
  Paper,
  Alert,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  AttachMoney as MoneyIcon,
  TrendingUp as GrowthIcon,
  People as PeopleIcon,
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';
import SystemHealthPanel from './components/SystemHealthPanel';
import CostControlPanel from './components/CostControlPanel';
import GrowthPanel from './components/GrowthPanel';
import EngagementPanel from './components/EngagementPanel';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`dashboard-tabpanel-${index}`}
      aria-labelledby={`dashboard-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

/**
 * Super Admin Dashboard
 * Platform-wide мониторинг для суперадминистратора
 */
const SuperAdminDashboard: React.FC = () => {
  const { userProfile } = useAuth();
  const [activeTab, setActiveTab] = useState(0);

  // Проверка прав доступа
  const isSuperAdmin = userProfile?.role === 'superadmin';

  if (!isSuperAdmin) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Alert severity="error">
          У вас нет прав доступа к этой странице. Только суперадминистраторы могут просматривать
          эту панель.
        </Alert>
      </Container>
    );
  }

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      {/* Заголовок */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Super Admin Dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Platform-wide мониторинг и аналитика
        </Typography>
      </Box>

      {/* Вкладки */}
      <Paper sx={{ mb: 2 }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab icon={<DashboardIcon />} label="System Health" />
          <Tab icon={<MoneyIcon />} label="Cost Control" />
          <Tab icon={<GrowthIcon />} label="Growth" />
          <Tab icon={<PeopleIcon />} label="Engagement" />
        </Tabs>
      </Paper>

      {/* Контент вкладок */}
      <TabPanel value={activeTab} index={0}>
        <SystemHealthPanel />
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
        <CostControlPanel />
      </TabPanel>

      <TabPanel value={activeTab} index={2}>
        <GrowthPanel />
      </TabPanel>

      <TabPanel value={activeTab} index={3}>
        <EngagementPanel />
      </TabPanel>
    </Container>
  );
};

export default SuperAdminDashboard;
