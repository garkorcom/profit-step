import React from 'react';
import { Container, Typography, Grid, Card, CardContent, CardActionArea, Box, Button, Divider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
    Security as AuthIcon,
    AdminPanelSettings as AdminIcon,
    Calculate as EstimateIcon,
    Business as CrmIcon,
    Assessment as ReportIcon,
    BugReport as DebugIcon,
    Storage as StorageIcon
} from '@mui/icons-material';
import { useAuth } from '../auth/AuthContext';
import { seedLocalDb } from '../scripts/seedLocalDb';
import { db } from '../firebase/firebase';
import TaskTimerButton from '../components/tasks/TaskTimerButton';

const DevIndexPage: React.FC = () => {
    const navigate = useNavigate();
    const { signOut, currentUser } = useAuth();

    const sections = [
        {
            title: 'Authentication',
            icon: <AuthIcon color="primary" />,
            links: [
                { label: 'Login', path: '/login' },
                { label: 'Signup', path: '/signup' },
                { label: 'Forgot Password', path: '/forgot-password' },
            ]
        },
        {
            title: 'Quick Actions',
            icon: <DebugIcon color="error" />,
            links: []
        },
        {
            title: 'Admin & Users',
            icon: <AdminIcon color="secondary" />,
            links: [
                { label: 'Team Management', path: '/admin/team' },
                { label: 'Companies', path: '/admin/companies' },
                { label: 'My Profile', path: '/profile' },
            ]
        },
        {
            title: 'Estimates (V2.1)',
            icon: <EstimateIcon color="warning" />,
            links: [
                { label: 'All Estimates', path: '/estimates' },
                { label: 'New Estimate', path: '/estimates/new' },
                { label: 'Electrical Estimator', path: '/estimates/electrical' },
                // { label: 'Constructor (Mock)', path: '/estimates/123/constructor' },
            ]
        },
        {
            title: 'CRM & FSM (V3.1)',
            icon: <CrmIcon color="success" />,
            links: [
                { label: 'Clients', path: '/crm/clients' },
                { label: 'Deals (Kanban)', path: '/crm/deals' },
                { label: 'Tasks (Kanban)', path: '/crm/tasks' },
                { label: 'Scheduler', path: '/crm/scheduler' },
            ]
        },
        {
            title: 'Analytics (V4)',
            icon: <ReportIcon color="info" />,
            links: [
                { label: 'Reports Hub', path: '/reports' },
            ]
        }
    ];

    const handleResetStorage = () => {
        localStorage.clear();
        window.location.reload();
    };

    // Time Tracking Test Logic
    const [testTask, setTestTask] = React.useState<any>(null);
    const [testSite, setTestSite] = React.useState<any>(null);

    React.useEffect(() => {
        const fetchTestData = async () => {
            if (!currentUser?.uid) return;
            try {
                // Get Company ID from user profile (we need to fetch profile first if not available in context, 
                // but let's assume we can get it or query broadly for dev purposes)
                // Actually, let's just query collections directly since we are in dev mode
                // Note: This assumes we have permissions or rules allow it.

                // 1. Get a Client
                const clientsSnap = await import('firebase/firestore').then(mod =>
                    mod.getDocs(mod.query(mod.collection(db, 'clients'), mod.limit(1)))
                );
                if (clientsSnap.empty) return;
                const client = clientsSnap.docs[0];

                // 2. Get a Site for that client
                const sitesSnap = await import('firebase/firestore').then(mod =>
                    mod.getDocs(mod.query(mod.collection(db, `companies/${client.data().companyId}/clients/${client.id}/sites`), mod.limit(1)))
                );
                if (sitesSnap.empty) return;
                const site = { id: sitesSnap.docs[0].id, ...sitesSnap.docs[0].data() };
                setTestSite(site);

                // 3. Get a Task
                const tasksSnap = await import('firebase/firestore').then(mod =>
                    mod.getDocs(mod.query(mod.collection(db, `companies/${client.data().companyId}/tasks`), mod.limit(1)))
                );
                if (!tasksSnap.empty) {
                    setTestTask({ id: tasksSnap.docs[0].id, ...tasksSnap.docs[0].data() });
                }
            } catch (e) {
                console.error('Failed to fetch test data for timer:', e);
            }
        };
        fetchTestData();
    }, [currentUser]);

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Typography variant="h3" component="h1" gutterBottom>
                    🗺️ Developer Map
                </Typography>
                <Box>
                    <Typography variant="caption" display="block" align="right">
                        User: {currentUser?.email || 'Guest'}
                    </Typography>
                    {currentUser && (
                        <Button variant="outlined" color="error" size="small" onClick={() => signOut()}>
                            Logout
                        </Button>
                    )}
                </Box>
            </Box>

            <Grid container spacing={3}>
                {sections.map((section, index) => (
                    <Grid size={{ xs: 12, md: 4 }} key={index}>
                        <Card elevation={3}>
                            <CardContent>
                                <Box display="flex" alignItems="center" gap={1} mb={2}>
                                    {section.icon}
                                    <Typography variant="h6">{section.title}</Typography>
                                </Box>
                                <Divider sx={{ mb: 2 }} />
                                <Grid container spacing={1}>
                                    {section.links.map((link) => (
                                        <Grid size={{ xs: 12 }} key={link.path}>
                                            <Button
                                                fullWidth
                                                variant="text"
                                                onClick={() => navigate(link.path)}
                                                sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                                            >
                                                {link.label}
                                            </Button>
                                        </Grid>
                                    ))}
                                </Grid>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}

                <Grid size={{ xs: 12, md: 4 }}>
                    <Card elevation={3} sx={{ bgcolor: '#fff0f0' }}>
                        <CardContent>
                            <Box display="flex" alignItems="center" gap={1} mb={2}>
                                <DebugIcon color="error" />
                                <Typography variant="h6">Debug Utils</Typography>
                            </Box>
                            <Divider sx={{ mb: 2 }} />
                            <Button
                                fullWidth
                                variant="contained"
                                color="warning"
                                onClick={handleResetStorage}
                                sx={{ mb: 1 }}
                            >
                                Reset Local Storage
                            </Button>
                            <Button
                                fullWidth
                                variant="contained"
                                color="primary"
                                sx={{ mb: 1 }}
                                onClick={async () => {
                                    try {
                                        const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth');
                                        const auth = getAuth();
                                        await signInWithEmailAndPassword(auth, 'admin@test.com', 'password123');
                                        alert('Logged in as admin@test.com');
                                        // window.location.reload(); // Removed to prevent subagent disconnect
                                    } catch (e: any) {
                                        console.error(e);
                                        if (e.code === 'auth/user-not-found') {
                                            try {
                                                const { getAuth, createUserWithEmailAndPassword } = await import('firebase/auth');
                                                const auth = getAuth();
                                                await createUserWithEmailAndPassword(auth, 'admin@test.com', 'password123');
                                                console.log('Created and logged in as admin@test.com');
                                            } catch (createError: any) {
                                                console.error('Login AND Creation failed: ' + createError.message);
                                            }
                                        } else {
                                            console.error('Login failed: ' + e.message);
                                        }
                                    }
                                }}
                            >
                                🔑 Quick Login (Admin)
                            </Button>
                            <Button
                                fullWidth
                                variant="outlined"
                                color="error"
                                onClick={() => { throw new Error('Test Error Boundary'); }}
                            >
                                Force Error
                            </Button>
                            <Divider sx={{ my: 2 }} />
                            <Button
                                fullWidth
                                variant="contained"
                                color="success"
                                startIcon={<StorageIcon />}
                                onClick={seedLocalDb}
                            >
                                Seed Local DB
                            </Button>
                            <Divider sx={{ my: 2 }} />
                            <Button
                                fullWidth
                                variant="text"
                                color="info"
                                onClick={() => navigate('/dev-health')}
                            >
                                System Health Check
                            </Button>
                            <Button
                                fullWidth
                                variant="contained"
                                color="secondary"
                                sx={{ mt: 1 }}
                                onClick={async () => {
                                    if (!currentUser) return alert('Not logged in');
                                    try {
                                        const { doc, setDoc, getDoc } = await import('firebase/firestore');
                                        const userRef = doc(db, 'users', currentUser.uid);
                                        const userSnap = await getDoc(userRef);

                                        const updates: any = { role: 'admin' };
                                        if (!userSnap.exists() || !userSnap.data()?.companyId) {
                                            updates.companyId = currentUser.uid;
                                            console.log('Setting missing companyId to uid');
                                        }

                                        await setDoc(userRef, updates, { merge: true });
                                        alert('Profile updated: Role=ADMIN, CompanyID set. Please refresh.');
                                        window.location.reload();
                                    } catch (e) {
                                        console.error(e);
                                        alert('Failed to update role');
                                    }
                                }}
                            >
                                🛠️ Fix My Role (Force Admin)
                            </Button>
                            <Divider sx={{ my: 2 }} />
                            <Button
                                fullWidth
                                variant="contained"
                                color="primary"
                                onClick={async () => {
                                    try {
                                        const { getFunctions, httpsCallable } = await import('firebase/functions');
                                        const functions = getFunctions();
                                        const createUser = httpsCallable(functions, 'admin_createUserWithPassword');

                                        const email = `test.user.${Date.now()}@example.com`;
                                        console.log('Attempting to create user:', email);

                                        const result = await createUser({
                                            email: email,
                                            password: 'password123',
                                            displayName: 'Test User Direct',
                                            role: 'manager'
                                        });

                                        console.log('✅ User created successfully:', result.data);
                                        alert(`Success! Created: ${email}`);
                                    } catch (e: any) {
                                        console.error('❌ Creation failed:', e);
                                        alert(`Failed: ${e.message}`);
                                    }
                                }}
                            >
                                🧪 Test Create User (Direct)
                            </Button>
                        </CardContent>
                    </Card>
                </Grid>

                {/* Time Tracking Test Panel */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card elevation={3} sx={{ bgcolor: '#e3f2fd' }}>
                        <CardContent>
                            <Box display="flex" alignItems="center" gap={1} mb={2}>
                                <Typography variant="h6">⏱️ Time Tracking Test</Typography>
                            </Box>
                            <Divider sx={{ mb: 2 }} />
                            {testTask && testSite ? (
                                <Box>
                                    <Typography variant="caption" gutterBottom>
                                        Task: {testTask.number}
                                    </Typography>
                                    <Box mt={1}>
                                        <Box mt={1}>
                                            <TaskTimerButton task={testTask} site={testSite} />
                                        </Box>
                                    </Box>
                                </Box>
                            ) : (
                                <Typography variant="body2" color="text.secondary">
                                    Seed DB to test timer.
                                </Typography>
                            )}
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Container>
    );
};

export default DevIndexPage;
