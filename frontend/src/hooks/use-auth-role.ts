"use client";

import { useSyncExternalStore } from "react";

export type AuthRole = "owner" | "viewer" | null;

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("rf-auth-change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("rf-auth-change", onStoreChange);
  };
}

function getSnapshot(): AuthRole {
  const role = localStorage.getItem("rf_role");
  return role === "owner" || role === "viewer" ? role : null;
}

const getServerSnapshot = (): AuthRole => null;

export function useAuthRole(): AuthRole {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
