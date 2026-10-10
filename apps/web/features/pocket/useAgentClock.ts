"use client";

import { useEffect, useRef } from "react";

export function useAgentClock(active: boolean, onTick: () => void, hourUtc = 15, minuteUtc = 0): void {
  const lastDay = useRef("");

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (now.getUTCHours() === hourUtc && now.getUTCMinutes() === minuteUtc && lastDay.current !== day) {
        lastDay.current = day;
        onTick();
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [active, onTick, hourUtc, minuteUtc]);
}