import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8 pb-6 border-b border-white/10">
      <div>
        <h1 className="text-3xl md:text-4xl font-display text-foreground glow-text mb-2">
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground text-lg">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
