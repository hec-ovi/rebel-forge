"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { clearAuthSession } from "@/lib/api";

const subscribeToBrowser = () => () => {};
const getBrowserSnapshot = () => true;
const getServerSnapshot = () => false;

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isBrowser = useSyncExternalStore(
    subscribeToBrowser,
    getBrowserSnapshot,
    getServerSnapshot,
  );
  const token = isBrowser ? localStorage.getItem("rf_token") : null;
  const role = isBrowser ? localStorage.getItem("rf_role") : null;
  const validSession = Boolean(token && (role === "owner" || role === "viewer"));

  useEffect(() => {
    if (isBrowser && !validSession) {
      clearAuthSession();
      router.replace("/login");
    }
  }, [isBrowser, router, validSession]);

  if (!isBrowser || !validSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status">
        <span className="sr-only">Checking authentication</span>
      </div>
    );
  }

  return children;
}
