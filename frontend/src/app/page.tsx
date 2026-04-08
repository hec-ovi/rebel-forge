"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("rf_token");
    const onboarded = localStorage.getItem("rf_onboarded");

    if (!token) {
      router.replace("/login");
    } else if (onboarded) {
      router.replace("/rebel");
    } else {
      router.replace("/onboarding");
    }
  }, [router]);

  return null;
}
