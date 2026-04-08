"use client";

import { motion } from "motion/react";
import { pageVariants } from "@/lib/animations";

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className = "" }: PageContainerProps) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      className={`p-6 h-full overflow-y-auto ${className}`}
    >
      {children}
    </motion.div>
  );
}
