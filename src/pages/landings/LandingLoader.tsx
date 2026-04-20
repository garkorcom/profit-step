import React, { Suspense, useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';

// Glob all indexes inside landings/ideas
// The record returns a function that dynamically imports the module
const landingModules = import.meta.glob('/landings/ideas/*/build/index.tsx');

export default function LandingLoader() {
  const { ideaName } = useParams<{ ideaName: string }>();
  const [LandingComponent, setLandingComponent] = useState<React.ComponentType<any> | null>(null);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (!ideaName) {
      setError(true);
      return;
    }

    // Construct the expected file path based on the glob format
    const expectedPath = `/landings/ideas/${ideaName}/build/index.tsx`;
    
    const importFn = landingModules[expectedPath];

    if (!importFn) {
      console.error(`Лендинг ${ideaName} не найден по пути ${expectedPath}`);
      setError(true);
      return;
    }

    importFn()
      .then((module: any) => {
        // Assume default export is the actual React component
        if (module && module.default) {
          setLandingComponent(() => module.default);
          
          // Apply SEO & Meta Tags from the exported metadata
          if (module.metadata) {
            if (module.metadata.title) {
              document.title = module.metadata.title;
            }
            if (module.metadata.description) {
              let metaDescription = document.querySelector('meta[name="description"]');
              if (metaDescription) {
                metaDescription.setAttribute('content', module.metadata.description);
              } else {
                const meta = document.createElement('meta');
                meta.name = 'description';
                meta.content = module.metadata.description;
                document.head.appendChild(meta);
              }
            }
          }
        } else {
          setError(true);
        }
      })
      .catch((err) => {
        console.error("Ошибка при импорте лендинга", err);
        setError(true);
      });
  }, [ideaName]);

  if (error) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', mt: 10 }}>
        <Typography variant="h4" color="error" mb={2}>404 - Лендинг не найден</Typography>
        <Typography>Проверьте URL или убедитесь, что проект опубликован.</Typography>
      </Box>
    );
  }

  if (!LandingComponent) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Suspense fallback={<CircularProgress />}>
      <LandingComponent />
    </Suspense>
  );
}
