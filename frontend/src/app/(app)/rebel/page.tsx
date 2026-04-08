"use client";

import { Chat } from "@/components/chat";

export default function RebelPage() {
  return (
    <div className="h-full">
      <Chat mode="general" initialMessage="What are we working on?" />
    </div>
  );
}
