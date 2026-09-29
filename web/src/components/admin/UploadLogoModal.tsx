"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { uploadLogoAction } from "@/app/admin/actions-needed-config/actions";

// Same limits the server action enforces -- checked here too so a wrong
// file is caught before anything is sent.
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Owner-requested workflow for replacing the ministry logo: one "Upload
 * logo" button opens this pop-up; "Choose image" picks a file and shows a
 * preview of exactly what will be used; Upload stays disabled until a
 * valid image is chosen, and nothing is sent before it's pressed. */
export function UploadLogoModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: (logoUrl: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Free the preview image's memory when it's replaced or the pop-up closes.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Escape closes the pop-up (but not in the middle of an upload).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  function handlePicked(picked: File | undefined) {
    if (inputRef.current) inputRef.current.value = ""; // so choosing the same file again still fires
    if (!picked) return;
    if (!ACCEPTED.includes(picked.type)) {
      setError("That file isn't a PNG, JPG or WebP image. Choose a different one.");
      return;
    }
    if (picked.size > MAX_BYTES) {
      setError(`That image is ${formatSize(picked.size)}; the limit is 2 MB. A square image about 512 × 512 pixels is plenty.`);
      return;
    }
    setError(null);
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  }

  function handleUpload() {
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.append("logo", file);
    startTransition(async () => {
      const res = await uploadLogoAction(formData);
      if (res.error || !res.logoUrl) {
        setError(res.error ?? "The logo could not be uploaded. Please try again.");
        return;
      }
      onUploaded(res.logoUrl);
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-logo-title"
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.25)] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id="upload-logo-title" className="text-lg font-bold text-brand">
            Upload a new logo
          </h2>
          <p className="mt-1 text-xs text-[#666]">PNG, JPG or WebP, up to 2 MB. A square image looks best.</p>
        </div>

        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[#ccc] bg-[#fafafa] px-4 py-5">
          {previewUrl && file ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
              <img
                src={previewUrl}
                alt="Preview of the chosen logo"
                className="h-24 w-24 rounded-full bg-white object-contain p-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]"
              />
              <p className="max-w-full truncate text-xs text-[#666]" title={file.name}>
                {file.name} &middot; {formatSize(file.size)}
              </p>
            </>
          ) : (
            <p className="text-sm text-[#666]">No image chosen yet.</p>
          )}
          <input
            ref={inputRef}
            id="upload-logo-file"
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(e) => handlePicked(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="rounded-md border border-brand bg-white px-4 py-2 text-sm font-semibold text-brand hover:bg-[#f0f4f8] disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.1)]"
          >
            {file ? "Choose a different image" : "Choose image"}
          </button>
        </div>

        {error && <p className="text-sm text-[#dc3545]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md px-4 py-2 text-sm font-semibold text-[#666] hover:text-[#333] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || pending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50 shadow-[0_2px_4px_rgba(0,0,0,0.15)]"
          >
            {pending ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
