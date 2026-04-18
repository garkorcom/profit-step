/**
 * Warehouse page — view locations and their stock + catalog-wide item browser.
 *
 * Read-only for MVP. Mutations (create item, post document, void) go
 * through the backend REST endpoints and will land in later admin pages.
 *
 * Spec: docs/warehouse/MAIN_SPEC.md §3.2.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Container,
  InputAdornment,
  MenuItem,
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

type WarehouseTab = 'locations' | 'items';

export default function WarehousePage() {
  const [tab, setTab] = useState<WarehouseTab>('locations');
  const [search, setSearch] = useState('');

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4" fontWeight={600}>
          🏭 Warehouse
        </Typography>
        <Chip label="MVP (read-only)" size="small" color="warning" variant="outlined" />
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab value="locations" label="📍 Локации" />
            <Tab value="items" label="📦 Товары" />
          </Tabs>
          <TextField
            placeholder="Поиск..."
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ width: 280, my: 1 }}
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
    </Container>
  );
}
