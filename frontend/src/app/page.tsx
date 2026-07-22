"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("rf_token");
    const role = localStorage.getItem("rf_role");
    const onboarded = localStorage.getItem("rf_onboarded");

    if (!token || (role !== "owner" && role !== "viewer")) {
      router.replace("/login");
    } else if (role === "viewer") {
      router.replace("/dashboard");
    } else if (onboarded) {
      router.replace("/rebel");
    } else {
      router.replace("/onboarding");
    }
  }, [router]);

  return null;
}
