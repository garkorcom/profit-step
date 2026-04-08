/**
 * @fileoverview ProjectFilesTab — Upload & manage blueprint files for a project
 * 
 * Features:
 * - Upload files (base64) via Agent API
 * - List files with version history
 * - Preview for images/PDF
 * - Split PDF into pages
 * 
 * @module components/crm/ProjectFilesTab
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Paper, CircularProgress,
  Alert, Chip, IconButton, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions,
  LinearProgress,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  InsertDriveFile as FileIcon,
  PictureAsPdf as PdfIcon,
  Image as ImageIcon,
  Visibility as PreviewIcon,
  ContentCut as SplitIcon,
  } from '@mui/icons-material';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { format as formatDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { errorMessage } from '../../utils/errorMessage';

interface ProjectFile {
  id: string;
  name: string;
  path: string;
  url: string;
  size: number;
  contentType: string;
  description: string;
  version: number;
  uploadedBy: string;
  uploadedAt: string | null;
}

interface ProjectFilesTabProps {
  projectId: string;
  agentApiBaseUrl?: string;
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (contentType: string) => {
  if (contentType?.includes('pdf')) return <PdfIcon color="error" />;
  if (contentType?.includes('image')) return <ImageIcon color="primary" />;
  return <FileIcon color="action" />;
};

const ProjectFilesTab: React.FC<ProjectFilesTabProps> = ({ projectId }) => {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [splitting, setSplitting] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Real-time listener for files subcollection
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);

    const q = query(
      collection(db, 'projects', projectId, 'files'),
      orderBy('uploadedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const filesList = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || '',
          path: data.path || '',
          url: data.url || '',
          size: data.size || 0,
          contentType: data.contentType || 'application/octet-stream',
          description: data.description || '',
          version: data.version || 1,
          uploadedBy: data.uploadedBy || 'unknown',
          uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || null,
        } as ProjectFile;
      });
      setFiles(filesList);
      setLoading(false);
    }, (err) => {
      console.error('Error loading files:', err);
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

        // Check size limit (50MB)
        if (file.size > 50 * 1024 * 1024) {
          setError(`Файл "${file.name}" слишком большой (максимум 50MB)`);
          continue;
        }

        // Convert to base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix
            const base64Data = result.split(',')[1];
            resolve(base64Data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Upload via Agent API
        const response = await fetch(`/api/projects/${projectId}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            base64Data: base64,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Upload failed: ${response.status}`);
        }

        setSuccessMsg(`Файл "${file.name}" загружен`);
      }
    } catch (err: unknown) {
      console.error('Upload error:', err);
      setError(errorMessage(err) || 'Ошибка загрузки файла');
    } finally {
      setUploading(false);
      // Reset input
      event.target.value = '';
    }
  }, [projectId]);

  const handleSplitPdf = useCallback(async (fileId: string, fileName: string) => {
    setSplitting(fileId);
    setError(null);

    try {
      const response = await fetch('/api/blueprint/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, fileId }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Split failed: ${response.status}`);
      }

      const result = await response.json();
      setSuccessMsg(`PDF "${fileName}" разбит на ${result.totalPages} страниц`);
    } catch (err: unknown) {
      console.error('Split error:', err);
      setError(errorMessage(err) || 'Ошибка разбивки PDF');
    } finally {
      setSplitting(null);
    }
  }, [projectId]);

  const handlePreview = (url: string, name: string) => {
    setPreviewUrl(url);
    setPreviewName(name);
  };

  // Group files by name for version display
  const groupedFiles: Record<string, ProjectFile[]> = {};
  for (const file of files) {
    if (!groupedFiles[file.name]) groupedFiles[file.name] = [];
    groupedFiles[file.name].push(file);
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ py: 2 }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6" fontWeight={600}>
          📄 Чертежи и Файлы
        </Typography>
        <Button
          variant="contained"
          startIcon={uploading ? <CircularProgress size={18} color="inherit" /> : <UploadIcon />}
          component="label"
          disabled={uploading}
        >
          {uploading ? 'Загрузка...' : 'Загрузить файл'}
          <input
            type="file"
            hidden
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
            onChange={handleFileUpload}
          />
        </Button>
      </Box>

      {uploading && <LinearProgress sx={{ mb: 2 }} />}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      {/* Files Table */}
      {files.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{
            p: 4,
            textAlign: 'center',
            borderStyle: 'dashed',
            borderColor: 'grey.400',
          }}
        >
          <UploadIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
          <Typography color="text.secondary">
            Нет загруженных файлов
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Загрузите PDF чертежи или изображения для анализа
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Файл</TableCell>
                <TableCell align="center">Версия</TableCell>
                <TableCell align="right">Размер</TableCell>
                <TableCell>Дата</TableCell>
                <TableCell align="center">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id} hover>
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={1}>
                      {getFileIcon(file.contentType)}
                      <Box>
                        <Typography variant="body2" fontWeight={500}>
                          {file.name}
                        </Typography>
                        {file.description && (
                          <Typography variant="caption" color="text.secondary">
                            {file.description}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={`v${file.version}`}
                      size="small"
                      color={file.version > 1 ? 'warning' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="caption">
                      {formatFileSize(file.size)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {file.uploadedAt
                        ? formatDate(new Date(file.uploadedAt), 'dd MMM yyyy HH:mm', { locale: ru })
                        : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Stack direction="row" spacing={0.5} justifyContent="center">
                      <Tooltip title="Предпросмотр">
                        <IconButton
                          size="small"
                          onClick={() => handlePreview(file.url, file.name)}
                        >
                          <PreviewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      {file.contentType?.includes('pdf') && (
                        <Tooltip title="Разбить PDF на страницы">
                          <IconButton
                            size="small"
                            onClick={() => handleSplitPdf(file.id, file.name)}
                            disabled={splitting === file.id}
                          >
                            {splitting === file.id
                              ? <CircularProgress size={18} />
                              : <SplitIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      )}

                      <Tooltip title="Скачать">
                        <IconButton
                          size="small"
                          component="a"
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <FileIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Version Groups Summary */}
      {Object.keys(groupedFiles).length > 0 && (
        <Box mt={2}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Версии файлов:
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {Object.entries(groupedFiles).map(([name, versions]) => (
              <Chip
                key={name}
                label={`${name} (${versions.length} версий)`}
                variant="outlined"
                size="small"
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* Preview Dialog */}
      <Dialog
        open={!!previewUrl}
        onClose={() => setPreviewUrl(null)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          {previewName}
        </DialogTitle>
        <DialogContent>
          {previewUrl && (
            previewUrl.includes('.pdf') || previewName.endsWith('.pdf')
              ? (
                <Box
                  component="iframe"
                  src={previewUrl}
                  sx={{ width: '100%', height: '70vh', border: 'none' }}
                />
              )
              : (
                <Box
                  component="img"
                  src={previewUrl}
                  alt={previewName}
                  sx={{ width: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                />
              )
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewUrl(null)}>Закрыть</Button>
          <Button
            component="a"
            href={previewUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть в новой вкладке
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProjectFilesTab;
