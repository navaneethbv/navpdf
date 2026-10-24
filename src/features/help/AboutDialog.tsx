import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Info } from "lucide-react";
import { version as pdfjsVersion } from "pdfjs-dist";
import { Dialog } from "../../components/Dialog";
import { native } from "../../services/native";

export function AboutDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!native) return undefined;
    let active = true;
    void getVersion()
      .then((value) => {
        if (active) setVersion(value);
      })
      .catch(() => {
        // The version line is left out when the application cannot report it.
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Dialog title="About NavPDF" icon={<Info size={18} />} onClose={onClose}>
      <div className="about-dialog">
        <p className="about-name">NavPDF</p>
        <p>{native ? `Version ${version ?? "…"}` : "Browser preview"}</p>
        <p>A desktop PDF reader and editor that opens, edits and saves documents on this device.</p>
        <p className="muted">
          Built with Tauri, React and PDF.js {pdfjsVersion}. PDF scripts are never run.
        </p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button primary" onClick={onClose} data-autofocus>
          Close
        </button>
      </div>
    </Dialog>
  );
}
