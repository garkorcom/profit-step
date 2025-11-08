/**
 * CompaniesTable - Table display for company clients
 *
 * Features:
 * - Responsive table layout
 * - Contact information display (email, phone, website)
 * - Status chips (active/archived)
 * - Action buttons (edit, archive/restore)
 * - Loading states
 * - Empty state
 */

import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  Chip,
  Box,
  CircularProgress,
  Typography,
  Link,
} from '@mui/material';
import {
  Edit as EditIcon,
  Archive as ArchiveIcon,
  Unarchive as UnarchiveIcon,
  Language as WebsiteIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
} from '@mui/icons-material';
import { Company } from '../../types/crm.types';
import { Timestamp } from 'firebase/firestore';

interface CompaniesTableProps {
  companies: Company[];
  loading: boolean;
  onEdit: (company: Company) => void;
  onArchive: (company: Company) => void;
}

export default function CompaniesTable({
  companies,
  loading,
  onEdit,
  onArchive,
}: CompaniesTableProps) {
  const formatDate = (date: any) => {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : (date as Timestamp).toDate();
    return d.toLocaleDateString('ru-RU');
  };

  if (loading && companies.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
        <CircularProgress />
      </Box>
    );
  }

  if (companies.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
        <Typography color="text.secondary">Компании не найдены</Typography>
      </Box>
    );
  }

  return (
    <TableContainer sx={{ position: 'relative' }}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Название</TableCell>
            <TableCell>Контакты</TableCell>
            <TableCell>Адрес</TableCell>
            <TableCell>Статус</TableCell>
            <TableCell>Создана</TableCell>
            <TableCell align="right">Действия</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {companies.map((company) => (
            <TableRow key={company.id} hover>
              <TableCell>
                <Typography variant="subtitle2">{company.name}</Typography>
              </TableCell>

              <TableCell>
                <Box display="flex" flexDirection="column" gap={0.5}>
                  {company.email && (
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <EmailIcon fontSize="small" color="action" />
                      <Link href={`mailto:${company.email}`} variant="body2">
                        {company.email}
                      </Link>
                    </Box>
                  )}
                  {company.phone && (
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <PhoneIcon fontSize="small" color="action" />
                      <Link href={`tel:${company.phone}`} variant="body2">
                        {company.phone}
                      </Link>
                    </Box>
                  )}
                  {company.website && (
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <WebsiteIcon fontSize="small" color="action" />
                      <Link href={company.website} target="_blank" rel="noopener" variant="body2">
                        {company.website.replace(/^https?:\/\//, '')}
                      </Link>
                    </Box>
                  )}
                </Box>
              </TableCell>

              <TableCell>
                <Typography variant="body2">{company.address || '-'}</Typography>
              </TableCell>

              <TableCell>
                <Chip
                  label={company.isArchived ? 'Архив' : 'Активна'}
                  size="small"
                  color={company.isArchived ? 'default' : 'success'}
                  variant={company.isArchived ? 'outlined' : 'filled'}
                />
              </TableCell>

              <TableCell>
                <Typography variant="body2">{formatDate(company.createdAt)}</Typography>
              </TableCell>

              <TableCell align="right">
                <Tooltip title="Редактировать">
                  <IconButton onClick={() => onEdit(company)} size="small">
                    <EditIcon />
                  </IconButton>
                </Tooltip>

                <Tooltip title={company.isArchived ? 'Восстановить' : 'Архивировать'}>
                  <IconButton onClick={() => onArchive(company)} size="small">
                    {company.isArchived ? <UnarchiveIcon /> : <ArchiveIcon />}
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {loading && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'rgba(255, 255, 255, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CircularProgress />
        </Box>
      )}
    </TableContainer>
  );
}
