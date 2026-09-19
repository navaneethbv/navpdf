import type { ChangeEvent, InputHTMLAttributes } from "react";

export interface PageNumberInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "max" | "min" | "onChange" | "type" | "value"
> {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
}

function clampPage(value: number, min: number, max: number): number {
  const safeMin = Math.ceil(Number.isFinite(min) ? min : 1);
  const safeMax = Math.floor(Number.isFinite(max) ? Math.max(safeMin, max) : safeMin);
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : safeMin;
  return Math.max(safeMin, Math.min(safeValue, safeMax));
}

export function PageNumberInput({
  value,
  min = 1,
  max,
  onChange,
  ...props
}: Readonly<PageNumberInputProps>) {
  const safeValue = clampPage(value, min, max);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value.trim();
    if (!rawValue) {
      onChange(safeValue);
      return;
    }

    const parsed = Number(rawValue);
    onChange(Number.isFinite(parsed) ? clampPage(parsed, min, max) : safeValue);
  };

  return (
    <input {...props} type="number" min={min} max={max} value={safeValue} onChange={handleChange} />
  );
}
