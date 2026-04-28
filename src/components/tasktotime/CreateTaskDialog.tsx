/**
 * @fileoverview Tasktotime — Create Task dialog.
 *
 * Modal for creating a new task from the web UI. Closes the user-visible UX
 * gap on `/crm/tasktotime/list` where the empty state previously told users
 * to "create one via the API or wait for estimate decomposition" — there was
 * no in-app affordance.
 *
 * Design notes
 * ------------
 *   - **Form lib**: react-hook-form + Controller wrapping MUI inputs (matches
 *     `BlockDialog` / `AcceptDialog` in `TaskDetailPage.tsx` and the Finance
 *     dialogs).
 *   - **Date lib**: dayjs via `AdapterDateFns` from `@mui/x-date-pickers`.
 *     The codebase doesn't have dayjs as a direct dep but it ships
 *     transitively under `node_modules` (see `TaskDetailPage.tsx`); date-fns
 *     is the dominant adapter so we follow that pattern here for the
 *     DatePicker.
 *   - **Priority wire format**: sends the string union (`'low' | 'medium' |
 *     'high' | 'critical'`) per PR #82. Backend's `parseCreateTaskBody`
 *     accepts both int and string; the string form keeps the DB writes
 *     consistent with the domain Task type.
 *   - **Idempotency key**: auto-generated via `crypto.randomUUID()` on
 *     submit (one key per click). The user never types it. A retry of the
 *     same click submits with the same key so the backend dedupes.
 *
 * Deliberately NOT in this PR (call-out in the PR description):
 *   - Assignee picker (Autocomplete from user list) — defaults to current
 *     user.
 *   - Dependency picker.
 *   - Attachment upload.
 *   - Project / client linking via picker (free-text fields only for now).
 */

import React, { useEffect } from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { Controller, useForm } from 'react-hook-form';

import { useCreateTask } from '../../hooks/useTasktotime';
import type {
    CreateTaskInput,
    TaskBucket,
    TaskCategory,
    TaskPriority,
    TaskUserRef,
} from '../../api/tasktotimeApi';

const BUCKET_OPTIONS: TaskBucket[] = ['inbox', 'next', 'someday', 'archive'];
const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'medium', 'high', 'critical'];
const CATEGORY_OPTIONS: TaskCategory[] = [
    'work',
    'punch',
    'inspection',
    'permit',
    'closeout',
];

type LifecycleChoice = 'draft' | 'ready';

/**
 * Form-state shape — distinct from `CreateTaskInput` because the form holds
 * raw strings (TextField type=number returns a string), the DatePicker uses
 * `Date | null`, and the assignedTo split is two fields the user sees as one.
 * `onSubmit` does the conversion to the wire DTO.
 */
interface CreateTaskFormValues {
    title: string;
    description: string;
    dueAt: Date | null;
    estimatedDurationMinutes: number;
    bucket: TaskBucket;
    priority: TaskPriority;
    requiredHeadcount: number;
    assignedToId: string;
    assignedToName: string;
    costInternal: number;
    priceClient: number;
    clientName: string;
    projectName: string;
    category: TaskCategory;
    /**
     * Checkbox-driven. When `true` we pass `initialLifecycle: 'ready'`
     * (skips the draft state for tasks the user knows are ready to work on);
     * when `false`, send `'draft'`.
     */
    markReady: boolean;
}

interface CreateTaskDialogProps {
    open: boolean;
    onClose: () => void;
    onCreated: (taskNumber: string) => void;
    /** Caller provides the company scope so the hook + payload don't have to
     * separately re-read auth context inside the dialog. */
    companyId: string;
    /** Default assignee — usually the current user. Both `id` and `name`
     * required since `assignedTo` is a `TaskUserRef`. */
    defaultAssignee: TaskUserRef;
}

/**
 * Generate a fresh idempotency key for one create-task POST.
 *
 * Mirrors `newIdempotencyKey()` in `TaskDetailPage.tsx`. `crypto.randomUUID()`
 * is on every modern browser; the fallback covers test environments / older
 * Safari that polyfills before injecting a `crypto` global.
 */
function newIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `create-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Default `dueAt` — today + 7 days. Construction tasks rarely have a
 * sub-week due date when typed by hand; tightens later via picker.
 */
function defaultDueDate(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(17, 0, 0, 0);
    return d;
}

const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({
    open,
    onClose,
    onCreated,
    companyId,
    defaultAssignee,
}) => {
    const [submitError, setSubmitError] = React.useState<string | null>(null);
    const [submitting, setSubmitting] = React.useState<boolean>(false);
    const createTask = useCreateTask();

    const { control, handleSubmit, reset, formState } = useForm<CreateTaskFormValues>({
        mode: 'onChange',
        defaultValues: {
            title: '',
            description: '',
            dueAt: defaultDueDate(),
            estimatedDurationMinutes: 60,
            bucket: 'next',
            priority: 'medium',
            requiredHeadcount: 1,
            assignedToId: defaultAssignee.id,
            assignedToName: defaultAssignee.name,
            costInternal: 0,
            priceClient: 0,
            clientName: '',
            projectName: '',
            category: 'work',
            markReady: false,
        },
    });

    // Reset on each open so a previous abandoned attempt doesn't leak in.
    // We re-seed `assignedTo*` from the default in case the prop has changed
    // since the last open (e.g. user switched tenants).
    useEffect(() => {
        if (open) {
            reset({
                title: '',
                description: '',
                dueAt: defaultDueDate(),
                estimatedDurationMinutes: 60,
                bucket: 'next',
                priority: 'medium',
                requiredHeadcount: 1,
                assignedToId: defaultAssignee.id,
                assignedToName: defaultAssignee.name,
                costInternal: 0,
                priceClient: 0,
                clientName: '',
                projectName: '',
                category: 'work',
                markReady: false,
            });
            setSubmitError(null);
        }
    }, [open, reset, defaultAssignee.id, defaultAssignee.name]);

    const closeIfIdle = (): void => {
        if (!submitting) onClose();
    };

    const onSubmit = handleSubmit(async (data) => {
        if (!data.dueAt) {
            setSubmitError('Due date is required.');
            return;
        }

        setSubmitError(null);
        setSubmitting(true);

        const initialLifecycle: LifecycleChoice = data.markReady ? 'ready' : 'draft';

        const payload: CreateTaskInput = {
            idempotencyKey: newIdempotencyKey(),
            companyId,
            title: data.title.trim(),
            // Strip empty strings so the backend doesn't persist blank
            // optional fields. `description` / `clientName` / `projectName`
            // are all optional on `CreateTaskInput`.
            ...(data.description.trim()
                ? { description: data.description.trim() }
                : {}),
            ...(data.clientName.trim()
                ? { clientName: data.clientName.trim() }
                : {}),
            ...(data.projectName.trim()
                ? { projectName: data.projectName.trim() }
                : {}),
            bucket: data.bucket,
            priority: data.priority,
            source: 'web',
            requiredHeadcount: Math.max(1, Number(data.requiredHeadcount) || 1),
            assignedTo: {
                id: data.assignedToId.trim() || defaultAssignee.id,
                name: data.assignedToName.trim() || defaultAssignee.name,
            },
            dueAt: data.dueAt.getTime(),
            estimatedDurationMinutes: Math.max(
                1,
                Number(data.estimatedDurationMinutes) || 60,
            ),
            costInternal: {
                amount: Math.max(0, Number(data.costInternal) || 0),
                currency: 'USD',
            },
            priceClient: {
                amount: Math.max(0, Number(data.priceClient) || 0),
                currency: 'USD',
            },
            category: data.category,
            initialLifecycle,
        };

        try {
            const created = await createTask.mutate(payload);
            onCreated(created.taskNumber);
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setSubmitError(message);
        } finally {
            setSubmitting(false);
        }
    });

    return (
        <Dialog
            open={open}
            onClose={closeIfIdle}
            maxWidth="md"
            fullWidth
            aria-labelledby="create-task-dialog-title"
        >
            <DialogTitle id="create-task-dialog-title">Create task</DialogTitle>
            <form onSubmit={onSubmit} noValidate>
                <DialogContent dividers>
                    {submitError && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {submitError}
                        </Alert>
                    )}

                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12 }}>
                            <Controller
                                name="title"
                                control={control}
                                rules={{
                                    required: 'Title is required',
                                    validate: (v) =>
                                        v.trim().length >= 3 ||
                                        'Title must be at least 3 characters',
                                }}
                                render={({ field, fieldState }) => (
                                    <TextField
                                        {...field}
                                        autoFocus
                                        fullWidth
                                        size="small"
                                        label="Title"
                                        required
                                        error={!!fieldState.error}
                                        helperText={fieldState.error?.message ?? ' '}
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Controller
                                name="description"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        fullWidth
                                        size="small"
                                        label="Description (optional)"
                                        multiline
                                        minRows={2}
                                        maxRows={6}
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <LocalizationProvider dateAdapter={AdapterDateFns}>
                                <Controller
                                    name="dueAt"
                                    control={control}
                                    rules={{ required: 'Due date is required' }}
                                    render={({ field, fieldState }) => (
                                        <DatePicker
                                            {...field}
                                            label="Due date"
                                            slotProps={{
                                                textField: {
                                                    size: 'small',
                                                    fullWidth: true,
                                                    required: true,
                                                    error: !!fieldState.error,
                                                    helperText:
                                                        fieldState.error?.message ?? ' ',
                                                },
                                            }}
                                        />
                                    )}
                                />
                            </LocalizationProvider>
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <Controller
                                name="estimatedDurationMinutes"
                                control={control}
                                rules={{
                                    min: { value: 1, message: 'Min 1 minute' },
                                }}
                                render={({ field, fieldState }) => (
                                    <TextField
                                        {...field}
                                        fullWidth
                                        size="small"
                                        type="number"
                                        label="Est. duration (min)"
                                        inputProps={{ min: 1 }}
                                        error={!!fieldState.error}
                                        helperText={fieldState.error?.message ?? ' '}
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <Controller
                                name="requiredHeadcount"
                                control={control}
                                rules={{
                                    min: { value: 1, message: 'At least 1 person' },
                                }}
                                render={({ field, fieldState }) => (
                                    <TextField
                                        {...field}
                                        fullWidth
                                        size="small"
                                        type="number"
                                        label="Required headcount"
                                        inputProps={{ min: 1 }}
                                        error={!!fieldState.error}
                                        helperText={fieldState.error?.message ?? ' '}
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <Controller
                                name="bucket"
                                control={control}
                                render={({ field }) => (
                                    <FormControl fullWidth size="small">
                                        <InputLabel id="create-task-bucket-label">
                                            Bucket
                                        </InputLabel>
                                        <Select
                                            {...field}
                                            labelId="create-task-bucket-label"
                                            label="Bucket"
                                        >
                                            {BUCKET_OPTIONS.map((opt) => (
                                                <MenuItem
                                                    key={opt}
                                                    value={opt}
                                                    sx={{ textTransform: 'capitalize' }}
                                                >
                                                    {opt}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <Controller
                                name="priority"
                                control={control}
                                render={({ field }) => (
                                    <FormControl fullWidth size="small">
                                        <InputLabel id="create-task-priority-label">
                                            Priority
                                        </InputLabel>
                                        <Select
                                            {...field}
                                            labelId="create-task-priority-label"
                                            label="Priority"
                                        >
                                            {PRIORITY_OPTIONS.map((opt) => (
                                                <MenuItem
                                                    key={opt}
                                                    value={opt}
                                                    sx={{ textTransform: 'capitalize' }}
                                                >
                                                    {opt}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <Controller
                                name="category"
                                control={control}
                                render={({ field }) => (
                                    <FormControl fullWidth size="small">
                                        <InputLabel id="create-task-category-label">
                                            Category
                                        </InputLabel>
                                        <Select
                                            {...field}
                                            labelId="create-task-category-label"
                                            label="Category"
                                        >
                                            {CATEGORY_OPTIONS.map((opt) => (
                                                <MenuItem
                                                    key={opt}
                                                    value={opt}
                                                    sx={{ textTransform: 'capitalize' }}
                                                >
                                                    {opt}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Typography
                                variant="overline"
                                color="text.secondary"
                                sx={{ display: 'block', mt: 1 }}
                            >
                                Assignee
                            </Typography>
                        </Grid>

                        <Grid size={{ xs: 12, md: 6 }}>
                            <Controller
                                name="assignedToName"
                                control={control}
                                rules={{ required: 'Assignee name is required' }}
                                render={({ field, fieldState }) => (
                                    <TextField
                                        {...field}
                                        fullWidth
                                        size="small"
                                        label="Assignee name"
                                        required
                                        error={!!fieldState.error}
                                        helperText={fieldState.error?.message ?? ' '}
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, md: 6 }}>
                            <Controller
                                name="assignedToId"
                                control={control}
                                rules={{ required: 'Assignee id is required' }}
                                render={({ field, fieldState }) => (
                                    <TextField
                                        {...field}
                                        fullWidth
                                        size="small"
                                        label="Assignee user ID"
                                        required
                                        error={!!fieldState.error}
                                        helperText={
                                            fieldState.error?.message ??
                                            'Defaults to your user ID. Picker comes in a later PR.'
                                        }
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Typography
                                variant="overline"
                                color="text.secondary"
                                sx={{ display: 'block', mt: 1 }}
                            >
                                Money (USD)
                            </Typography>
                        </Grid>

                        <Grid size={{ xs: 12, md: 6 }}>
                            <Controller
                                name="costInternal"
                                control={control}
                                rules={{
                                    min: { value: 0, message: 'Must be ≥ 0' },
                                }}
                                render={({ field, fieldState }) => (
                                    <TextField
                                        {...field}
                                        fullWidth
                                        size="small"
                                        type="number"
                                        label="Internal cost (USD)"
                                        inputProps={{ min: 0, step: '0.01' }}
                                        error={!!fieldState.error}
                                        helperText={fieldState.error?.message ?? ' '}
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, md: 6 }}>
                            <Controller
                                name="priceClient"
                                control={control}
                                rules={{
                                    min: { value: 0, message: 'Must be ≥ 0' },
                                }}
                                render={({ field, fieldState }) => (
                                    <TextField
                                        {...field}
                                        fullWidth
                                        size="small"
                                        type="number"
                                        label="Client price (USD)"
                                        inputProps={{ min: 0, step: '0.01' }}
                                        error={!!fieldState.error}
                                        helperText={fieldState.error?.message ?? ' '}
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Typography
                                variant="overline"
                                color="text.secondary"
                                sx={{ display: 'block', mt: 1 }}
                            >
                                Linking (optional)
                            </Typography>
                        </Grid>

                        <Grid size={{ xs: 12, md: 6 }}>
                            <Controller
                                name="clientName"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        fullWidth
                                        size="small"
                                        label="Client name"
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, md: 6 }}>
                            <Controller
                                name="projectName"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        fullWidth
                                        size="small"
                                        label="Project name"
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Box sx={{ mt: 1 }}>
                                <Controller
                                    name="markReady"
                                    control={control}
                                    render={({ field }) => (
                                        <FormControlLabel
                                            control={
                                                <Checkbox
                                                    checked={field.value}
                                                    onChange={(e) =>
                                                        field.onChange(e.target.checked)
                                                    }
                                                    size="small"
                                                />
                                            }
                                            label="Mark as ready immediately (skip draft)"
                                        />
                                    )}
                                />
                            </Box>
                        </Grid>
                    </Grid>
                </DialogContent>

                <DialogActions>
                    <Button onClick={closeIfIdle} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="contained"
                        disabled={submitting || !formState.isValid}
                        startIcon={
                            submitting ? <CircularProgress size={14} /> : undefined
                        }
                    >
                        {submitting ? 'Creating…' : 'Create task'}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default CreateTaskDialog;
