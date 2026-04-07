/**
 * ShareLinkModal — dialog for creating and managing client portal share links.
 *
 * Shown from internal dashboard (<ShareWithClientButton />). Creates a new
 * token via POST /api/clients/:id/share-tokens, displays the resulting URL
 * once, then switches to a "manage tokens" view showing existing tokens
 * with revoke option.
 *
 * The raw token is ONLY visible at creation time. After the dialog closes
 * or the user switches to the list view, the token cannot be retrieved —
 * they have to create a new one.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  IconButton,
  Alert,
  CircularProgress,
  Divider,
  Chip,
  Stack,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  OpenInNew as OpenIcon,
  Share as ShareIcon,
  Sms as SmsIcon,
  Email as EmailIcon,
  Delete as DeleteIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import {
  shareApi,
  buildPortalUrl,
  type CreateShareTokenResponse,
  type ShareTokenSummary,
} from '../../../api/shareApi';

export interface ShareLinkModalProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}

type View = 'create' | 'just-created' | 'list';

const ShareLinkModal: React.FC<ShareLinkModalProps> = ({
  open,
  onClose,
  clientId,
  clientName,
}) => {
  const [view, setView] = useState<View>('create');
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreateShareTokenResponse | null>(null);
  const [tokens, setTokens] = useState<ShareTokenSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setView('create');
      setCreatedToken(null);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  const loadTokens = useCallback(async () => {
    setListLoading(true);
    setError(null);
    try {
      const resp = await shareApi.listTokens(clientId);
      setTokens(resp.tokens);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  }, [clientId]);

  // Load tokens when switching to list view
  useEffect(() => {
    if (open && view === 'list') {
      loadTokens();
    }
  }, [open, view, loadTokens]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const resp = await shareApi.createToken(clientId, { expiresInDays });
      setCreatedToken(resp);
      setView('just-created');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    const url = buildPortalUrl(createdToken.slug, createdToken.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard — please copy manually');
    }
  };

  const handlePreview = () => {
    if (!createdToken) return;
    const url = buildPortalUrl(createdToken.slug, createdToken.token);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSms = () => {
    if (!createdToken) return;
    const url = buildPortalUrl(createdToken.slug, createdToken.token);
    const body = encodeURIComponent(
      `Hi ${clientName}, your project portal is ready: ${url}`
    );
    window.open(`sms:?&body=${body}`, '_blank');
  };

  const handleEmail = () => {
    if (!createdToken) return;
    const url = buildPortalUrl(createdToken.slug, createdToken.token);
    const subject = encodeURIComponent(`Your project portal — ${clientName}`);
    const body = encodeURIComponent(
      `Hi ${clientName},\n\nYour project portal is ready. You can view your estimate, timeline, payments, and photos here:\n\n${url}\n\nThis link is valid for ${createdToken.expiresInDays} days.\n\nPlease let us know if you have any questions.`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  const handleRevoke = async (tokenId: string) => {
    setRevokingId(tokenId);
    setError(null);
    try {
      await shareApi.revokeToken(clientId, tokenId);
      await loadTokens(); // refresh list
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRevokingId(null);
    }
  };

  const fullUrl = createdToken ? buildPortalUrl(createdToken.slug, createdToken.token) : '';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <ShareIcon />
          <Typography variant="h6" component="span" fontWeight="bold">
            Share with {clientName}
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* ─── View: Create new link ─────────────────────────────── */}
        {view === 'create' && (
          <Box>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Generate a new portal link that {clientName} can open on their phone or desktop.
              They'll see a filtered view with estimates, timeline, payments, and photos — but
              not your internal costs, team notes, or supplier information.
            </Typography>

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel id="expires-label">Link expires in</InputLabel>
              <Select
                labelId="expires-label"
                label="Link expires in"
                value={expiresInDays}
                onChange={e => setExpiresInDays(Number(e.target.value))}
              >
                <MenuItem value={7}>7 days</MenuItem>
                <MenuItem value={14}>14 days</MenuItem>
                <MenuItem value={30}>30 days</MenuItem>
                <MenuItem value={90}>90 days</MenuItem>
                <MenuItem value={180}>180 days</MenuItem>
                <MenuItem value={365}>1 year</MenuItem>
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              size="small"
              onClick={() => setView('list')}
              sx={{ mt: 1 }}
            >
              Manage existing links
            </Button>
          </Box>
        )}

        {/* ─── View: Just created ─────────────────────────────────── */}
        {view === 'just-created' && createdToken && (
          <Box>
            <Alert severity="success" sx={{ mb: 2 }}>
              Link created successfully. Copy it now — you won't be able to see this exact URL
              again.
            </Alert>

            <Typography variant="overline" color="text.secondary">
              Portal URL
            </Typography>
            <Stack direction="row" spacing={1} mb={2} alignItems="flex-start">
              <TextField
                fullWidth
                value={fullUrl}
                InputProps={{
                  readOnly: true,
                  sx: { fontFamily: 'monospace', fontSize: '0.75rem' },
                }}
                multiline
                maxRows={3}
              />
              <IconButton onClick={handleCopy} color={copied ? 'success' : 'default'}>
                {copied ? <CheckIcon /> : <CopyIcon />}
              </IconButton>
            </Stack>

            {copied && (
              <Typography variant="caption" color="success.main" sx={{ display: 'block', mb: 1 }}>
                Copied to clipboard
              </Typography>
            )}

            <Typography variant="caption" color="text.secondary" display="block" mb={2}>
              Expires: {new Date(createdToken.expiresAt).toLocaleString()} (
              {createdToken.expiresInDays} days)
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Typography variant="overline" color="text.secondary">
              Actions
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mt={1}>
              <Button variant="outlined" startIcon={<OpenIcon />} onClick={handlePreview}>
                Preview as client
              </Button>
              <Button variant="outlined" startIcon={<SmsIcon />} onClick={handleSms}>
                SMS
              </Button>
              <Button variant="outlined" startIcon={<EmailIcon />} onClick={handleEmail}>
                Email
              </Button>
            </Stack>
          </Box>
        )}

        {/* ─── View: List existing tokens ─────────────────────────── */}
        {view === 'list' && (
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="subtitle1" fontWeight="bold">
                Existing share links
              </Typography>
              <Button size="small" onClick={() => setView('create')}>
                + New link
              </Button>
            </Stack>

            {listLoading ? (
              <Box display="flex" justifyContent="center" py={3}>
                <CircularProgress size={32} />
              </Box>
            ) : tokens.length === 0 ? (
              <Alert severity="info">
                No share links have been created for this client yet.
              </Alert>
            ) : (
              <List>
                {tokens.map(t => (
                  <ListItem
                    key={t.id}
                    divider
                    sx={{
                      opacity: t.active ? 1 : 0.6,
                    }}
                  >
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <Typography
                            variant="body2"
                            sx={{ fontFamily: 'monospace' }}
                            fontWeight="bold"
                          >
                            /portal/{t.slug}
                          </Typography>
                          {t.active ? (
                            <Chip label="Active" size="small" color="success" />
                          ) : t.revokedAt ? (
                            <Chip label="Revoked" size="small" color="error" />
                          ) : (
                            <Chip label="Expired" size="small" />
                          )}
                          <Chip label={t.tokenPreview} size="small" variant="outlined" />
                        </Stack>
                      }
                      secondary={
                        <Stack direction="row" spacing={2} mt={0.5}>
                          <Typography variant="caption" color="text.secondary">
                            Created:{' '}
                            {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Expires:{' '}
                            {t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : '—'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Views: {t.useCount}
                          </Typography>
                        </Stack>
                      }
                    />
                    <ListItemSecondaryAction>
                      {t.active && (
                        <IconButton
                          edge="end"
                          size="small"
                          color="error"
                          onClick={() => handleRevoke(t.id)}
                          disabled={revokingId === t.id}
                          title="Revoke this link"
                        >
                          {revokingId === t.id ? (
                            <CircularProgress size={16} />
                          ) : (
                            <DeleteIcon fontSize="small" />
                          )}
                        </IconButton>
                      )}
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        {view === 'create' && (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleCreate}
              disabled={creating}
              startIcon={creating ? <CircularProgress size={16} /> : <ShareIcon />}
            >
              {creating ? 'Creating...' : 'Create link'}
            </Button>
          </>
        )}
        {view === 'just-created' && (
          <>
            <Button onClick={() => setView('list')}>Manage links</Button>
            <Button variant="contained" onClick={onClose}>
              Done
            </Button>
          </>
        )}
        {view === 'list' && <Button onClick={onClose}>Close</Button>}
      </DialogActions>
    </Dialog>
  );
};

export default ShareLinkModal;
