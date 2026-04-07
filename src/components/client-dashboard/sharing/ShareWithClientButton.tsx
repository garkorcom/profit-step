/**
 * ShareWithClientButton — button shown in internal dashboard header
 * that opens the ShareLinkModal.
 *
 * Only rendered in internal mode. Part of ClientDashboardLayout's
 * `actions` slot in src/pages/dashboard/client/[id].tsx.
 */

import React, { useState } from 'react';
import { Button } from '@mui/material';
import { Share as ShareIcon } from '@mui/icons-material';
import ShareLinkModal from './ShareLinkModal';

export interface ShareWithClientButtonProps {
  clientId: string;
  clientName: string;
  size?: 'small' | 'medium' | 'large';
  variant?: 'text' | 'outlined' | 'contained';
}

const ShareWithClientButton: React.FC<ShareWithClientButtonProps> = ({
  clientId,
  clientName,
  size = 'small',
  variant = 'contained',
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size={size}
        variant={variant}
        color="primary"
        startIcon={<ShareIcon />}
        onClick={() => setOpen(true)}
      >
        Share
      </Button>
      <ShareLinkModal
        open={open}
        onClose={() => setOpen(false)}
        clientId={clientId}
        clientName={clientName}
      />
    </>
  );
};

export default ShareWithClientButton;
