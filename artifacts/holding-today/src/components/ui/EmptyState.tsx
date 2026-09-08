import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-16 px-4 text-center glass-panel rounded-3xl"
    >
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(14,165,233,0.15)]">
        <Icon className="w-10 h-10 text-primary opacity-80" />
      </div>
      <h3 className="text-2xl font-display text-foreground mb-3">{title}</h3>
      <p className="text-muted-foreground max-w-md mb-8 text-lg leading-relaxed">
        {description}
      </p>
      {action}
    </motion.div>
  );
}
