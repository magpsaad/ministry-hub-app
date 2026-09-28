"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT = 280; // on-screen crop window, CSS px (square)
const OUTPUT_SIZE = 200; // stored photo size, px (square)

type Rendered = { width: number; height: number; naturalWidth: number; naturalHeight: number };

/**
 * REQUIREMENTS.md §6.4/§6.13 -- lets the user crop/center a photo before it
 * uploads (the current app's old Cropper.js step, deferred at Phase B,
 * built here as a small dependency-free drag-to-pan + zoom-slider cropper
 * rather than pulling in a library). Always exports exactly 200x200 --
 * `onCropped` receives a ready-to-upload JPEG Blob at that fixed size,
 * regardless of the source image's dimensions or aspect ratio.
 */
export function PhotoCropperModal({
  file,
  onCancel,
  onCropped,
}: {
  file: File;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 }); // top-left of the image, relative to the viewport
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function baseScale(r: Rendered) {
    // "cover" fit -- the smaller of the two ratios would leave gaps, so use the larger.
    return Math.max(VIEWPORT / r.naturalWidth, VIEWPORT / r.naturalHeight);
  }

  function clampPan(next: { x: number; y: number }, r: Rendered, z: number) {
    const scale = baseScale(r) * z;
    const w = r.naturalWidth * scale;
    const h = r.naturalHeight * scale;
    // The viewport (0..VIEWPORT) must stay fully covered by the image.
    const minX = VIEWPORT - w;
    const minY = VIEWPORT - h;
    return {
      x: Math.min(0, Math.max(minX, next.x)),
      y: Math.min(0, Math.max(minY, next.y)),
    };
  }

  function handleImageLoad() {
    const img = imgRef.current;
    if (!img) return;
    const r: Rendered = { width: 0, height: 0, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
    setRendered(r);
    const scale = baseScale(r);
    const w = r.naturalWidth * scale;
    const h = r.naturalHeight * scale;
    setPan({ x: (VIEWPORT - w) / 2, y: (VIEWPORT - h) / 2 });
    setZoom(1);
  }

  function handleCenter() {
    if (!rendered) return;
    const scale = baseScale(rendered) * zoom;
    const w = rendered.naturalWidth * scale;
    const h = rendered.naturalHeight * scale;
    setPan({ x: (VIEWPORT - w) / 2, y: (VIEWPORT - h) / 2 });
  }

  function handleZoomChange(nextZoom: number) {
    if (!rendered) return;
    setZoom(nextZoom);
    setPan((prev) => clampPan(prev, rendered, nextZoom));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !rendered) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan(clampPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy }, rendered, zoom));
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function handleSave() {
    const img = imgRef.current;
    if (!img || !rendered) return;
    setSaving(true);

    const scale = baseScale(rendered) * zoom;
    // Source rect, in the ORIGINAL image's natural pixel coordinates, that
    // maps onto the viewport window.
    const sx = -pan.x / scale;
    const sy = -pan.y / scale;
    const sSize = VIEWPORT / scale;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setSaving(false);
      return;
    }
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    canvas.toBlob(
      (blob) => {
        setSaving(false);
        if (blob) onCropped(blob);
      },
      "image/jpeg",
      0.9,
    );
  }

  if (!objectUrl) return null;

  const scale = rendered ? baseScale(rendered) * zoom : 1;
  const displayWidth = rendered ? rendered.naturalWidth * scale : 0;
  const displayHeight = rendered ? rendered.naturalHeight * scale : 0;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-4">
          <h2 className="text-base font-bold text-brand">Position Photo</h2>
          <button onClick={onCancel} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>

        <div
          className="relative mx-auto overflow-hidden rounded-md bg-[#f0f0f0] touch-none select-none cursor-move"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={objectUrl}
            alt=""
            draggable={false}
            onLoad={handleImageLoad}
            style={{
              position: "absolute",
              left: pan.x,
              top: pan.y,
              width: displayWidth || undefined,
              height: displayHeight || undefined,
              maxWidth: "none",
            }}
          />
          {/* Circular guide -- the stored photo is a 200x200 square, but it's
              always displayed inside a circular avatar throughout the app,
              so preview it that way. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ borderRadius: "50%", boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)", border: "2px solid white" }}
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-xs text-[#666]">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            className="flex-1"
          />
          <button
            type="button"
            onClick={handleCenter}
            className="rounded-md bg-[#f0f0f0] px-3 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#e0e0e0]"
          >
            Center
          </button>
        </div>

        <div className="mt-4 flex gap-2 border-t border-[#f0f0f0] pt-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !rendered}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
