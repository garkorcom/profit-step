import React, { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Link, List, ListItem, ListItemIcon, ListItemText, Paper, Typography } from '@mui/material';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '../../../../firebase/firebase';

interface Props {
  clientId: string;
}

interface FileDoc {
  id: string;
  name?: string;
  url?: string;
  size?: number;
  type?: string;
  uploadedAt?: { toDate: () => Date };
}

const ClientFilesTab: React.FC<Props> = ({ clientId }) => {
  const [files, setFiles] = useState<FileDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'files'),
            where('clientId', '==', clientId),
            orderBy('uploadedAt', 'desc'),
            limit(100),
          ),
        );
        if (!cancelled) setFiles(snap.docs.map(d => ({ id: d.id, ...d.data() } as FileDoc)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить файлы');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;
  if (error) return <Alert severity="warning">{error}. Auto-folder tree — в Phase 2 (Module 3 §6.4).</Alert>;

  if (files.length === 0) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <InsertDriveFileIcon sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
        <Typography color="text.secondary">Файлов ещё нет</Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Файлы ({files.length})</Typography>
      <Paper>
        <List dense>
          {files.map(f => (
            <ListItem key={f.id}>
              <ListItemIcon><InsertDriveFileIcon /></ListItemIcon>
              <ListItemText
                primary={
                  f.url ? (
                    <Link href={f.url} target="_blank" rel="noopener noreferrer">{f.name ?? f.id}</Link>
                  ) : (
                    f.name ?? f.id
                  )
                }
                secondary={[
                  f.size ? `${(f.size / 1024).toFixed(0)} KB` : null,
                  f.uploadedAt ? f.uploadedAt.toDate().toLocaleDateString('ru-RU') : null,
                ].filter(Boolean).join(' · ')}
              />
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  );
};

export default ClientFilesTab;
