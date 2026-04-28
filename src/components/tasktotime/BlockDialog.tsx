/**
 * @fileoverview Tasktotime — Block dialog (extracted from TaskDetailPage).
 *
 * Phase 4.4 promotes the previously-inline `BlockDialog` so the new BoardPage
 * (kanban) can drop the same UX in when a card is dragged onto the `blocked`
 * column. Behaviour is byte-for-byte identical to the original; only the
 * import location changed.
 *
 * Modal that collects the `blockedReason` (>= 5 chars) required by the
 * backend `block` transition. Submit is disabled until the field is valid;
 * the parent re-renders the lifecycle once the mutation resolves.
 *
 * Why react-hook-form: matches the existing house style (e.g.
 * `AddPaymentDialog`, `CreateInvoiceDialog`) — validation rules sit next to
 * the field, `formState.isValid` drives the submit button, and the form
 * resets cleanly on close.
 */

import React, { useEffect } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    TextField,
} from '@mui/material';
import { Controller, useForm } from 'react-hook-form';

interface BlockFormFields {
    blockedReason: string;
}

export interface BlockDialogProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => Promise<void>;
    submitting: boolean;
}

const BlockDialog: React.FC<BlockDialogProps> = ({ open, onClose, onConfirm, submitting }) => {
    const { control, handleSubmit, reset, watch } = useForm<BlockFormFields>({
        mode: 'onChange',
        defaultValues: { blockedReason: '' },
    });

    // Reset on each open so a previous abandoned attempt doesn't leak in.
    useEffect(() => {
        if (open) reset({ blockedReason: '' });
    }, [open, reset]);

    // Live-watch the field for the submit-button disable. Using `watch`
    // instead of `formState.isValid` because v7's `isValid` starts as `true`
    // for `mode: 'onChange'` until the user touches the field — which would
    // leave the button incorrectly enabled on an empty initial form.
    const reasonValue = watch('blockedReason') ?? '';
    const reasonValid = reasonValue.trim().length >= 5;

    const submit = handleSubmit(async (data) => {
        await onConfirm(data.blockedReason.trim());
    });

    return (
        <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Block task</DialogTitle>
            <form onSubmit={submit}>
                <DialogContent dividers>
                    <DialogContentText sx={{ mb: 2 }}>
                        Tell the team why you&apos;re blocking this task. The
                        reason is shown in the task banner and recorded in the
                        history log. Minimum 5 characters.
                    </DialogContentText>
                    <Controller
                        name="blockedReason"
                        control={control}
                        rules={{
                            required: 'Reason is required',
                            validate: (value) =>
                                value.trim().length >= 5 ||
                                'Reason must be at least 5 characters',
                        }}
                        render={({ field, fieldState }) => (
                            <TextField
                                {...field}
                                label="Reason"
                                placeholder="e.g. Waiting on permit committee approval"
                                multiline
                                minRows={2}
                                fullWidth
                                autoFocus
                                error={Boolean(fieldState.error)}
                                helperText={
                                    fieldState.error?.message ??
                                    `${field.value.trim().length}/5 characters minimum`
                                }
                            />
                        )}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="contained"
                        color="warning"
                        disabled={!reasonValid || submitting}
                    >
                        {submitting ? 'Blocking…' : 'Block'}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default BlockDialog;
