"use client";
import { useRouter } from "next/navigation";

/** Minimal chevron: goes to the previous page, or to `fallback` when there is no history (deep link). */
export default function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="back"
      aria-label="Go back"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
