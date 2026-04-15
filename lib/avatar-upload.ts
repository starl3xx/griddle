/**
 * Client-side avatar upload helper. Takes a File from a file input,
 * decodes + center-crops + resizes to 512×512 JPEG (0.85 quality),
 * then POSTs the result to /api/profile/avatar and returns the
 * resulting public URL.
 *
 * EXIF orientation: iPhone photos arrive with orientation metadata
 * that determines which way is up. `createImageBitmap` with
 * `imageOrientation: 'from-image'` applies the rotation during decode,
 * so the canvas sees an already-correctly-oriented image and we don't
 * have to pull in an exif library. Well supported across modern
 * browsers (Chrome, Safari 15+, Firefox). Older browsers fall back to
 * the browser's default handling — which means a sideways iPhone
 * photo, which is acceptable for v1.
 *
 * We resize BEFORE upload to keep the request under ~100KB and so the
 * server doesn't have to run sharp or similar. Also means a user on
 * cellular isn't waiting on a 5MB upload.
 */

export interface AvatarUploadOptions {
  /** Output side length in px. Default 512. */
  size?: number;
  /** JPEG quality 0-1. Default 0.85. */
  quality?: number;
}

export async function uploadAvatar(
  file: File,
  opts: AvatarUploadOptions = {},
): Promise<string> {
  const size = opts.size ?? 512;
  const quality = opts.quality ?? 0.85;

  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }
  // 10 MB pre-resize cap — the server enforces 5MB post-resize, but
  // we want to reject ridiculous originals upfront (before the canvas
  // has to decode them) so the user gets an immediate error instead of
  // a long delay followed by a server-side rejection.
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image is too large. Please choose a file under 10MB.');
  }

  // Decode with EXIF-aware orientation. `createImageBitmap` is ~10x
  // faster than `new Image()` + `img.decode()` on large photos and
  // doesn't require an intermediate data URL.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Could not decode image: ${err.message}`
        : 'Could not decode image.',
    );
  }

  // Center-crop to square, then scale to `size`. The source crop box
  // picks the shorter dimension so we don't upscale empty space.
  const srcSide = Math.min(bitmap.width, bitmap.height);
  const srcX = (bitmap.width - srcSide) / 2;
  const srcY = (bitmap.height - srcSide) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported in this browser.');
  ctx.drawImage(bitmap, srcX, srcY, srcSide, srcSide, 0, 0, size, size);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
  if (!blob) throw new Error('Could not encode image.');

  const form = new FormData();
  // Name the uploaded part so the server-side check (`instanceof File`)
  // passes. Browsers turn a Blob into a File-like when it's appended
  // with a filename, but we pass it as a real File to be explicit.
  const uploadFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
  form.append('file', uploadFile);

  const res = await fetch('/api/profile/avatar', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? `Upload failed (${res.status})`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error('Upload returned no URL.');
  return data.url;
}
