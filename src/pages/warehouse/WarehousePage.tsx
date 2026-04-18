/**
 * Warehouse page — locations, items, documents, norms, vendors, ledger, reports.
 *
 * Full management UI. Admin/manager roles write; others read-only.
 * Spec: docs/warehouse/improvements/11_management_ui/SPEC.md.
 */

import React, { useState } from 'react';
import {
  Chip,
  Container,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import LocationsTab from './LocationsTab';
import ItemsTab from './ItemsTab';
import DocumentsTab from './DocumentsTab';
import NormsTab from './NormsTab';
import VendorsTab from './VendorsTab';
import LedgerTab from './LedgerTab';
import ReportsTab from './ReportsTab';
import { useWarehousePermissions } from './hooks/useWarehousePermissions';

type WarehouseTab = 'locations' | 'items' | 'documents' | 'norms' | 'vendors' | 'ledger' | 'reports';

export default function WarehousePage() {
  const [tab, setTab] = useState<WarehouseTab>('locations');
  const [search, setSearch] = useState('');
  const perms = useWarehousePermissions();

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4" fontWeight={600}>
          🏭 Warehouse
        </Typography>
        {perms.canWriteCatalog ? (
          <Chip label="Admin" size="small" color="primary" variant="outlined" />
        ) : perms.canCreateDocuments ? (
          <Chip label="Manager" size="small" color="primary" variant="outlined" />
        ) : (
          <Chip label="Read-only" size="small" variant="outlined" />
        )}
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
            <Tab value="locations" label="📍 Локации" />
            <Tab value="items" label="📦 Товары" />
            <Tab value="documents" label="📄 Документы" />
            <Tab value="norms" label="📐 Нормы" />
            <Tab value="vendors" label="🏪 Поставщики" />
            <Tab value="ledger" label="📊 Ledger" />
            <Tab value="reports" label="📈 Отчёты" />
          </Tabs>
          <TextField
            placeholder="Поиск..."
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ width: 240, my: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
        </Stack>
      </Paper>

      {tab === 'locations' && <LocationsTab search={search} />}
      {tab === 'items' && <ItemsTab search={search} />}
      {tab === 'documents' && <DocumentsTab search={search} />}
      {tab === 'norms' && <NormsTab search={search} />}
      {tab === 'vendors' && <VendorsTab search={search} />}
      {tab === 'ledger' && <LedgerTab search={search} />}
      {tab === 'reports' && <ReportsTab search={search} />}
    </Container>
  );
}
