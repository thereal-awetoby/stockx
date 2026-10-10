"use client";

import { useEffect, useRef, useState } from "react";
import { pocketCopy } from "@stockx/shared/pocket";

export interface KeyBackupDialogProps {
  privateKey: string;
  address: string;
  onClose: () => void;
}

/** Shows the session key once, with copy and save-as-.txt. The parent drops the key when this closes. */
export function KeyBackupDialog({ privateKey, address, onClose }: KeyBackupDialogProps) {
  const [shown, setShown] = useState(false);
  const [note, setNote] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(privateKey);
      setNote("Copied. It stays on your clipboard until you copy something else.");
    } catch {
      setShown(true);
      field.current?.select();
      setNote("Could not copy automatically. The key is selected, so copy it by hand.");
    }
  }

  function save(): void {
    const blob = new Blob([`${privateKey}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "stockx-session-private-key.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setNote("Saved as stockx-session-private-key.txt in your downloads.");
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="key-dialog-title">
        <h2 id="key-dialog-title">Back up your pocket key</h2>
        <p className="muted small">Pocket address: {address}</p>
        <p className="warn">{pocketCopy.keyRisk}</p>
        <input ref={field} readOnly type={shown ? "text" : "password"} value={privateKey} aria-label="Pocket private key" />
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => setShown((v) => !v)}>{shown ? "Hide" : "Reveal"}</button>
          <button type="button" onClick={() => void copy()}>Copy</button>
          <button type="button" onClick={save}>Save as .txt</button>
        </div>
        {note && <p className="small" role="status">{note}</p>}
        <p className="muted small">After saving, close this and paste the key into "Paste key to verify backup" to finish.</p>
        <button type="button" className="ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
