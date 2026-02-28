/**
 * PDF-to-PNG Conversion Service (Frontend)
 * Uses pdfjs-dist to render PDF pages to Canvas → PNG blobs.
 * Runs entirely in the browser — no backend dependency needed.
 */
import * as pdfjsLib from 'pdfjs-dist';

// Use local worker file copied from node_modules/pdfjs-dist/build/
// This avoids CDN version mismatches (v5.4.624 not available on cdnjs)
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export interface PdfPageImage {
    pageIndex: number;
    blob: Blob;
    width: number;
    height: number;
    dataUrl: string; // For local preview (thumbnail quality)
}

/**
 * Convert a PDF file to an array of PNG page images.
 * @param file - The PDF file
 * @param scale - Render scale (1.0 = 72dpi, 2.0 = 144dpi for quality)
 * @param onProgress - Callback for progress updates
 * @returns Array of PdfPageImage objects
 */
export async function convertPdfToImages(
    file: File,
    scale: number = 1.5,
    onProgress?: (current: number, total: number) => void
): Promise<PdfPageImage[]> {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;
    const pages: PdfPageImage[] = [];

    for (let i = 1; i <= totalPages; i++) {
        try {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale });

            // Create offscreen canvas for full resolution
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d')!;

            await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

            // Full-resolution blob for AI analysis
            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (b) => b ? resolve(b) : reject(new Error('Canvas toBlob failed')),
                    'image/png'
                );
            });

            // Higher-res thumbnail data URL for preview (blueprints need detail)
            const thumbCanvas = document.createElement('canvas');
            const thumbScale = Math.min(1, 800 / viewport.width); // Max 800px wide for readability
            thumbCanvas.width = Math.round(viewport.width * thumbScale);
            thumbCanvas.height = Math.round(viewport.height * thumbScale);
            const thumbCtx = thumbCanvas.getContext('2d')!;
            thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
            const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.85); // Higher quality for blueprint readability

            pages.push({
                pageIndex: i - 1,
                blob,
                width: viewport.width,
                height: viewport.height,
                dataUrl,
            });

            // Free memory immediately
            canvas.width = 0;
            canvas.height = 0;
            thumbCanvas.width = 0;
            thumbCanvas.height = 0;
            page.cleanup();
        } catch (pageErr: any) {
            console.error(`Failed to render page ${i} of ${file.name}:`, pageErr);
            // Skip failed pages but continue
        }

        onProgress?.(i, totalPages);
    }

    return pages;
}

/**
 * Read a File as a data URL string for image preview.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsDataURL(file);
    });
}

/**
 * Download a page blob as a PNG file.
 */
export function downloadPageAsPng(blob: Blob, fileName: string, pageIndex: number): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/\.pdf$/i, '')}_page_${pageIndex + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Download all page blobs as individual PNGs (sequential with delay to avoid browser blocking).
 */
export function downloadAllPagesAsPng(pages: PdfPageImage[], fileName: string): void {
    pages.forEach((page, i) => {
        setTimeout(() => downloadPageAsPng(page.blob, fileName, page.pageIndex), i * 200);
    });
}
