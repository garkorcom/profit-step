import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { Toaster } from 'react-hot-toast';
import AppRouter from './router/AppRouter';
import { AuthProvider } from './auth/AuthContext';
import PWAInstallBanner from './components/pwa/PWAInstallBanner';
import ErrorBoundary from './components/ErrorBoundary';

// Создание зеленой темы (аналогично my-business-app)
const theme = createTheme({
  palette: {
    primary: {
      main: '#2e7d32', // Зеленый цвет
      light: '#60ad5e',
      dark: '#005005',
    },
    secondary: {
      main: '#ff9800', // Оранжевый акцент
    },
    background: {
      default: '#f5f5f5',
      paper: '#ffffff',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
        },
      },
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <Toaster position="top-right" />
        <BrowserRouter>
          <AuthProvider>
            <AppRouter />
            <PWAInstallBanner />
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;

