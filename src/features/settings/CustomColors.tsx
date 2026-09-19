import type { ThemeOverrides } from "../../types/document";
import { isThemeColor } from "../../services/theme-colors";

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
      {[
        {
          key: "background",
          color: value.background,
          fallback: defaults.background,
          change: (color: string | null) => {
            onChange({ ...value, background: color });
          },
        },
        {
          key: "accent",
          color: value.accent,
          fallback: defaults.accent,
          change: (color: string | null) => {
            onChange({ ...value, accent: color });
          },
        },
      ].map(({ key, color, fallback, change }) => (
        <div className="custom-color-row" key={key}>
          <label className="check-label">
            <input
              type="checkbox"
              checked={color !== null}
              onChange={(event) => {
                change(event.target.checked ? fallback : null);
              }}
            />
            Custom {mode.toLowerCase()} {key}
          </label>
          <input
            type="color"
            aria-label={`${mode} ${key} color`}
            disabled={color === null}
            value={isThemeColor(color) ? color : fallback}
            onChange={(event) => {
              change(event.target.value);
            }}
          />
          <input
            type="text"
            className="custom-color-hex"
            aria-label={`${mode} ${key} hex`}
            placeholder="#rrggbb"
            pattern="#[0-9a-fA-F]{6}"
            maxLength={7}
            required
            disabled={color === null}
            value={color ?? ""}
            onChange={(event) => {
              change(event.target.value);
            }}
          />
        </div>
      ))}
      <button
        type="button"
        disabled={value.background === null && value.accent === null}
        onClick={() => {
          onChange({ background: null, accent: null });
        }}
      >
        Reset {mode.toLowerCase()} colors
      </button>
    </fieldset>
  );
}
