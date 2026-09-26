import { imageHeader } from "./image-import";

export type ImageBounds = { x: number; y: number; width: number; height: number };
export type Pixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
export interface CropOptions {
  tolerance?: number;
  padding?: number;
  bounds?: ImageBounds;
  angle?: number;
  cleanup?: number;
}
export interface ImageCropResult {
  file: File;
  beforeFile?: File;
  bounds: ImageBounds;
  originalWidth: number;
  originalHeight: number;
}

// Compare displayed colors, treating transparent pixels as white paper.
function colorAt(data: Pixels["data"], index: number): number[] {
  const alpha = data[index + 3] / 255;
  return [0, 1, 2].map((channel) => data[index + channel] * alpha + 255 * (1 - alpha));
}

function isContentPixel(
  data: Pixels["data"],
  index: number,
  background: number[],
  tolerance: number,
): boolean {
  const alpha = data[index + 3] / 255;
  for (let channel = 0; channel < 3; channel++) {
    const value = data[index + channel] * alpha + 255 * (1 - alpha);
    if (Math.abs(value - background[channel]) > tolerance) return true;
  }
  return false;
}

/** Conservative rectangular trim: every pixel unlike the border is retained. */
export function detectImageBounds(
  { width, height, data }: Pixels,
  tolerance = 24,
): ImageBounds | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 32 * 1024 * 1024 ||
    data.length !== width * height * 4
  )
    throw new Error("Invalid image pixels.");
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100)
    throw new Error("Sensitivity must be between 0 and 100.");
  const corners = [0, width - 1, (height - 1) * width, width * height - 1].map((index) =>
    colorAt(data, index * 4),
  );
  const background = [0, 1, 2].map(
    (channel) => corners.reduce((sum, color) => sum + color[channel], 0) / 4,
  );
  if (
    corners.some((color) =>
      color.some((value, channel) => Math.abs(value - background[channel]) > tolerance),
    )
  )
    return null;

  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const content = isContentPixel(data, index, background, tolerance);
      if (content) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left || (left === 0 && top === 0 && right === width - 1 && bottom === height - 1))
    return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function paddedBounds(
  bounds: ImageBounds,
  padding: number,
  width: number,
  height: number,
): ImageBounds {
  if (!Number.isInteger(padding) || padding < 0 || padding > 1000)
    throw new Error("Padding must be between 0 and 1,000 pixels.");
  const x = Math.max(0, bounds.x - padding),
    y = Math.max(0, bounds.y - padding);
  return {
    x,
    y,
    width: Math.min(width, bounds.x + bounds.width + padding) - x,
    height: Math.min(height, bounds.y + bounds.height + padding) - y,
  };
}

export function validateBounds(bounds: ImageBounds, width: number, height: number): void {
  if (
    !Object.values(bounds).every(Number.isInteger) ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.width < 1 ||
    bounds.height < 1 ||
    bounds.x + bounds.width > width ||
    bounds.y + bounds.height > height
  )
    throw new Error("The crop rectangle must be inside the image.");
}

export function cleanScanPixels(data: Uint8ClampedArray, strength: number): void {
  if (!Number.isFinite(strength) || strength < 0 || strength > 100)
    throw new Error("Cleanup must be between 0 and 100.");
  const white = 255 - strength * 0.7;
  for (let i = 0; i < data.length; i += 4)
    for (let channel = 0; channel < 3; channel++)
      data[i + channel] = Math.min(255, (data[i + channel] * 255) / white);
}

async function encodeCanvas(canvas: HTMLCanvasElement, filename: string): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Could not encode the cropped image.")),
      "image/png",
    ),
  );
  if (blob.size > 25 * 1024 * 1024)
    throw new Error("Cropped image exceeds the 25 MB import limit.");
  return new File([blob], filename.replace(/\.(png|jpe?g)$/i, "") + "-cropped.png", {
    type: "image/png",
  });
}

function validateCropOptions(options: CropOptions): void {
  for (const [label, value, maximum] of [
    ["Sensitivity", options.tolerance ?? 24, 100],
    ["Cleanup", options.cleanup ?? 0, 100],
    ["Padding", options.padding ?? 0, 1000],
  ] as const) {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > maximum ||
      (label === "Padding" && !Number.isInteger(value))
    )
      throw new Error(`${label} is outside its supported range.`);
  }
}

export async function processImageCrop(
  file: File,
  options: CropOptions = {},
  keepFullImage = false,
): Promise<ImageCropResult | null> {
  validateCropOptions(options);
  if (file.size > 25 * 1024 * 1024) throw new Error("Each image must be 25 MB or smaller.");
  imageHeader(new Uint8Array(await file.arrayBuffer()));
  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  const output = document.createElement("canvas");
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height || width > 16384 || height > 16384 || width * height > 32 * 1024 * 1024)
      throw new Error("Images must be at most 32 megapixels and 16,384 pixels per edge.");
    const angle = options.angle ?? 0,
      cleanup = options.cleanup ?? 0;
    if (!Number.isFinite(angle) || Math.abs(angle) > 15)
      throw new Error("Straightening must be between -15 and 15 degrees.");
    const radians = (angle * Math.PI) / 180;
    const rotatedWidth = Math.ceil(
      Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)),
    );
    const rotatedHeight = Math.ceil(
      Math.abs(height * Math.cos(radians)) + Math.abs(width * Math.sin(radians)),
    );
    if (
      rotatedWidth > 16384 ||
      rotatedHeight > 16384 ||
      rotatedWidth * rotatedHeight > 32 * 1024 * 1024
    )
      throw new Error("The straightened image exceeds the pixel limit.");
    canvas.width = rotatedWidth;
    canvas.height = rotatedHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Image cropping is unavailable.");
    if (angle) {
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(radians);
      context.drawImage(image, -width / 2, -height / 2);
      context.setTransform(1, 0, 0, 1, 0, 0);
    } else context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    if (cleanup) {
      cleanScanPixels(pixels.data, cleanup);
      context.putImageData(pixels, 0, 0);
    }
    const detected = options.bounds ?? detectImageBounds(pixels, options.tolerance ?? 24);
    if (!detected && !keepFullImage && !angle && !cleanup) return null;
    const bounds =
      options.bounds ??
      paddedBounds(
        detected ?? { x: 0, y: 0, width: canvas.width, height: canvas.height },
        options.padding ?? 0,
        canvas.width,
        canvas.height,
      );
    validateBounds(bounds, canvas.width, canvas.height);
    output.width = bounds.width;
    output.height = bounds.height;
    const cropped = output.getContext("2d");
    if (!cropped) throw new Error("Image cropping is unavailable.");
    cropped.drawImage(
      canvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height,
    );
    return {
      file: await encodeCanvas(output, file.name),
      beforeFile: angle || cleanup ? await encodeCanvas(canvas, file.name) : file,
      bounds,
      originalWidth: canvas.width,
      originalHeight: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = output.width = output.height = 0;
  }
}

export async function trimImageMargins(
  file: File,
  options: CropOptions = {},
): Promise<ImageCropResult | null> {
  return processImageCrop(file, options);
}
