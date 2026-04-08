"use client";

import { Chat } from "@/components/chat";

export default function OnboardingPage() {
  return (
    <div className="h-full">
      <Chat
        mode="onboarding"
        initialMessage="Let's set up your content engine. Which platforms are you active on? (Instagram, TikTok, LinkedIn, YouTube, X, etc.)"
      />
    </div>
  );
}
