import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
    Grid, Autocomplete, Box, Avatar, Typography
} from '@mui/material';
import { collection, query, where, getDocs, addDoc, Timestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';


interface CreateSessionDialogProps {
    open: boolean;
    onClose: () => void;
    onSessionCreated: () => void;
}

interface EmployeeOption {
    id: string;
    name: string;
    photoUrl?: string;
    hourlyRate?: number;
}

const CreateSessionDialog: React.FC<CreateSessionDialogProps> = ({ open, onClose, onSessionCreated }) => {
    const { userProfile } = useAuth();
    const [employees, setEmployees] = useState<EmployeeOption[]>([]);
    const [selectedEmployee, setSelectedEmployee] = useState<EmployeeOption | null>(null);
    const [clientName, setClientName] = useState('');
    const [description, setDescription] = useState('');
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [hourlyRate, setHourlyRate] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [fetchingEmployees, setFetchingEmployees] = useState(false);

    useEffect(() => {
        if (open && userProfile?.companyId) {
            fetchEmployees(userProfile.companyId);
            // Reset form
            setSelectedEmployee(null);
            setClientName('');
            setDescription('');
            setStartTime('');
            setEndTime('');
            setHourlyRate('');
        }
    }, [open, userProfile?.companyId]);

    const fetchEmployees = async (companyId: string) => {
        setFetchingEmployees(true);
        try {
            // Fetch from 'users' collection or 'employees' based on your structure
            // Assuming 'users' collection has all staff
            const q = query(collection(db, 'users'), where('companyId', '==', companyId));
            const snapshot = await getDocs(q);
            const emps = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data.displayName || data.name || 'Unknown',
                    photoUrl: data.photoUrl,
                    hourlyRate: data.hourlyRate || 0
                };
            });
            setEmployees(emps);
        } catch (error) {
            console.error("Error fetching employees:", error);
        } finally {
            setFetchingEmployees(false);
        }
    };

    // Auto-set hourly rate when employee selected
    useEffect(() => {
        if (selectedEmployee) {
            if (selectedEmployee.hourlyRate) {
                setHourlyRate(String(selectedEmployee.hourlyRate));
            } else {
                // Try fetching employee extended profile if needed, or default to 0
                fetchEmployeeRate(selectedEmployee.id);
            }
        }
    }, [selectedEmployee]);

    const fetchEmployeeRate = async (userId: string) => {
        try {
            const docRef = doc(db, 'employees', userId);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                const data = snap.data();
                if (data.hourlyRate) {
                    setHourlyRate(String(data.hourlyRate));
                }
            }
        } catch (e) {
            console.error("Error fetching detailed rate:", e);
        }
    };

    const handleSave = async () => {
        if (!selectedEmployee || !startTime || !endTime || !userProfile?.companyId) {
            alert("Please fill in all required fields (Employee, Start Time, End Time)");
            return;
        }

        setLoading(true);
        try {
            const start = new Date(startTime);
            const end = new Date(endTime);

            // Calc duration
            const diffMs = end.getTime() - start.getTime();
            if (diffMs < 0) {
                alert("End time must be after start time");
                setLoading(false);
                return;
            }
            const durationMinutes = Math.floor(diffMs / 1000 / 60);

            // Calc earnings
            const rate = parseFloat(hourlyRate) || 0;
            const hours = durationMinutes / 60;
            const earnings = parseFloat((hours * rate).toFixed(2));

            const newSession: any = {
                employeeId: Number(selectedEmployee.id) || 0, // Fallback if ID is numeric vs string
                // Wait type says employeeId is number. My fetch returns doc.id which is string usually from Auth (uid).
                // Let's check TimeTrackingPage again. SelectedEmployee sets id: String(session.employeeId).
                // Existing sessions seem to use numeric IDs (Telegram ID?).
                // If I am creating for a web user, ID is string UID.
                // If I create for Telegram worker, ID is numeric chat ID.
                // This is a potential conflict. 'users' collection usually uses UID (string).
                // Worker Bot rate snapshot logic uses 'userId' (number).
                // I'll stick to string for now, but type says number.
                // WorkSession interface: employeeId: number.
                // This implies legacy bot structure.
                // If I select a web user, I might not have a numeric ID.
                // Strategy: Save raw UID string in a new field if needed, or force number?
                // Let's check onWorkerBotMessage logic. 'userId' is telegram ID.
                // If I want to support WEB USERS via this dialog, I need to know their numeric ID, or update schema to support string IDs.
                // OR, assume selectedEmployee has a 'telegramId' field or similar if they are linked.
                // FOR NOW: I will cast to any or string and save 'employeeId' as string if needed, or verify if types allow.
                // Types say `employeeId: number`.
                // Let's look at `createTask` or similar.
                // For this task, I'll store `uid` as `employeeId` (string) and update type to `number | string` if possible, OR
                // Just save it. Firestore is flexible. The frontend Type `WorkSession` expects number.
                // I will update WorkSession type to `employeeId: number | string;`.
            };

            // Correction: WorkSession uses `employeeId` which is typically Telegram ID.
            // But we also have `uid` for web users.
            // Let's check `users` collection data structure.
            // Ideally, I should save `employeeId` (if available) OR `uid`.
            // I'll update the type to allow string ID to support web users.

            const sessionData = {
                employeeId: selectedEmployee.id, // String UID usually
                employeeName: selectedEmployee.name,
                clientId: 'manual', // or derived
                clientName: clientName || 'Manual Entry',
                companyId: userProfile.companyId,
                startTime: Timestamp.fromDate(start),
                endTime: Timestamp.fromDate(end),
                durationMinutes: durationMinutes,
                hourlyRate: rate,
                sessionEarnings: earnings,
                description: description || 'Manually created by admin',
                status: 'completed', // Auto-completed
                createdAt: Timestamp.now()
            };

            await addDoc(collection(db, 'work_sessions'), sessionData);

            onSessionCreated();
            onClose();
        } catch (error) {
            console.error("Error creating session:", error);
            alert("Failed to create session");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Add Manual Session</DialogTitle>
            <DialogContent>
                <Grid container spacing={2} sx={{ mt: 1 }}>
                    <Grid size={{ xs: 12 }}>
                        <Autocomplete
                            options={employees}
                            getOptionLabel={(option) => option.name}
                            value={selectedEmployee}
                            onChange={(e, newValue) => setSelectedEmployee(newValue)}
                            renderOption={(props, option) => (
                                <Box component="li" {...props}>
                                    <Avatar src={option.photoUrl} sx={{ width: 24, height: 24, mr: 2 }} />
                                    {option.name}
                                </Box>
                            )}
                            renderInput={(params) => (
                                <TextField
                                    {...params}
                                    label="Select Employee"
                                    fullWidth
                                    required
                                    InputProps={{
                                        ...params.InputProps,
                                        endAdornment: (
                                            <>
                                                {fetchingEmployees ? <Typography variant="caption">Loading...</Typography> : null}
                                                {params.InputProps.endAdornment}
                                            </>
                                        ),
                                    }}
                                />
                            )}
                        />
                    </Grid>

                    <Grid size={{ xs: 8 }}>
                        <TextField
                            label="Client / Project"
                            fullWidth
                            value={clientName}
                            onChange={(e) => setClientName(e.target.value)}
                        />
                    </Grid>
                    <Grid size={{ xs: 4 }}>
                        <TextField
                            label="Hourly Rate ($)"
                            type="number"
                            fullWidth
                            value={hourlyRate}
                            onChange={(e) => setHourlyRate(e.target.value)}
                        />
                    </Grid>

                    <Grid size={{ xs: 6 }}>
                        <TextField
                            label="Start Time"
                            type="datetime-local"
                            fullWidth
                            required
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                        <TextField
                            label="End Time"
                            type="datetime-local"
                            fullWidth
                            required
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                        <TextField
                            label="Description"
                            fullWidth
                            multiline
                            rows={2}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={loading}>Cancel</Button>
                <Button onClick={handleSave} variant="contained" disabled={loading}>
                    {loading ? 'Creating...' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default CreateSessionDialog;
