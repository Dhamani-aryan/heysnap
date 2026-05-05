import * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  readonly icon?: React.ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly className?: string;
}

export const EmptyState = ({ icon, title, description, action, className }: EmptyStateProps) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-center",
      className,
    )}
  >
    {icon !== undefined && <div className="text-muted-foreground">{icon}</div>}
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description !== undefined && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
    {action !== undefined && <div className="pt-1">{action}</div>}
  </div>
);
