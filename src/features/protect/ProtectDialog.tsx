import { useId, useState } from "react";
import { AlertTriangle, Lock, Shield, Unlock, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { discardRecovery, markDirty, native } from "../../services/native";
import { ENGINE_UNAVAILABLE, saveProtectedCopy, unlockDocument } from "../../services/engine";
import type { PermissionRequest } from "../../types/engine";
import { FeatureDialog } from "../../components/FeatureDialog";

const ALL_PERMISSIONS: PermissionRequest = {
  print: true,
  printHighQuality: true,
  copy: true,
  accessibility: true,
  modify: true,
  annotate: true,
  fillForms: true,
  assemble: true,
};

const PERMISSION_LABELS: [keyof PermissionRequest, string][] = [
  ["print", "Print"],
  ["printHighQuality", "Print at full quality"],
  ["copy", "Copy text and images"],
  ["accessibility", "Extract text for accessibility tools"],
  ["modify", "Change page content"],
  ["annotate", "Add comments and fill signatures"],
  ["fillForms", "Fill in form fields"],
  ["assemble", "Insert, rotate or delete pages"],
];

const MAX_PASSWORD_BYTES = 127;
const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** Mirrors the native checks so problems are explained before the save picker opens. */
export function validateProtection(
  openPassword: string,
  confirmOpen: string,
  permissionsPassword: string,
  confirmPermissions: string,
  permissions: PermissionRequest,
): string | null {
  if (
    byteLength(openPassword) > MAX_PASSWORD_BYTES ||
    byteLength(permissionsPassword) > MAX_PASSWORD_BYTES
  )
    return "Passwords can be at most 127 bytes long.";
  const restricted = Object.values(permissions).some((allowed) => !allowed);
  if (!openPassword && !permissionsPassword)
    return "Enter a password, or use a separate permissions password for an open-without-password copy.";
  if (!openPassword && !restricted)
    return "An open-without-password copy must restrict at least one permission.";
  if (openPassword && openPassword !== confirmOpen) return "The open passwords do not match.";
  if (restricted || permissionsPassword || !openPassword) {
    if (!permissionsPassword)
      return "Set a permissions password so the restrictions can be enforced.";
    if (permissionsPassword === openPassword)
      return "The permissions password must differ from the open password.";
    if (permissionsPassword !== confirmPermissions)
      return "The permissions passwords do not match.";
  }
  return null;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ProtectDialog({
  controller,
  onClose,
  onSaveUnprotected,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
  onSaveUnprotected?: () => Promise<boolean>;
}>) {
  const sourcePdf = controller?.pdf;
  const s = useWorkspace();
  const ids = useId();
  const [openPassword, setOpenPassword] = useState("");
  const [confirmOpen, setConfirmOpen] = useState("");
  const [permissionsPassword, setPermissionsPassword] = useState("");
  const [confirmPermissions, setConfirmPermissions] = useState("");
  const [permissions, setPermissions] = useState<PermissionRequest>(ALL_PERMISSIONS);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  const encrypted = !!s.info?.encrypted;
  const protectedSource = !!s.info?.protectedSource;
  const saveTitle = protectedSource ? "Save Protected Document" : "Password Protect PDF";
  const title = encrypted ? "Unlock Protected PDF" : saveTitle;

  const clearPasswords = () => {
    setOpenPassword("");
    setConfirmOpen("");
    setPermissionsPassword("");
    setConfirmPermissions("");
  };

  const unlock = async () => {
    const pdf = controller?.pdf;
    const doc = s.document;
    if (!controller || !pdf || !doc || !unlockPassword) return;
    setWorking(true);
    setProblem("");
    try {
      const bytes = await unlockDocument(doc.id, unlockPassword);
      await controller.replaceWithBytes(bytes, "Unlocked for editing", {
        expectedSource: sourcePdf,
        resetHistory: true,
      });
      await discardRecovery(doc.id).catch(() => {});
      const state = useWorkspace.getState();
      state.set({
        dirty: false,
        info: state.info ? { ...state.info, encrypted: false, protectedSource: true } : state.info,
        status: "Unlocked for editing. The file on disk stays password protected until you save.",
      });
      controller.markSaved(bytes, controller.pdf?.numPages ?? pdf.numPages);
      await markDirty(false).catch(() => {});
      onClose();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setUnlockPassword("");
      setWorking(false);
    }
  };

  const protect = async () => {
    const pdf = controller?.pdf;
    const doc = s.document;
    if (!controller || !pdf || !doc) return;
    const invalid = validateProtection(
      openPassword,
      confirmOpen,
      permissionsPassword,
      confirmPermissions,
      permissions,
    );
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setWorking(true);
    setProblem("");
    try {
      controller.editor?.commitOrRemove();
      const bytes = await pdf.saveDocument();
      const result = await saveProtectedCopy(doc.id, bytes, pdf.numPages, {
        userPassword: openPassword,
        ownerPassword: permissionsPassword,
        permissions,
      });
      if (!result) {
        s.set({ status: "Save cancelled" });
        return;
      }
      const state = useWorkspace.getState();
      if (result.replacedSource) {
        state.set({
          dirty: false,
          document: state.document
            ? { ...state.document, unsaved: false, size: result.size }
            : state.document,
          info: state.info
            ? { ...state.info, encrypted: false, protectedSource: true }
            : state.info,
        });
        controller.markSaved(bytes, pdf.numPages);
        await markDirty(false).catch(() => {});
        await discardRecovery(doc.id).catch(() => {});
      }
      state.set({
        status: result.replacedSource
          ? `Saved ${result.name} with AES-256 password protection.`
          : `Protected copy saved as ${result.name}. The open document itself is not password protected.`,
      });
      onClose();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      clearPasswords();
      setWorking(false);
    }
  };

  const saveUnprotected = async () => {
    if (!onSaveUnprotected) return;
    onClose();
    await onSaveUnprotected();
  };

  const field = (suffix: string, label: string, value: string, change: (value: string) => void) => (
    <div className="setting-group">
      <label className="setting-title" htmlFor={`${ids}-${suffix}`}>
        {label}
      </label>
      <input
        id={`${ids}-${suffix}`}
        type="password"
        autoComplete="new-password"
        className="text-input"
        value={value}
        disabled={working || !native}
        onChange={(event) => change(event.target.value)}
      />
    </div>
  );

  return (
    <FeatureDialog title={title} onClose={onClose} busy={working}>
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            {encrypted ? <Unlock size={18} /> : <Shield size={18} />}
            <h3>{title}</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form
          className="modal-body"
          onSubmit={(event) => {
            event.preventDefault();
            void (encrypted ? unlock() : protect());
          }}
        >
          {!native && (
            <div className="warning-banner">
              <AlertTriangle size={18} />
              <span>{ENGINE_UNAVAILABLE}</span>
            </div>
          )}

          {encrypted ? (
            <>
              <div className="security-status-box">
                <Lock size={20} />
                <p>
                  This PDF is password protected and opens read-only. Enter its password to create
                  an editable working copy. If the PDF restricts changes, enter its permissions
                  (owner) password. Recovery copies are not written for unlocked documents.
                </p>
              </div>
              {field("unlock", "Document password", unlockPassword, setUnlockPassword)}
            </>
          ) : (
            <>
              {protectedSource && (
                <div className="security-status-box">
                  <Lock size={20} />
                  <p>
                    This working copy came from a password-protected file. Save a protected copy
                    below, or explicitly save without protection.
                  </p>
                </div>
              )}
              <p className="field-hint">
                The copy is encrypted with AES-256 and checked before it replaces anything. Leave
                the open password empty to create a copy that opens without a password while the
                separate permissions password protects its restrictions.
              </p>
              {field("open", "Open password", openPassword, setOpenPassword)}
              {field("confirm-open", "Confirm open password", confirmOpen, setConfirmOpen)}
              <fieldset className="permission-grid" disabled={working || !native}>
                <legend className="setting-title">Allowed without the permissions password</legend>
                {PERMISSION_LABELS.map(([key, label]) => (
                  <label key={key} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={permissions[key]}
                      onChange={(event) =>
                        setPermissions((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <p className="field-hint">
                Readers that honor PDF permissions enforce these restrictions; they do not stop
                someone who has the open password from reading the content.
              </p>
              {field(
                "permissions",
                "Permissions password",
                permissionsPassword,
                setPermissionsPassword,
              )}
              {field(
                "confirm-permissions",
                "Confirm permissions password",
                confirmPermissions,
                setConfirmPermissions,
              )}
            </>
          )}

          {problem && (
            <p className="error-text" role="alert">
              {problem}
            </p>
          )}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="button-secondary">
            Cancel
          </button>
          {protectedSource && onSaveUnprotected && (
            <button
              type="button"
              className="button-secondary"
              disabled={working}
              onClick={() => void saveUnprotected()}
            >
              Save Without Protection…
            </button>
          )}
          {encrypted ? (
            <button
              type="button"
              className="button-primary"
              disabled={working || !native || !unlockPassword}
              onClick={() => void unlock()}
            >
              <Unlock size={16} /> {working ? "Unlocking…" : "Unlock for Editing"}
            </button>
          ) : (
            <button
              type="button"
              className="button-primary"
              disabled={working || !native || !controller?.pdf}
              onClick={() => void protect()}
            >
              <Lock size={16} /> {working ? "Protecting…" : "Save Protected Copy…"}
            </button>
          )}
        </div>
      </div>
    </FeatureDialog>
  );
}
