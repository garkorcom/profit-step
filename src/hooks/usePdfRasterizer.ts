import { useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { RenderParameters } from 'pdfjs-dist/types/src/display/api';

// Since we are using pdfjs in a React app, we need to set the workerSrc.
// We use the unpkg CDN for convenience to avoid webpack complex worker configurations.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface RasterizedImage {
    id: string;
    originalFileName: string;
    pageNumber: number;
    blob?: Blob;
    dataUrl: string;
    storageUrl?: string;
    width?: number;
    height?: number;
    dimensions?: { width: number; height: number };
    selected: boolean; // For the UI to allow excluding certain pages
}

export const usePdfRasterizer = () => {
    const [isRasterizing, setIsRasterizing] = useState(false);
    const [progress, setProgress] = useState(0); // 0 to 100
    const [statusText, setStatusText] = useState('');

    const rasterizeFiles = useCallback(async (files: File[], dpi: number = 200): Promise<RasterizedImage[]> => {
        setIsRasterizing(true);
        setProgress(0);
        setStatusText('Starting rasterization...');

        const resultImages: RasterizedImage[] = [];
        let totalProcessed = 0;
        
        // Count total PDFs vs Images for progress
        const pdfFiles = files.filter(f => f.type === 'application/pdf');
        const imgFiles = files.filter(f => f.type.startsWith('image/'));
        
        // Let's assume on average a PDF has 3 pages just for rough initial progress estimation.
        // We will refine progress as we parse the PDFs.
        let totalPagesEstimated = imgFiles.length + (pdfFiles.length * 3);

        const scale = dpi / 72; // PDF standard space is 72 DPI

        for (const file of files) {
            setStatusText(`Processing ${file.name}...`);
            
            if (file.type.startsWith('image/')) {
                // It's already an image, just convert to RasterizedImage
                const dataUrl = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result as string);
                    reader.readAsDataURL(file);
                });

                // Get dimensions
                const img = new Image();
                await new Promise((resolve) => {
                    img.onload = resolve;
                    img.src = dataUrl;
                });

                resultImages.push({
                    id: crypto.randomUUID(),
                    originalFileName: file.name,
                    pageNumber: 1,
                    blob: file,
                    dataUrl,
                    width: img.width,
                    height: img.height,
                    selected: true
                });
                
                totalProcessed++;
                setProgress(Math.round((totalProcessed / totalPagesEstimated) * 100));
            } else if (file.type === 'application/pdf') {
                // Rasterize PDF
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const pdfDocument = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    
                    const numPages = pdfDocument.numPages;
                    // Adjust total pages estimation
                    totalPagesEstimated += (numPages - 3); 

                    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                        setStatusText(`Rasterizing ${file.name} (Page ${pageNum}/${numPages})...`);
                        
                        const page = await pdfDocument.getPage(pageNum);
                        const viewport = page.getViewport({ scale });

                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        
                        if (!context) throw new Error("Could not create 2D context");

                        canvas.width = viewport.width;
                        canvas.height = viewport.height;

                        const renderContext: RenderParameters = {
                            canvasContext: context,
                            viewport: viewport,
                            canvas,
                        };

                        await page.render(renderContext).promise;

                        // Create Blob
                        const blob = await new Promise<Blob | null>((resolve) => {
                            canvas.toBlob((b) => resolve(b), 'image/png');
                        });

                        if (!blob) throw new Error("Could not create Blob from canvas");

                        // Create Data URL for rendering
                        const dataUrl = canvas.toDataURL('image/png');

                        resultImages.push({
                            id: crypto.randomUUID(),
                            originalFileName: file.name,
                            pageNumber: pageNum,
                            blob: blob,
                            dataUrl,
                            width: canvas.width,
                            height: canvas.height,
                            selected: true
                        });

                        totalProcessed++;
                        setProgress(Math.round((totalProcessed / totalPagesEstimated) * 100));
                    }
                } catch (error) {
                    console.error(`Failed to rasterize PDF ${file.name}:`, error);
                }
            }
        }

        setProgress(100);
        setStatusText('Rasterization complete!');
        setIsRasterizing(false);
        return resultImages;
    }, []);

    return {
        isRasterizing,
        progress,
        statusText,
        rasterizeFiles
    };
};
