"use client";

import { Chat } from "@/components/chat";

export default function OnboardingPage() {
  return (
    <div className="h-full">
      <Chat
        mode="onboarding"
        initialMessage="Let's set up your content engine. Which supported platforms are you active on? (Instagram, LinkedIn, Facebook, Threads, or X.)"
      />
    </div>
  );
}
