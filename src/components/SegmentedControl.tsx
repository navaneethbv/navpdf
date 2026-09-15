import { useRef } from "react";
import type { KeyboardEvent } from "react";

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, direction: -1 | 1) => {
    const index = options.findIndex((option) => option.value === value);
    if (index < 0 || options.length < 2) return;
    event.preventDefault();
    const next = options[(index + direction + options.length) % options.length];
    onChange(next.value);
    queueMicrotask(() => refs.current[options.indexOf(next)]?.focus());
  };

  return (
    <div role="group" aria-label={label} className="segmented-control">
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="button"
          aria-pressed={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") move(event, 1);
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(event, -1);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
