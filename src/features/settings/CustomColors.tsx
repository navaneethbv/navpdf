import type { ThemeOverrides } from "../../types/document";

export function CustomColors({
  mode,
  value,
  onChange,
}: {
  mode: "Light" | "Dark";
  value: ThemeOverrides;
  onChange: (value: ThemeOverrides) => void;
}) {
  const defaults =
    mode === "Light"
      ? { background: "#ffffff", accent: "#1768c4" }
      : { background: "#262626", accent: "#8bbcff" };
  return (
    <fieldset className="custom-colors">
      <legend>{mode} overrides</legend>
      {(["background", "accent"] as const).map((key) => (
        <div className="custom-color-row" key={key}>
          <label className="check-label">
            <input
              type="checkbox"
              checked={Boolean(value[key])}
              onChange={(event) =>
                onChange({ ...value, [key]: event.target.checked ? defaults[key] : null })
              }
            />
            Custom {mode.toLowerCase()} {key}
          </label>
          <input
            type="color"
            aria-label={`${mode} ${key} color`}
            disabled={!value[key]}
            value={value[key] ?? defaults[key]}
            onChange={(event) => onChange({ ...value, [key]: event.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        disabled={!value.background && !value.accent}
        onClick={() => onChange({ background: null, accent: null })}
      >
        Reset {mode.toLowerCase()} colors
      </button>
    </fieldset>
  );
}
