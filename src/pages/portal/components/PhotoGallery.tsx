import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Paper,
  Chip,
  Dialog,
  IconButton,
  ImageList,
  ImageListItem,
  ImageListItemBar,
} from '@mui/material';
import {
  PhotoLibrary as PhotoIcon,
  Build as BuildIcon,
  Close as CloseIcon,
  ChevronLeft as PrevIcon,
  ChevronRight as NextIcon,
} from '@mui/icons-material';

export interface GalleryPhoto {
  id: string;
  url: string;
  title: string;
  date: string;
  category: 'render' | 'progress' | 'before';
}

interface PhotoGalleryProps {
  photos: GalleryPhoto[];
  designerName?: string;
  expectedDesignDate?: string;
}

const PhotoGallery: React.FC<PhotoGalleryProps> = ({
  photos,
  designerName = 'Designer',
  expectedDesignDate = 'TBD',
}) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const renders = photos.filter(p => p.category === 'render');
  const progressPhotos = photos.filter(p => p.category === 'progress');
  const beforePhotos = photos.filter(p => p.category === 'before');

  const allPhotos = [...renders, ...progressPhotos, ...beforePhotos];

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const hasPhotos = allPhotos.length > 0;

  return (
    <Card elevation={2} sx={{ borderRadius: 2 }}>
      <CardContent>
        <Typography variant="h5" gutterBottom fontWeight="bold">
          Project Gallery
        </Typography>

        {hasPhotos ? (
          <>
            {renders.length > 0 && (
              <Box mb={3}>
                <Typography variant="h6" gutterBottom color="success.dark">
                  Design Renders
                </Typography>
                <ImageList cols={window.innerWidth > 600 ? 3 : 2} gap={12}>
                  {renders.map((photo, idx) => (
                    <ImageListItem
                      key={photo.id}
                      sx={{ cursor: 'pointer', borderRadius: 1, overflow: 'hidden' }}
                      onClick={() => openLightbox(idx)}
                    >
                      <img src={photo.url} alt={photo.title} loading="lazy" />
                      <ImageListItemBar
                        title={photo.title}
                        subtitle={photo.date}
                      />
                    </ImageListItem>
                  ))}
                </ImageList>
              </Box>
            )}

            {progressPhotos.length > 0 && (
              <Box mb={3}>
                <Typography variant="h6" gutterBottom color="primary">
                  Progress Photos
                </Typography>
                <ImageList cols={window.innerWidth > 600 ? 3 : 2} gap={12}>
                  {progressPhotos.map((photo, idx) => (
                    <ImageListItem
                      key={photo.id}
                      sx={{ cursor: 'pointer', borderRadius: 1, overflow: 'hidden' }}
                      onClick={() => openLightbox(renders.length + idx)}
                    >
                      <img src={photo.url} alt={photo.title} loading="lazy" />
                      <ImageListItemBar
                        title={photo.title}
                        subtitle={photo.date}
                      />
                    </ImageListItem>
                  ))}
                </ImageList>
              </Box>
            )}

            {beforePhotos.length > 0 && (
              <Box mb={3}>
                <Typography variant="h6" gutterBottom color="text.secondary">
                  Before
                </Typography>
                <ImageList cols={window.innerWidth > 600 ? 3 : 2} gap={12}>
                  {beforePhotos.map((photo, idx) => (
                    <ImageListItem
                      key={photo.id}
                      sx={{ cursor: 'pointer', borderRadius: 1, overflow: 'hidden' }}
                      onClick={() => openLightbox(renders.length + progressPhotos.length + idx)}
                    >
                      <img src={photo.url} alt={photo.title} loading="lazy" />
                      <ImageListItemBar
                        title={photo.title}
                        subtitle={photo.date}
                      />
                    </ImageListItem>
                  ))}
                </ImageList>
              </Box>
            )}

            {/* Lightbox Dialog */}
            <Dialog
              open={lightboxOpen}
              onClose={() => setLightboxOpen(false)}
              maxWidth="lg"
              fullWidth
            >
              <Box sx={{ position: 'relative', backgroundColor: '#000', textAlign: 'center' }}>
                <IconButton
                  onClick={() => setLightboxOpen(false)}
                  sx={{ position: 'absolute', top: 8, right: 8, color: '#fff', zIndex: 1 }}
                >
                  <CloseIcon />
                </IconButton>
                {allPhotos[lightboxIndex] && (
                  <>
                    <img
                      src={allPhotos[lightboxIndex].url}
                      alt={allPhotos[lightboxIndex].title}
                      style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
                    />
                    <Box sx={{ p: 2, color: '#fff' }}>
                      <Typography variant="h6">{allPhotos[lightboxIndex].title}</Typography>
                      <Typography variant="body2">{allPhotos[lightboxIndex].date}</Typography>
                    </Box>
                  </>
                )}
                <Box sx={{ position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)' }}>
                  <IconButton
                    onClick={() => setLightboxIndex(prev => Math.max(0, prev - 1))}
                    disabled={lightboxIndex === 0}
                    sx={{ color: '#fff' }}
                  >
                    <PrevIcon fontSize="large" />
                  </IconButton>
                </Box>
                <Box sx={{ position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)' }}>
                  <IconButton
                    onClick={() => setLightboxIndex(prev => Math.min(allPhotos.length - 1, prev + 1))}
                    disabled={lightboxIndex === allPhotos.length - 1}
                    sx={{ color: '#fff' }}
                  >
                    <NextIcon fontSize="large" />
                  </IconButton>
                </Box>
              </Box>
            </Dialog>
          </>
        ) : (
          /* Placeholder when no photos uploaded yet */
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Paper elevation={1} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ p: 3, backgroundColor: '#2e7d32', color: 'white' }}>
                  <Typography variant="h6" gutterBottom>
                    Design Renders
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Future vision of your space
                  </Typography>
                </Box>
                <Box sx={{ p: 3, textAlign: 'center', minHeight: 180 }}>
                  <PhotoIcon sx={{ fontSize: 48, color: '#bbb', mb: 2 }} />
                  <Typography variant="body2" color="text.secondary">
                    3D renders and design plans will appear here once {designerName} completes the floor plan
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                    Expected: {expectedDesignDate}
                  </Typography>
                </Box>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Paper elevation={1} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ p: 3, backgroundColor: '#1976d2', color: 'white' }}>
                  <Typography variant="h6" gutterBottom>
                    Progress Photos
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Before, during & after
                  </Typography>
                </Box>
                <Box sx={{ p: 3, textAlign: 'center', minHeight: 180 }}>
                  <BuildIcon sx={{ fontSize: 48, color: '#bbb', mb: 2 }} />
                  <Typography variant="body2" color="text.secondary">
                    Construction progress photos will be uploaded daily during work
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                    Photo updates start with demo phase
                  </Typography>
                </Box>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Paper elevation={1} sx={{ borderRadius: 2, p: 3 }}>
                <Typography variant="h6" gutterBottom color="primary">
                  Virtual Walkthrough
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Once work begins, we'll create 360° virtual tours so you can see the transformation from anywhere.
                </Typography>
                <Chip label="Coming Soon" color="primary" variant="outlined" size="small" />
              </Paper>
            </Grid>
          </Grid>
        )}
      </CardContent>
    </Card>
  );
};

export default PhotoGallery;
