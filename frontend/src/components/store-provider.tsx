"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const startPolling = useAppStore((s) => s.startPolling);

  useEffect(() => {
    const stop = startPolling();
    return stop;
  }, [startPolling]);

  return <>{children}</>;
}
