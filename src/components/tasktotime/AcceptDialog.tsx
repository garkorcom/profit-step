/**
 * @fileoverview Tasktotime — Accept dialog (extracted from TaskDetailPage).
 *
 * Phase 4.4 promotes the previously-inline `AcceptDialog` so the new BoardPage
 * (kanban) can drop the same UX in when a card is dragged onto the `accepted`
 * column. Behaviour is byte-for-byte identical to the original; only the
 * import location changed.
 *
 * Modal that collects the `acceptance` payload (signedAt, signedBy:
 * UserRef, signature?) required by the backend `accept` transition.
 *
 * UX choices:
 *   - `signedAt` is captured automatically when the dialog opens (no field
 *     for it — the payload represents "the moment the operator clicked
 *     Accept"). Stored in a ref so a slow human typing doesn't drift the
 *     timestamp.
 *   - `signedByName` defaults to the logged-in user's `displayName`. PMs
 *     usually accept on behalf of the client, but the field is editable so
 *     a different name can be entered.
 *   - `signedBy.id` defaults to the logged-in user's `id` so the audit log
 *     ties back to the operator. If the dialog ever evolves to "accept on
 *     behalf of client X" we'd swap this to a contact-picker.
 *   - `signature` is free-form (URL or placeholder text) and optional.
 */

import React, { useEffect, useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Stack,
    TextField,
} from '@mui/material';
import dayjs from 'dayjs';
import { Controller, useForm } from 'react-hook-form';

interface AcceptFormFields {
    signedByName: string;
    signature: string;
}

export interface AcceptDialogPayload {
    signedAt: number;
    signedBy: { id: string; name: string };
    signature?: string;
}

export interface AcceptDialogProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (payload: AcceptDialogPayload) => Promise<void>;
    submitting: boolean;
    defaultSignerId: string;
    defaultSignerName: string;
}

const AcceptDialog: React.FC<AcceptDialogProps> = ({
    open,
    onClose,
    onConfirm,
    submitting,
    defaultSignerId,
    defaultSignerName,
}) => {
    const { control, handleSubmit, reset, watch } = useForm<AcceptFormFields>({
        mode: 'onChange',
        defaultValues: { signedByName: defaultSignerName, signature: '' },
    });

    // signedAt is captured at dialog-open time so it represents the user's
    // intent moment, not whenever the form happens to submit. Re-set on each
    // open so a re-opened dialog gets a fresh timestamp.
    const [signedAtMs, setSignedAtMs] = useState<number>(() => Date.now());
    useEffect(() => {
        if (open) {
            setSignedAtMs(Date.now());
            reset({ signedByName: defaultSignerName, signature: '' });
        }
    }, [open, reset, defaultSignerName]);

    // Live-watch for the submit-button disable (see BlockDialog comment).
    const signerName = watch('signedByName') ?? '';
    const signerValid = signerName.trim().length > 0;

    const submit = handleSubmit(async (data) => {
        const trimmedName = data.signedByName.trim();
        const trimmedSignature = data.signature.trim();
        await onConfirm({
            signedAt: signedAtMs,
            signedBy: {
                id: defaultSignerId,
                name: trimmedName,
            },
            signature: trimmedSignature.length > 0 ? trimmedSignature : undefined,
        });
    });

    return (
        <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Accept task</DialogTitle>
            <form onSubmit={submit}>
                <DialogContent dividers>
                    <DialogContentText sx={{ mb: 2 }}>
                        Confirm acceptance. The signed timestamp is captured
                        now ({dayjs(signedAtMs).format('MMM D, YYYY h:mm A')}).
                    </DialogContentText>
                    <Stack spacing={2}>
                        <Controller
                            name="signedByName"
                            control={control}
                            rules={{
                                required: 'Signer name is required',
                                validate: (value) =>
                                    value.trim().length > 0 ||
                                    'Signer name is required',
                            }}
                            render={({ field, fieldState }) => (
                                <TextField
                                    {...field}
                                    label="Signed by"
                                    placeholder="Client name (or your own)"
                                    fullWidth
                                    autoFocus
                                    required
                                    error={Boolean(fieldState.error)}
                                    helperText={
                                        fieldState.error?.message ??
                                        'Name printed on the acceptance act.'
                                    }
                                />
                            )}
                        />
                        <Controller
                            name="signature"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    label="Signature (optional)"
                                    placeholder="https://… or placeholder text"
                                    fullWidth
                                    helperText="URL of the signed PDF / image, or a free-form note. Can be filled later."
                                />
                            )}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="contained"
                        color="success"
                        disabled={!signerValid || submitting}
                    >
                        {submitting ? 'Accepting…' : 'Accept'}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default AcceptDialog;
