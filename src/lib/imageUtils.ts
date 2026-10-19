/**
 * Utility functions for client-side image compression and avatar preparation.
 * Resizes and square-crops avatar photos before uploading to keep them fast,
 * crisp, and lightweight (typically 30–70 KB).
 */

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Resizes and center-crops an image file into a square avatar data URL (JPEG).
 * @param file The original image file (JPEG, PNG, WebP)
 * @param targetSize Max width/height in pixels (default 400px)
 * @param quality JPEG quality between 0.1 and 1.0 (default 0.85)
 */
export async function compressAvatar(
  file: File,
  targetSize = 400,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please select an image file (JPEG, PNG, or WebP).'));
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const srcWidth = img.naturalWidth || img.width;
      const srcHeight = img.naturalHeight || img.height;

      if (!srcWidth || !srcHeight) {
        reject(new Error('Unable to read image dimensions.'));
        return;
      }

      // Calculate center crop to make it a perfect square
      const minDim = Math.min(srcWidth, srcHeight);
      const cropX = (srcWidth - minDim) / 2;
      const cropY = (srcHeight - minDim) / 2;

      const destSize = Math.min(targetSize, minDim);

      const canvas = document.createElement('canvas');
      canvas.width = destSize;
      canvas.height = destSize;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available.'));
        return;
      }

      // High quality smoothing
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Draw center-cropped square
      ctx.drawImage(
        img,
        cropX,
        cropY,
        minDim,
        minDim,
        0,
        0,
        destSize,
        destSize
      );

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image. The file may be corrupted.'));
    };

    img.src = objectUrl;
  });
}
