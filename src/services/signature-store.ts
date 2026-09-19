import {
  loadSignatures,
  saveSignature as nativeSaveSignature,
  deleteSignature as nativeDeleteSignature,
  migrateSignatures as nativeMigrateSignatures,
  type SavedSignature,
} from "./native";

const sessionSignatures: Map<string, SavedSignature> = new Map();

export function getSessionSignatures(): SavedSignature[] {
  return Array.from(sessionSignatures.values());
}

export function clearSessionSignatures(): void {
  sessionSignatures.clear();
}

export async function fetchSignatureLibrary(): Promise<{
  signatures: SavedSignature[];
  error: string | null;
  warnings: string[];
}> {
  const sessionList = Array.from(sessionSignatures.values());
  const legacy = getLegacyPlaintextSignatures();
  try {
    const persistent = await loadSignatures();
    const combined = [...sessionList, ...persistent.assets, ...legacy];
    combined.sort((a, b) => b.createdAt - a.createdAt);
    return { signatures: combined, error: null, warnings: persistent.warnings };
  } catch (err) {
    // If native storage fails, do not silently fail; expose session and legacy assets and report error
    const combined = [...sessionList, ...legacy];
    return {
      signatures: combined,
      error:
        err instanceof Error
          ? err.message
          : "Secure signature storage is unavailable. Only session-only signatures can be created.",
      warnings: [],
    };
  }
}

export async function persistOrStageSignature(
  name: string,
  type: "signature" | "initials",
  dataUrl: string,
  sessionOnly: boolean,
): Promise<{ signature: SavedSignature; error: string | null }> {
  if (sessionOnly) {
    const sessionSig: SavedSignature = {
      id: crypto.randomUUID(),
      name,
      type,
      dataUrl,
      createdAt: Math.floor(Date.now() / 1000),
      storage: "session",
      sessionOnly: true,
    };
    sessionSignatures.set(sessionSig.id, sessionSig);
    return { signature: sessionSig, error: null };
  }

  try {
    const saved = await nativeSaveSignature(name, type, dataUrl);
    return { signature: saved, error: null };
  } catch (err) {
    return {
      signature: {
        id: "",
        name,
        type,
        dataUrl,
        createdAt: 0,
        storage: "session",
      },
      error: err instanceof Error ? err.message : "Failed to persist signature in secure storage.",
    };
  }
}

export async function removeSignature(id: string, sessionOnly?: boolean): Promise<void> {
  if (sessionOnly || sessionSignatures.has(id)) {
    sessionSignatures.delete(id);
    return;
  }
  try {
    const legacy = getLegacyPlaintextSignatures();
    const remaining = legacy.filter((s) => s.id !== id);
    if (remaining.length !== legacy.length) {
      localStorage.setItem("navpdf-signatures", JSON.stringify(remaining));
    }
  } catch {
    // ignore
  }
  await nativeDeleteSignature(id);
}

export function hasLegacyPlaintextSignatures(): boolean {
  try {
    const raw = localStorage.getItem("navpdf-signatures");
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export function getLegacyPlaintextSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem("navpdf-signatures");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      id: item.id || `legacy-${stableSignatureId(item)}`,
      name: item.name || "Signature",
      type: item.type === "initials" ? "initials" : "signature",
      dataUrl: item.dataUrl || "",
      createdAt: item.createdAt || Math.floor(Date.now() / 1000),
      storage: "legacy" as const,
    }));
  } catch {
    return [];
  }
}

function stableSignatureId(item: { name?: string; type?: string; dataUrl?: string }) {
  const input = `${item.name ?? "Signature"}\u0000${item.type ?? "signature"}\u0000${item.dataUrl ?? ""}`;
  let hash = 2166136261;
  for (let offset = 0; offset < input.length; offset++) {
    // Preserve existing signature identifiers by hashing individual UTF-16 code units.
    hash ^= (input.at(offset)?.codePointAt(0) ?? 0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function migrateLegacySignatures(
  confirmed: boolean,
): Promise<{ count: number; error: string | null }> {
  if (!confirmed) {
    try {
      localStorage.removeItem("navpdf-signatures");
    } catch {
      // ignore
    }
    return { count: 0, error: null };
  }

  const legacy = getLegacyPlaintextSignatures();
  if (legacy.length === 0) {
    return { count: 0, error: null };
  }

  try {
    const migrated = await nativeMigrateSignatures(legacy);
    if (migrated.length === legacy.length) {
      // Verified: all migrated successfully, now safe to remove from localStorage
      localStorage.removeItem("navpdf-signatures");
      return { count: migrated.length, error: null };
    } else {
      return {
        count: migrated.length,
        error: `Only ${migrated.length} of ${legacy.length} signatures were migrated. Plaintext copies were retained.`,
      };
    }
  } catch (err) {
    return {
      count: 0,
      error:
        err instanceof Error
          ? err.message
          : "Migration to secure storage failed. Plaintext signatures were retained.",
    };
  }
}
