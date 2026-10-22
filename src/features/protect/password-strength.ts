// A local estimate of password strength from length, character variety and common patterns.
// It never sends the password anywhere and is a guide, not a guarantee.

export interface PasswordStrength {
  /** 0 (very weak) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: "Very weak" | "Weak" | "Fair" | "Good" | "Strong";
  /** Estimated guessing entropy in bits. */
  bits: number;
  advice: string;
}

const COMMON = [
  "password",
  "passwort",
  "qwerty",
  "letmein",
  "welcome",
  "admin",
  "login",
  "secret",
  "iloveyou",
  "monkey",
  "dragon",
  "abc",
  "123",
];
const LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"] as const;

function pool(password: string) {
  let size = 0;
  if (/[a-z]/.test(password)) size += 26;
  if (/[A-Z]/.test(password)) size += 26;
  if (/\d/.test(password)) size += 10;
  if (/[^\da-z]/i.test(password)) size += 33;
  return Math.max(size, 1);
}

/** Characters that only continue a run or sequence add almost nothing. */
function effectiveLength(password: string) {
  const chars = [...password];
  let length = chars.length ? 1 : 0;
  for (let index = 1; index < chars.length; index++) {
    const step = (chars[index].codePointAt(0) ?? 0) - (chars[index - 1].codePointAt(0) ?? 0);
    length += step === 0 || Math.abs(step) === 1 ? 0.25 : 1;
  }
  return length;
}

export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "Very weak", bits: 0, advice: "Enter a password." };
  const lower = password.toLowerCase();
  let bits = effectiveLength(password) * Math.log2(pool(password));
  const common = COMMON.find((word) => lower.includes(word));
  if (common) bits -= common.length * 3;
  if (/^\d+$/.test(password)) bits = Math.min(bits, 20);
  bits = Math.max(0, Math.round(bits));
  const score = scoreFor(bits);
  return { score, label: LABELS[score], bits, advice: adviceFor(password, common, score) };
}

/** Score thresholds in bits of guessing entropy, weakest first. */
const THRESHOLDS = [28, 36, 60, 80];

function scoreFor(bits: number): PasswordStrength["score"] {
  const below = THRESHOLDS.findIndex((limit) => bits < limit);
  return (below === -1 ? 4 : below) as PasswordStrength["score"];
}

function adviceFor(password: string, common: string | undefined, score: number) {
  if (common) return `Avoid common words and sequences such as "${common}".`;
  if ([...password].length < 12) return "Use at least 12 characters.";
  if (score < 3) return "Mix in more unrelated words, digits or symbols.";
  return "This password resists guessing well.";
}
