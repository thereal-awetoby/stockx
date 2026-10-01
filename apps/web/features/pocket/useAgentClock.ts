"use client";

import { useEffect, useRef } from "react";

export function useAgentClock(active: boolean, onTick: () => void): void {
  const lastDay = useRef("");

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (now.getUTCHours() === 15 && now.getUTCMinutes() === 0 && lastDay.current !== day) {
        lastDay.current = day;
        onTick();
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [active, onTick]);
}