"use client";

import { useState } from "react";
import { motion } from "motion/react";
import DraftsPage from "../drafts/page";
import CalendarPage from "../calendar/page";
import AnalyticsPage from "../analytics/page";

const tabs = [
  { id: "drafts", label: "Drafts" },
  { id: "calendar", label: "Calendar" },
  { id: "analytics", label: "Analytics" },
] as const;

export default function ManagerPage() {
  const [activeTab, setActiveTab] = useState<string>("drafts");

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-surface-raised/50 p-1 mx-6 mt-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative rounded-lg px-4 py-1.5 text-sm transition-colors ${
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {activeTab === tab.id && (
              <motion.div
                layoutId="manager-tab"
                className="absolute inset-0 rounded-lg glass-card"
                transition={{ type: "spring", stiffness: 350, damping: 30 }}
              />
            )}
            <span className="relative">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content — renders full pages which include their own PageContainer */}
      {activeTab === "drafts" && <DraftsPage />}
      {activeTab === "calendar" && <CalendarPage />}
      {activeTab === "analytics" && <AnalyticsPage />}
    </div>
  );
}
