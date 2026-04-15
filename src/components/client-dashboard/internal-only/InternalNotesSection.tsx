/**
 * Internal-only Notes section for client dashboard.
 * Team-only notes that are never visible to the client.
 */

import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Card,
  Button,
  TextField,
  Alert,
} from '@mui/material';

interface InternalNotesSectionProps {
  newNote: string;
  setNewNote: (value: string) => void;
  handleAdd: () => void;
}

const InternalNotesSection: React.FC<InternalNotesSectionProps> = ({
  newNote,
  setNewNote,
  handleAdd,
}) => (
  <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
    <Typography variant="h5" gutterBottom fontWeight="bold" color="error.main">
      Internal Notes (Team Only)
    </Typography>

    <Alert severity="warning" sx={{ mb: 3 }}>
      These notes are private and will never be visible to the client
    </Alert>

    <Paper variant="outlined" sx={{ p: 2, mb: 3, backgroundColor: '#f8f9fa' }}>
      <Typography variant="h6" gutterBottom>
        Add Internal Note
      </Typography>
      <Box display="flex" gap={1}>
        <TextField
          fullWidth
          multiline
          rows={2}
          placeholder="Add internal note (team observations, pricing strategy, client behavior, etc.)"
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
        />
        <Button
          variant="contained"
          onClick={handleAdd}
          disabled={!newNote.trim()}
          sx={{ minWidth: 100 }}
        >
          Add
        </Button>
      </Box>
    </Paper>

    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
      Notes will be stored in Firestore. Add a note above to start.
    </Typography>
  </Card>
);

export default InternalNotesSection;
