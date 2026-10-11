"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * An <img> that never shows a broken-image icon.
 *
 * Why not just onError: when the server renders the page, the browser starts loading the image BEFORE React
 * has attached its handlers, so an image that fails early never calls onError and stays broken until a reload.
 * Here a ref callback checks the image once it is mounted (img.decode() rejects for a broken image), tries
 * once more with a cache-busting query, and then calls onGiveUp so the parent can show a letter instead.
 */
export default function SafeImg({
  src, alt, className, width, height, style, onGiveUp,
}: {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  style?: CSSProperties;
  onGiveUp: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [src]);

  // Keep the latest callback without making the ref callback below change on every parent render.
  const giveUp = useRef(onGiveUp);
  useEffect(() => { giveUp.current = onGiveUp; }, [onGiveUp]);

  const fail = useCallback(() => {
    if (attempt === 0) setAttempt(1);
    else giveUp.current();
  }, [attempt]);

  const ref = useCallback((img: HTMLImageElement | null) => {
    if (!img || typeof img.decode !== "function") return;
    let live = true;
    img.decode().catch(() => { if (live && img.isConnected) fail(); });
    return () => { live = false; };
  }, [fail]);

  const url = attempt === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}r=1`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} key={url} src={url} alt={alt} className={className} width={width} height={height} style={style}
      referrerPolicy="no-referrer" decoding="async" onError={fail} />
  );
}
