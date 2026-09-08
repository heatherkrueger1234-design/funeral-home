import { ReactNode } from "react";
import { Sidebar, MobileHeader } from "./Sidebar";
import { motion } from "framer-motion";

interface PageLayoutProps {
  children: ReactNode;
}

export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Mobile header */}
      <MobileHeader />

      <main className="flex-1 md:ml-64 relative min-h-screen">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="max-w-5xl mx-auto px-4 pt-20 pb-12 md:px-8 md:pt-10 md:pb-16"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
