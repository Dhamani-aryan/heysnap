import * as React from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

export const PageHeader = ({ title, description, actions, className }: PageHeaderProps) => (
  <div className={cn("flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between", className)}>
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description !== undefined && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
    {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);
