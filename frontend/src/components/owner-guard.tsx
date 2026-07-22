"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthRole } from "@/hooks/use-auth-role";

export function OwnerGuard({
  children,
  required = true,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  const router = useRouter();
  const role = useAuthRole();
  const blocked = required && role !== "owner";

  useEffect(() => {
    if (blocked) router.replace("/dashboard");
  }, [blocked, router]);

  if (blocked) {
    return (
      <div className="flex min-h-64 items-center justify-center" role="status">
        <span className="sr-only">Redirecting to dashboard</span>
      </div>
    );
  }

  return children;
}
