import * as React from "react";

import { cn } from "@/lib/utils";

export interface TopBarItem {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly secondary?: string;
  readonly to?: string;
}

interface TopBarListProps {
  readonly items: ReadonlyArray<TopBarItem>;
  readonly emptyLabel?: string;
  readonly valueFormatter?: (value: number) => string;
  readonly className?: string;
  readonly renderLink?: (item: TopBarItem, content: React.ReactNode) => React.ReactNode;
}

export const TopBarList: React.FC<TopBarListProps> = ({
  items,
  emptyLabel = "No data",
  valueFormatter = (value) => value.toLocaleString(),
  className,
  renderLink,
}) => {
  if (items.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
    );
  }

  const max = items.reduce((acc, item) => Math.max(acc, item.value), 0);

  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {items.map((item) => {
        const ratio = max === 0 ? 0 : Math.max(0.02, item.value / max);
        const content = (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-card/40 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">{item.label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {valueFormatter(item.value)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${(ratio * 100).toFixed(2)}%` }}
                />
              </div>
              {item.secondary !== undefined && (
                <div className="mt-1 text-xs text-muted-foreground">{item.secondary}</div>
              )}
            </div>
          </div>
        );
        return (
          <li key={item.key}>{renderLink !== undefined ? renderLink(item, content) : content}</li>
        );
      })}
    </ul>
  );
};
