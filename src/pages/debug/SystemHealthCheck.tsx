import React, { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc, collection, getDocs, limit, query } from 'firebase/firestore';
import { Container, Typography, Paper, Button, Box, Divider, Alert } from '@mui/material';
import { CheckCircle, Error as ErrorIcon, Warning as WarningIcon, Pending as PendingIcon } from '@mui/icons-material';

// Simple component to display status
const StatusRow = ({ label, status, error }: { label: string, status: 'pending' | 'ok' | 'error', error?: string }) => {
    let color = 'text.secondary';
    let icon = <PendingIcon color="action" />;

    if (status === 'ok') {
        color = 'success.main';
        icon = <CheckCircle color="success" />;
    } else if (status === 'error') {
        color = 'error.main';
        icon = <ErrorIcon color="error" />;
    }

    return (
        <Box display="flex" alignItems="center" gap={2} mb={2}>
            <Box width={30}>{icon}</Box>
            <Typography variant="subtitle1" sx={{ width: 250, fontWeight: 'bold' }}>{label}:</Typography>
            <Typography variant="subtitle1" sx={{ color, fontWeight: 'bold' }}>
                {status.toUpperCase()}
            </Typography>
            {error && <Typography variant="caption" color="error">({error})</Typography>}
        </Box>
    );
};

export const SystemHealthCheck: React.FC = () => {
    const [checks, setChecks] = useState({
        auth: 'pending',
        firestoreProfile: 'pending',
        estimateFunc: 'pending',
        fsmGeo: 'pending',
    });

    const db = getFirestore();
    const auth = getAuth();
    const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

    useEffect(() => {
        // Wait for auth to initialize
        const unsubscribe = auth.onAuthStateChanged((user) => {
            setCurrentUserEmail(user?.email || null);
            runDiagnostics(user);
        });
        return () => unsubscribe();
    }, []);

    const runDiagnostics = async (user: any) => {
        // 1. Check AUTH and Profile (V0)
        if (!user) {
            setChecks(c => ({ ...c, auth: 'error', firestoreProfile: 'pending' }));
            return;
        }

        setChecks(c => ({ ...c, auth: 'ok' }));

        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists() && userDoc.data().companyId) {
                setChecks(c => ({ ...c, firestoreProfile: 'ok' }));

                // 2. Check Cloud Functions for Estimates (V2.1)
                // Try to find any estimate and check for totals
                try {
                    const companyId = userDoc.data().companyId;
                    const estimatesRef = collection(db, `companies/${companyId}/estimates`);
                    const q = query(estimatesRef, limit(1));
                    const snap = await getDocs(q);

                    if (!snap.empty) {
                        const est = snap.docs[0].data();
                        if (est.totals && typeof est.totals.grandTotal === 'number') {
                            setChecks(c => ({ ...c, estimateFunc: 'ok' }));
                        } else {
                            setChecks(c => ({ ...c, estimateFunc: 'error' })); // Recalc function didn't work
                        }
                    } else {
                        setChecks(c => ({ ...c, estimateFunc: 'pending' })); // No estimates to check
                    }
                } catch (e) {
                    console.error(e);
                    setChecks(c => ({ ...c, estimateFunc: 'error' }));
                }

            } else {
                setChecks(c => ({ ...c, firestoreProfile: 'error' }));
            }
        } catch (e) {
            setChecks(c => ({ ...c, firestoreProfile: 'error' }));
        }

        // 3. Check Geo Services (V3.1)
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => setChecks(c => ({ ...c, fsmGeo: 'ok' })),
                (error) => setChecks(c => ({ ...c, fsmGeo: 'error' }))
            );
        } else {
            setChecks(c => ({ ...c, fsmGeo: 'error' }));
        }
    };

    return (
        <Container maxWidth="md" sx={{ mt: 4 }}>
            <Paper elevation={3} sx={{ p: 4 }}>
                <Typography variant="h4" gutterBottom>
                    🚑 System Diagnostic Wire
                </Typography>
                <Typography variant="body1" gutterBottom>
                    Current User: <strong>{currentUserEmail || 'Not Logged In'}</strong>
                </Typography>

                {!currentUserEmail && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        Please log in to perform full diagnostics.
                    </Alert>
                )}

                <Divider sx={{ my: 3 }} />

                <StatusRow label="Authentication" status={checks.auth as any} />
                <StatusRow label="User Profile & Company" status={checks.firestoreProfile as any} />
                <StatusRow label="Estimate Calculator (Server)" status={checks.estimateFunc as any} />
                <StatusRow label="GeoLocation API" status={checks.fsmGeo as any} />

                <Box mt={4}>
                    <Button
                        variant="contained"
                        onClick={() => runDiagnostics(auth.currentUser)}
                        disabled={!auth.currentUser}
                    >
                        Rerun Diagnostics
                    </Button>
                </Box>
            </Paper>
        </Container>
    );
};

export default SystemHealthCheck;
