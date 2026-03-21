import React, { useState, useRef } from 'react';
import {
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Typography,
    Box,
    CircularProgress,
    Alert
} from '@mui/material';
import {
    PlayArrow as PlayIcon,
    Stop as StopIcon,
    CameraAlt as CameraIcon,
    DirectionsCar as CarIcon,
    Build as WorkIcon,
    Warning as WarningIcon
} from '@mui/icons-material';
import { useGeoLocation } from '../../hooks/useGeoLocation';
import { timeTrackingService } from '../../services/timeTrackingService';
import { Task } from '../../types/fsm.types';
import { Site } from '../../types/fsm.types';
import { useAuth } from '../../auth/AuthContext';

interface TaskTimerButtonProps {
    task: Task;
    site: Site;
    onStateChange?: () => void;
}

const TaskTimerButton: React.FC<TaskTimerButtonProps> = ({
    task,
    site,
    onStateChange
}) => {
    const { userProfile, currentUser } = useAuth();
    const { getLocation, calculateDistance, loading: geoLoading } = useGeoLocation();

    const [activeTimerId, setActiveTimerId] = useState<string | null>(null);
    const [mode, setMode] = useState<'work' | 'travel' | null>(null);

    const [openCamera, setOpenCamera] = useState(false);
    const [openOverride, setOpenOverride] = useState(false);

    const [cameraError, setCameraError] = useState<string | null>(null);
    const [geoError, setGeoError] = useState<string | null>(null);
    const [overrideReason, setOverrideReason] = useState('');

    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [imageBlob, setImageBlob] = useState<Blob | null>(null);
    const [processing, setProcessing] = useState(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Check for active timer on mount
    React.useEffect(() => {
        const checkActiveTimer = async () => {
            if (currentUser?.uid) {
                const timer = await timeTrackingService.getActiveTimer(currentUser.uid);
                if (timer && timer.taskId === task.id) {
                    setActiveTimerId(timer.id);
                }
            }
        };
        checkActiveTimer();
    }, [currentUser?.uid, task.id]);

    const handleStartClick = async (selectedMode: 'work' | 'travel') => {
        if (!navigator.onLine) {
            setGeoError('🔌 Нет интернета. Невозможно начать работу.');
            return;
        }
        setMode(selectedMode);
        setProcessing(true);
        setGeoError(null);

        try {
            // 1. Check Geo Location
            const location = await getLocation();

            // If Travel mode, we are less strict, but still want location
            if (selectedMode === 'travel') {
                setOpenCamera(true);
                startCamera();
                setProcessing(false);
                return;
            }

            // Work Mode: Strict Check
            const distance = calculateDistance({ lat: site.geo.lat, lng: site.geo.lng });

            if (distance === null) {
                throw new Error('Could not calculate distance');
            }

            const maxRadius = site.geo.radius || 150;

            if (distance > maxRadius) {
                setGeoError(`You are too far from the site (${Math.round(distance)}m). Max allowed: ${maxRadius}m.`);
                setOpenOverride(true); // Open Override Dialog
                setProcessing(false);
                return;
            }

            // 2. Open Camera for Proof
            setOpenCamera(true);
            startCamera();
        } catch (err: any) {
            setGeoError(err.message || 'Geolocation check failed');
        } finally {
            setProcessing(false);
        }
    };

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (err) {
            setCameraError('Could not access camera. Please allow camera access.');
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }
    };

    const handleCapture = () => {
        if (videoRef.current && canvasRef.current) {
            const context = canvasRef.current.getContext('2d');
            if (context) {
                canvasRef.current.width = videoRef.current.videoWidth;
                canvasRef.current.height = videoRef.current.videoHeight;
                context.drawImage(videoRef.current, 0, 0);

                canvasRef.current.toBlob((blob) => {
                    if (blob) {
                        setImageBlob(blob);
                        setCapturedImage(URL.createObjectURL(blob));
                        stopCamera();
                    }
                }, 'image/jpeg', 0.8);
            }
        }
    };

    const handleConfirmStart = async () => {
        if (!imageBlob || !mode || !currentUser?.uid || !userProfile?.companyId) return;

        setProcessing(true);
        try {
            const location = await getLocation(); // Get fresh location

            const timerId = await timeTrackingService.startTimer(
                userProfile.companyId,
                currentUser.uid,
                task,
                site,
                mode,
                location,
                imageBlob,
                overrideReason || undefined
            );

            setActiveTimerId(timerId);
            setOpenCamera(false);
            setOpenOverride(false);
            if (onStateChange) onStateChange();

        } catch (err) {
            console.error('Failed to start task:', err);
            setCameraError('Failed to start task. Please try again.');
        } finally {
            setProcessing(false);
        }
    };

    const handleStop = async () => {
        if (!activeTimerId) return;
        setProcessing(true);
        try {
            await timeTrackingService.stopTimer(activeTimerId, task.id);
            setActiveTimerId(null);
            if (onStateChange) onStateChange();
        } catch (err) {
            console.error('Failed to stop timer:', err);
        } finally {
            setProcessing(false);
        }
    };

    const handleOverrideConfirm = () => {
        setOpenOverride(false);
        setOpenCamera(true);
        startCamera();
    };

    const handleCloseDialog = () => {
        stopCamera();
        setOpenCamera(false);
        setCapturedImage(null);
        setImageBlob(null);
        setCameraError(null);
    };

    if (activeTimerId) {
        return (
            <Button
                variant="contained"
                color="error"
                startIcon={<StopIcon />}
                onClick={handleStop}
                disabled={processing}
                fullWidth
            >
                {processing ? 'Stopping...' : 'Stop Work'}
            </Button>
        );
    }

    return (
        <>
            <Box display="flex" gap={2}>
                <Button
                    variant="contained"
                    color="info"
                    startIcon={<CarIcon />}
                    onClick={() => handleStartClick('travel')}
                    disabled={processing || geoLoading}
                    fullWidth
                >
                    Start Travel
                </Button>
                <Button
                    variant="contained"
                    color="success"
                    startIcon={<WorkIcon />}
                    onClick={() => handleStartClick('work')}
                    disabled={processing || geoLoading}
                    fullWidth
                >
                    Start Work
                </Button>
            </Box>

            {geoError && !openOverride && (
                <Alert severity="error" sx={{ mt: 1 }}>
                    {geoError}
                </Alert>
            )}

            {/* Override Dialog */}
            <Dialog open={openOverride} onClose={() => setOpenOverride(false)}>
                <DialogTitle>
                    <Box display="flex" alignItems="center" gap={1}>
                        <WarningIcon color="warning" />
                        Location Warning
                    </Box>
                </DialogTitle>
                <DialogContent>
                    <Typography gutterBottom>
                        {geoError}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        If you are sure you are at the site (e.g. GPS drift), you can override this check.
                        Please provide a reason:
                    </Typography>
                    <textarea
                        style={{ width: '100%', marginTop: '10px', padding: '8px' }}
                        rows={3}
                        placeholder="Reason for override..."
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenOverride(false)}>Cancel</Button>
                    <Button
                        onClick={handleOverrideConfirm}
                        variant="contained"
                        color="warning"
                        disabled={!overrideReason.trim()}
                    >
                        Confirm Override
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Camera Dialog */}
            <Dialog open={openCamera} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
                <DialogTitle>Proof of Presence</DialogTitle>
                <DialogContent>
                    <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
                        <Typography variant="body2" color="text.secondary">
                            Please take a selfie to confirm you are at the site.
                        </Typography>

                        {cameraError && <Alert severity="error">{cameraError}</Alert>}

                        {!capturedImage ? (
                            <Box position="relative" width="100%" height="300px" bgcolor="#000">
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                                <canvas ref={canvasRef} style={{ display: 'none' }} />
                            </Box>
                        ) : (
                            <img src={capturedImage} alt="Proof" style={{ width: '100%', maxHeight: '300px', objectFit: 'cover' }} />
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog} color="inherit">Cancel</Button>
                    {!capturedImage ? (
                        <Button onClick={handleCapture} variant="contained" startIcon={<CameraIcon />}>
                            Capture
                        </Button>
                    ) : (
                        <>
                            <Button onClick={() => setCapturedImage(null)} color="warning">Retake</Button>
                            <Button onClick={handleConfirmStart} variant="contained" color="success" disabled={processing}>
                                {processing ? <CircularProgress size={24} /> : 'Confirm & Start'}
                            </Button>
                        </>
                    )}
                </DialogActions>
            </Dialog>
        </>
    );
};

export default TaskTimerButton;
