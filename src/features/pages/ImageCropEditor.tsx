import { useEffect, useRef, useState } from "react";
import { FeatureDialog } from "../../components/FeatureDialog";
import {
  processImageCrop,
  type CropOptions,
  type ImageCropResult,
  type ImageBounds,
} from "./image-crop";
import { moveCrop, type CropHandle } from "./crop-geometry";

export function useImageUrl(file?: File): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const value = URL.createObjectURL(file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  // Only browser-owned blob references may reach image attributes. Encode URI metacharacters.
  return url.startsWith("blob:") ? encodeURI(url) : "";
}

const handles: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w", "move"];
const handleNames = {
  nw: "top left",
  n: "top",
  ne: "top right",
  e: "right",
  se: "bottom right",
  s: "bottom",
  sw: "bottom left",
  w: "left",
  move: "move rectangle",
};

export function ImageCropEditor({
  file,
  initialOptions,
  onApply,
  onClose,
}: Readonly<{
  file: File;
  initialOptions?: CropOptions;
  onApply: (result: ImageCropResult, options: CropOptions) => void;
  onClose: () => void;
}>) {
  const [options, setOptions] = useState<CropOptions>(
    initialOptions ?? { tolerance: 24, padding: 0, angle: 0, cleanup: 0 },
  );
  const [result, setResult] = useState<ImageCropResult | null>(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: CropHandle; x: number; y: number; bounds: ImageBounds } | null>(
    null,
  );
  const before = useImageUrl(result?.beforeFile ?? file),
    after = useImageUrl(result?.file);
  const original = useImageUrl(file);
  useEffect(() => {
    let cancelled = false;
    setRunning(true);
    setError("");
    const timer = setTimeout(() => {
      queue.current = queue.current.then(async () => {
        if (cancelled) return;
        try {
          const next = await processImageCrop(file, options, true);
          if (!cancelled) setResult(next);
        } catch (error_) {
          if (!cancelled)
            setError(error_ instanceof Error ? error_.message : "Image preview failed.");
        } finally {
          if (!cancelled) setRunning(false);
        }
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [file, options]);

  const bounds = options.bounds ?? result?.bounds;
  const updateBounds = (next: ImageBounds) =>
    setOptions((current) => ({ ...current, bounds: next }));
  const autoOption = (key: keyof CropOptions, value: number) =>
    setOptions((current) => ({ ...current, [key]: value, bounds: undefined }));
  return (
    <FeatureDialog title="Adjust image crop" onClose={onClose}>
      <div className="modal-dialog image-crop-dialog">
        <div className="modal-header">
          <h3>Adjust image crop</h3>
          <button className="icon-button" aria-label="Close image crop" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <p>
            Drag crop handles or use arrow keys (Shift for 10 pixels). Scan adjustments are
            previewed on a copy.
          </p>
          <div className="crop-adjustments">
            <label>
              Sensitivity{" "}
              <input
                type="range"
                min="0"
                max="100"
                value={options.tolerance ?? 24}
                onChange={(event) => autoOption("tolerance", Number(event.target.value))}
              />
              <output>{options.tolerance ?? 24}</output>
            </label>
            <label>
              Padding (pixels){" "}
              <input
                className="text-input"
                type="number"
                min="0"
                max="1000"
                value={options.padding ?? 0}
                onChange={(event) => autoOption("padding", Number(event.target.value))}
              />
            </label>
            <label>
              Straighten (degrees){" "}
              <input
                className="text-input"
                type="number"
                min="-15"
                max="15"
                step="0.1"
                value={options.angle ?? 0}
                onChange={(event) => autoOption("angle", Number(event.target.value))}
              />
            </label>
            <label>
              Background cleanup{" "}
              <input
                type="range"
                min="0"
                max="100"
                value={options.cleanup ?? 0}
                onChange={(event) => autoOption("cleanup", Number(event.target.value))}
              />
              <output>{options.cleanup ?? 0}</output>
            </label>
          </div>
          <p className="field-hint">
            Higher sensitivity trims more color variation. Cleanup can fade light markings; inspect
            the original and result carefully.
          </p>
          {result && bounds && (
            <>
              <div className="crop-adjustments">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}>
                    Crop {key}
                    <input
                      className="text-input"
                      type="number"
                      min={key === "x" || key === "y" ? 0 : 1}
                      value={bounds[key]}
                      onChange={(event) =>
                        updateBounds({ ...bounds, [key]: Number(event.target.value) })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="crop-comparison">
                <figure>
                  <figcaption>
                    Before crop{options.angle || options.cleanup ? " (adjusted scan)" : ""}
                  </figcaption>
                  <div
                    ref={surface}
                    className="crop-image-surface"
                    style={{
                      width: `min(100%, ${(38 * result.originalWidth) / result.originalHeight}vh)`,
                    }}
                    onPointerMove={(event) => {
                      const active = drag.current,
                        box = surface.current?.getBoundingClientRect();
                      if (!active || !box?.width || !box.height) return;
                      updateBounds(
                        moveCrop(
                          active.bounds,
                          active.handle,
                          ((event.clientX - active.x) * result.originalWidth) / box.width,
                          ((event.clientY - active.y) * result.originalHeight) / box.height,
                          result.originalWidth,
                          result.originalHeight,
                        ),
                      );
                    }}
                    onPointerUp={() => {
                      drag.current = null;
                    }}
                    onPointerCancel={() => {
                      drag.current = null;
                    }}
                  >
                    <img src={before} alt="Before crop" draggable={false} />
                    <div
                      className="crop-outline"
                      style={{
                        left: `${(bounds.x / result.originalWidth) * 100}%`,
                        top: `${(bounds.y / result.originalHeight) * 100}%`,
                        width: `${(bounds.width / result.originalWidth) * 100}%`,
                        height: `${(bounds.height / result.originalHeight) * 100}%`,
                      }}
                    >
                      {handles.map((handle) => (
                        <button
                          key={handle}
                          type="button"
                          className={`crop-handle crop-handle-${handle}`}
                          aria-label={`Crop ${handleNames[handle]}`}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.currentTarget.focus();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            drag.current = { handle, x: event.clientX, y: event.clientY, bounds };
                          }}
                          onKeyDown={(event) => {
                            const vectors: Record<string, [number, number]> = {
                              ArrowLeft: [-1, 0],
                              ArrowRight: [1, 0],
                              ArrowUp: [0, -1],
                              ArrowDown: [0, 1],
                            };
                            const vector = vectors[event.key];
                            if (!vector) return;
                            event.preventDefault();
                            const step = event.shiftKey ? 10 : 1;
                            updateBounds(
                              moveCrop(
                                bounds,
                                handle,
                                vector[0] * step,
                                vector[1] * step,
                                result.originalWidth,
                                result.originalHeight,
                              ),
                            );
                          }}
                        >
                          {handle === "move" ? "Move" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                </figure>
                <figure>
                  <figcaption>After crop</figcaption>
                  {after && <img src={after} alt="After crop" />}
                </figure>
              </div>
              {(!!options.angle || !!options.cleanup) && (
                <details>
                  <summary>Unmodified original</summary>
                  <img className="image-crop-preview" src={original} alt="Unmodified original" />
                </details>
              )}
              <output aria-live="polite">
                {running
                  ? "Updating preview..."
                  : `${result.originalWidth} × ${result.originalHeight} → ${result.bounds.width} × ${result.bounds.height} pixels`}
              </output>
            </>
          )}
          {!result && running && <output>Preparing image preview...</output>}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button
            className="button-secondary"
            onClick={() => setOptions({ tolerance: 24, padding: 0, angle: 0, cleanup: 0 })}
          >
            Reset adjustments
          </button>
          <button className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button-primary"
            disabled={running || !!error || !result}
            onClick={() => {
              if (result) onApply(result, options);
            }}
          >
            Use this image
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}
