/**
 * Internal-only Overview section for client dashboard.
 * Shows contacts, client details, and work session earnings.
 */

import React from 'react';
import {
  Grid,
  Paper,
  Typography,
  Chip,
  Table,
  TableRow,
  TableCell,
  TableBody,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  Stack,
} from '@mui/material';
import {
  Person as ClientIcon,
  Phone as PhoneIcon,
  Email as EmailIcon,
} from '@mui/icons-material';
import { Client } from '../../../types/crm.types';

interface WorkSessionSummary {
  totalEarnings: number;
  sessionCount: number;
  loading: boolean;
}

interface OverviewSectionProps {
  client: Client;
  workSessions: WorkSessionSummary;
}

const OverviewSection: React.FC<OverviewSectionProps> = ({ client, workSessions }) => (
  <Grid container spacing={3}>
    <Grid size={{ xs: 12, md: 6 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Contacts
        </Typography>
        {client.contacts && client.contacts.length > 0 ? (
          <List dense>
            {client.contacts.map(contact => (
              <ListItem key={contact.id}>
                <ListItemIcon>
                  <ClientIcon />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="body1" fontWeight="bold">
                        {contact.name}
                      </Typography>
                      {contact.position && (
                        <Chip label={contact.position} size="small" variant="outlined" />
                      )}
                    </Stack>
                  }
                  secondary={
                    <Stack direction="row" spacing={2} mt={0.5}>
                      {contact.phone && (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <PhoneIcon fontSize="small" />
                          <Typography
                            variant="body2"
                            component="a"
                            href={`tel:${contact.phone}`}
                            sx={{ color: 'primary.main', textDecoration: 'none' }}
                          >
                            {contact.phone}
                          </Typography>
                        </Stack>
                      )}
                      {contact.email && (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <EmailIcon fontSize="small" />
                          <Typography
                            variant="body2"
                            component="a"
                            href={`mailto:${contact.email}`}
                            sx={{ color: 'primary.main', textDecoration: 'none' }}
                          >
                            {contact.email}
                          </Typography>
                        </Stack>
                      )}
                    </Stack>
                  }
                />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No contacts
          </Typography>
        )}
      </Paper>
    </Grid>

    <Grid size={{ xs: 12, md: 6 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Details
        </Typography>
        <Table size="small">
          <TableBody>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>{client.type}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>
                <Chip label={client.status} size="small" color="primary" />
              </TableCell>
            </TableRow>
            {client.source && (
              <TableRow>
                <TableCell>Source</TableCell>
                <TableCell>{client.sourceName || client.source}</TableCell>
              </TableRow>
            )}
            {client.industry && (
              <TableRow>
                <TableCell>Industry</TableCell>
                <TableCell>{client.industry}</TableCell>
              </TableRow>
            )}
            <TableRow>
              <TableCell>Total Revenue (LTV)</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>
                ${(client.totalRevenue || 0).toLocaleString()}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Paper>
    </Grid>

    {/* Internal-only KPI: Work sessions earnings */}
    <Grid size={{ xs: 12 }}>
      <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fffdf5', borderColor: 'warning.light' }}>
        <Typography variant="overline" color="warning.dark" fontWeight="bold">
          Internal — Work Sessions Summary
        </Typography>
        {workSessions.loading ? (
          <CircularProgress size={20} />
        ) : workSessions.sessionCount === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No completed work sessions for this client yet.
          </Typography>
        ) : (
          <Grid container spacing={2} mt={0.5}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="body2" color="text.secondary">
                Total Labor Earnings
              </Typography>
              <Typography variant="h4" fontWeight="bold" color="warning.dark">
                ${workSessions.totalEarnings.toLocaleString()}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="body2" color="text.secondary">
                Completed Sessions
              </Typography>
              <Typography variant="h4" fontWeight="bold">
                {workSessions.sessionCount}
              </Typography>
            </Grid>
          </Grid>
        )}
      </Paper>
    </Grid>
  </Grid>
);

export type { WorkSessionSummary };
export default OverviewSection;
