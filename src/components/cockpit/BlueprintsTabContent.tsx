/**
 * @fileoverview BlueprintsTabContent — File manager for project blueprints
 * Extracted from UnifiedCockpitPage inline component.
 * @module components/cockpit/BlueprintsTabContent
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, Alert, Chip,
  FormControl, Select, MenuItem, CircularProgress,
  Accordion, AccordionSummary, AccordionDetails,
  List, ListItem, ListItemIcon, ListItemText, Link,
} from '@mui/material';
import {
  Add as AddIcon,
  ExpandMore as ExpandMoreIcon,
  Description as BlueprintIcon,
} from '@mui/icons-material';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { format as formatDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { BLUEPRINT_SECTIONS, BlueprintSection, BlueprintFile } from './cockpit.types';

interface BlueprintsTabContentProps {
  projectId: string;
}

const BlueprintsTabContent: React.FC<BlueprintsTabContentProps> = ({ projectId }) => {
  const [files, setFiles] = useState<BlueprintFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadSection, setUploadSection] = useState<BlueprintSection>('electrical');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(BLUEPRINT_SECTIONS.map(s => s.key)));

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);

    const q = query(
      collection(db, `clients/${projectId}/files`),
      orderBy('uploadedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const filesList: BlueprintFile[] = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || 'unnamed',
          path: data.path || '',
          url: data.url || '',
          size: data.size || 0,
          contentType: data.contentType || '',
          description: data.description || '',
          version: data.version || 1,
          uploadedBy: data.uploadedBy || 'unknown',
          uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || null,
          section: data.section || 'general',
        };
      });
      setFiles(filesList);
      setLoading(false);
    }, (err) => {
      console.error('Error loading blueprint files:', err);
      setError('Не удалось загрузить файлы');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [projectId]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        if (file.size > 50 * 1024 * 1024) {
          setError(`Файл "${file.name}" слишком большой (максимум 50MB)`);
          continue;
        }

        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const response = await fetch(`/api/projects/${projectId}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            base64Data: base64,
            section: uploadSection,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Upload failed: ${response.status}`);
        }

        setSuccessMsg(`Файл "${file.name}" загружен в ${uploadSection}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки файла';
      console.error('Upload error:', err);
      setError(message);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }, [projectId, uploadSection]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;

  // Group files by section
  const grouped: Record<string, BlueprintFile[]> = {};
  BLUEPRINT_SECTIONS.forEach(s => { grouped[s.key] = []; });
  files.forEach(f => {
    const sec = f.section || 'general';
    if (grouped[sec]) grouped[sec].push(f);
    else grouped['general'].push(f);
  });

  return (
    <Box>
      {/* Upload area */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <Select
            value={uploadSection}
            onChange={(e) => setUploadSection(e.target.value as BlueprintSection)}
            displayEmpty
          >
            {BLUEPRINT_SECTIONS.map(s => (
              <MenuItem key={s.key} value={s.key}>{s.icon} {s.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="contained"
          component="label"
          disabled={uploading}
          startIcon={uploading ? <CircularProgress size={18} color="inherit" /> : <AddIcon />}
        >
          {uploading ? 'Загрузка...' : 'Загрузить'}
          <input
            type="file"
            hidden
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
            onChange={handleFileUpload}
          />
        </Button>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg(null)}>{successMsg}</Alert>}

      {/* Sections */}
      {BLUEPRINT_SECTIONS.map(sec => {
        const sectionFiles = grouped[sec.key] || [];
        return (
          <Accordion
            key={sec.key}
            expanded={expandedSections.has(sec.key)}
            onChange={() => toggleSection(sec.key)}
            variant="outlined"
            sx={{ mb: 1, '&:before': { display: 'none' } }}
            disableGutters
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box display="flex" alignItems="center" gap={1}>
                <Typography>{sec.icon}</Typography>
                <Typography fontWeight={600}>{sec.label}</Typography>
                <Chip label={sectionFiles.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 1 }}>
              {sectionFiles.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1, pl: 1 }}>
                  Нет файлов в этом разделе
                </Typography>
              ) : (
                <List dense disablePadding>
                  {sectionFiles.map(file => (
                    <ListItem key={file.id} sx={{ py: 0.5 }}>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        {file.contentType?.includes('pdf') ? <BlueprintIcon color="error" fontSize="small" /> : <BlueprintIcon color="primary" fontSize="small" />}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Link href={file.url} target="_blank" rel="noopener noreferrer" underline="hover" fontWeight={500}>
                            {file.name}
                          </Link>
                        }
                        secondary={`${formatFileSize(file.size)} · v${file.version}${file.uploadedAt ? ' · ' + formatDate(new Date(file.uploadedAt), 'dd MMM yyyy', { locale: ru }) : ''}`}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
};

export default BlueprintsTabContent;
