import React, { useState } from 'react';
import { Box, Typography, Button, IconButton, Slide } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddToHomeScreenIcon from '@mui/icons-material/AddToHomeScreen';
import AppleIcon from '@mui/icons-material/Apple';
import { usePWA } from '../../hooks/usePWA';

/**
 * PWA Install Banner
 * 
 * Shows an install prompt for:
 * - Android/Chrome: Uses native install prompt
 * - iOS/Safari: Shows instructions to add to Home Screen
 */
const PWAInstallBanner: React.FC = () => {
    const { isInstallable, isIOS, isInstalled, isStandalone, install, dismiss, showInstallPrompt } = usePWA();
    const [showIOSInstructions, setShowIOSInstructions] = useState(false);

    // Don't show if already installed or in standalone mode
    if (isInstalled || isStandalone) {
        return null;
    }

    // iOS: Show custom instructions
    if (isIOS && !isInstalled) {
        return (
            <>
                {/* iOS Banner */}
                <Slide direction="up" in={!showIOSInstructions} mountOnEnter unmountOnExit>
                    <Box
                        sx={{
                            position: 'fixed',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            bgcolor: 'rgba(255, 255, 255, 0.95)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                            borderTop: '1px solid rgba(0, 0, 0, 0.1)',
                            p: 2,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            zIndex: 9999,
                            boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.1)'
                        }}
                    >
                        <Box
                            sx={{
                                width: 48,
                                height: 48,
                                borderRadius: '12px',
                                bgcolor: '#007aff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                            }}
                        >
                            <AppleIcon sx={{ color: 'white', fontSize: 28 }} />
                        </Box>

                        <Box sx={{ flex: 1 }}>
                            <Typography
                                variant="subtitle1"
                                sx={{
                                    fontWeight: 600,
                                    fontSize: '15px',
                                    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
                                }}
                            >
                                Добавить Profit Step
                            </Typography>
                            <Typography
                                variant="body2"
                                sx={{
                                    color: '#86868b',
                                    fontSize: '13px',
                                    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif'
                                }}
                            >
                                Установите приложение на Home Screen
                            </Typography>
                        </Box>

                        <Button
                            variant="contained"
                            size="small"
                            onClick={() => setShowIOSInstructions(true)}
                            sx={{
                                bgcolor: '#007aff',
                                borderRadius: '20px',
                                textTransform: 'none',
                                fontWeight: 600,
                                px: 2,
                                '&:hover': { bgcolor: '#0066cc' }
                            }}
                        >
                            Как?
                        </Button>

                        <IconButton
                            size="small"
                            onClick={dismiss}
                            sx={{ color: '#86868b' }}
                        >
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Box>
                </Slide>

                {/* iOS Instructions Modal */}
                <Slide direction="up" in={showIOSInstructions} mountOnEnter unmountOnExit>
                    <Box
                        sx={{
                            position: 'fixed',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            bgcolor: 'white',
                            borderTopLeftRadius: '20px',
                            borderTopRightRadius: '20px',
                            p: 3,
                            zIndex: 10000,
                            boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.2)'
                        }}
                    >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                            <Typography variant="h6" sx={{ fontWeight: 600 }}>
                                Установка на iPad
                            </Typography>
                            <IconButton onClick={() => setShowIOSInstructions(false)}>
                                <CloseIcon />
                            </IconButton>
                        </Box>

                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Box sx={{
                                    width: 36, height: 36, borderRadius: '50%',
                                    bgcolor: '#007aff', color: 'white',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 600, fontSize: '16px'
                                }}>
                                    1
                                </Box>
                                <Typography>
                                    Нажмите <strong>Поделиться</strong> (иконка □↑) в Safari
                                </Typography>
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Box sx={{
                                    width: 36, height: 36, borderRadius: '50%',
                                    bgcolor: '#007aff', color: 'white',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 600, fontSize: '16px'
                                }}>
                                    2
                                </Box>
                                <Typography>
                                    Прокрутите вниз и выберите <strong>"На экран Домой"</strong>
                                </Typography>
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Box sx={{
                                    width: 36, height: 36, borderRadius: '50%',
                                    bgcolor: '#34c759', color: 'white',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 600, fontSize: '16px'
                                }}>
                                    ✓
                                </Box>
                                <Typography>
                                    Нажмите <strong>"Добавить"</strong> — готово!
                                </Typography>
                            </Box>
                        </Box>

                        <Button
                            fullWidth
                            variant="contained"
                            onClick={() => {
                                setShowIOSInstructions(false);
                                dismiss();
                            }}
                            sx={{
                                mt: 3,
                                bgcolor: '#007aff',
                                borderRadius: '12px',
                                py: 1.5,
                                textTransform: 'none',
                                fontWeight: 600,
                                fontSize: '16px'
                            }}
                        >
                            Понятно!
                        </Button>
                    </Box>
                </Slide>
            </>
        );
    }

    // Chrome/Android: Use native prompt
    if (!showInstallPrompt) {
        return null;
    }

    return (
        <Slide direction="up" in={isInstallable} mountOnEnter unmountOnExit>
            <Box
                sx={{
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    bgcolor: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    borderTop: '1px solid rgba(0, 0, 0, 0.1)',
                    p: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    zIndex: 9999,
                    boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.1)'
                }}
            >
                <Box
                    sx={{
                        width: 48,
                        height: 48,
                        borderRadius: '12px',
                        bgcolor: '#34c759',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                    }}
                >
                    <AddToHomeScreenIcon sx={{ color: 'white', fontSize: 28 }} />
                </Box>

                <Box sx={{ flex: 1 }}>
                    <Typography
                        variant="subtitle1"
                        sx={{
                            fontWeight: 600,
                            fontSize: '15px',
                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
                        }}
                    >
                        Установить Profit Step
                    </Typography>
                    <Typography
                        variant="body2"
                        sx={{
                            color: '#86868b',
                            fontSize: '13px'
                        }}
                    >
                        Быстрый доступ с Home Screen
                    </Typography>
                </Box>

                <Button
                    variant="contained"
                    size="small"
                    onClick={install}
                    sx={{
                        bgcolor: '#34c759',
                        borderRadius: '20px',
                        textTransform: 'none',
                        fontWeight: 600,
                        px: 2,
                        '&:hover': { bgcolor: '#2da44e' }
                    }}
                >
                    Установить
                </Button>

                <IconButton
                    size="small"
                    onClick={dismiss}
                    sx={{ color: '#86868b' }}
                >
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Box>
        </Slide>
    );
};

export default PWAInstallBanner;
