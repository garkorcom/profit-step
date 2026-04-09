/**
 * RedFlagsBanner — displays red/yellow alerts for financial issues.
 * Renders nothing if no flags.
 */

import React from 'react';
import { Alert, AlertTitle, Box, Tooltip, Chip, Stack } from '@mui/material';
import {
  Warning as WarningIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import type { RedFlag } from '../../../types/clientDashboard.types';

interface RedFlagsBannerProps {
  flags: RedFlag[];
}

const RedFlagsBanner: React.FC<RedFlagsBannerProps> = ({ flags }) => {
  if (!flags || flags.length === 0) return null;

  const redFlags = flags.filter(f => f.severity === 'red');
  const yellowFlags = flags.filter(f => f.severity === 'yellow');

  return (
    <Box sx={{ mb: 2 }}>
      {redFlags.length > 0 && (
        <Alert severity="error" icon={<ErrorIcon />} sx={{ mb: 1 }}>
          <AlertTitle>Issues requiring attention</AlertTitle>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {redFlags.map(flag => (
              <Tooltip key={flag.code} title={flag.description} arrow>
                <Chip
                  label={flag.title}
                  color="error"
                  size="small"
                  variant="outlined"
                />
              </Tooltip>
            ))}
          </Stack>
        </Alert>
      )}

      {yellowFlags.length > 0 && (
        <Alert severity="warning" icon={<WarningIcon />}>
          <AlertTitle>Warnings</AlertTitle>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {yellowFlags.map(flag => (
              <Tooltip key={flag.code} title={flag.description} arrow>
                <Chip
                  label={flag.title}
                  color="warning"
                  size="small"
                  variant="outlined"
                />
              </Tooltip>
            ))}
          </Stack>
        </Alert>
      )}
    </Box>
  );
};

export default RedFlagsBanner;
