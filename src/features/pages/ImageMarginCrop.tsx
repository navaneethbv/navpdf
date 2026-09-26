import { useEffect, useRef, useState } from "react";
import { trimImageMargins } from "./image-crop";
import type { CropOptions } from "./image-crop";
import { ImageCropEditor } from "./ImageCropEditor";

export function ImageMarginCrop({
  file,
  croppedFile,
  disabled,
  onChange,
  onBusy,
}: Readonly<{
  file: File;
  croppedFile?: File;
  disabled: boolean;
  onChange: (file?: File) => void;
  onBusy: (busy: boolean) => void;
}>) {
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [editing, setEditing] = useState(false);
  const [cropOptions, setCropOptions] = useState<CropOptions>();
  const ownCrop = useRef<File | undefined>(croppedFile);
  useEffect(() => {
    if (ownCrop.current !== croppedFile) {
      setCropOptions(undefined);
      setMessage("");
    }
    ownCrop.current = croppedFile;
  }, [croppedFile]);
  useEffect(() => {
    if (!croppedFile) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(croppedFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [croppedFile]);

  const trim = async () => {
    onBusy(true);
    setMessage("Detecting image margins...");
    try {
      const result = await trimImageMargins(file);
      if (result) {
        ownCrop.current = result.file;
        onChange(result.file);
        setMessage(
          `${result.originalWidth} × ${result.originalHeight} → ${result.bounds.width} × ${result.bounds.height} pixels. Crop will be used when importing.`,
        );
      } else setMessage("No consistent outer margin found. Original image retained.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not crop this image.");
    } finally {
      onBusy(false);
    }
  };

  return (
    <div className="image-margin-crop">
      <button
        type="button"
        className="button-secondary"
        disabled={disabled}
        aria-label={`${croppedFile ? "Reset crop" : "Trim image margins"} for ${file.name}`}
        onClick={() => {
          if (croppedFile) {
            ownCrop.current = undefined;
            onChange();
            setCropOptions(undefined);
            setMessage("Original image restored.");
          } else void trim();
        }}
      >
        {croppedFile ? "Reset crop" : "Trim image margins"}
      </button>
      <button
        type="button"
        className="button-secondary"
        disabled={disabled}
        onClick={() => {
          setEditing(true);
          onBusy(true);
        }}
      >
        Adjust crop &amp; clean scan
      </button>
      <small>
        Trims uniform borders. Review the preview before importing. Your source stays unchanged.
      </small>
      {preview && (
        <img className="image-crop-preview" src={preview} alt={`Cropped preview of ${file.name}`} />
      )}
      <output aria-live="polite">{message}</output>
      {editing && (
        <ImageCropEditor
          file={file}
          initialOptions={cropOptions}
          onClose={() => {
            setEditing(false);
            onBusy(false);
          }}
          onApply={(result, options) => {
            ownCrop.current = result.file;
            onChange(result.file);
            setCropOptions({ ...options, bounds: result.bounds });
            setMessage(`Adjusted image: ${result.bounds.width} × ${result.bounds.height} pixels.`);
            setEditing(false);
            onBusy(false);
          }}
        />
      )}
    </div>
  );
}
