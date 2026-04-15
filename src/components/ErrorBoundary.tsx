import React from 'react';
import { Box, Typography, Button, Paper, Stack } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  resetError = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleCopyError = async (): Promise<void> => {
    const { error } = this.state;
    if (!error) return;

    const report = [
      `Error: ${error.message}`,
      `URL: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
      `UserAgent: ${navigator.userAgent}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(report);
    } catch {
      // Fallback for browsers without clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = report;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isProd = process.env.NODE_ENV === 'production';
    const errorMessage = this.state.error?.message ?? 'Unknown error';
    const displayMessage = isProd && errorMessage.length > 200
      ? errorMessage.slice(0, 200) + '...'
      : errorMessage;

    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          p: 2,
        }}
      >
        <Paper
          elevation={3}
          sx={{
            maxWidth: 520,
            width: '100%',
            p: 4,
            textAlign: 'center',
            borderRadius: 2,
          }}
        >
          <ErrorOutlineIcon
            sx={{ fontSize: 64, color: 'error.main', mb: 2 }}
          />

          <Typography variant="h5" gutterBottom>
            Something went wrong
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 3,
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              bgcolor: 'grey.100',
              p: 1.5,
              borderRadius: 1,
            }}
          >
            {displayMessage}
          </Typography>

          <Stack direction="row" spacing={2} justifyContent="center">
            <Button
              variant="contained"
              startIcon={<RefreshIcon />}
              onClick={this.handleReload}
            >
              Reload
            </Button>
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={this.handleCopyError}
            >
              Copy error info
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }
}

export default ErrorBoundary;
