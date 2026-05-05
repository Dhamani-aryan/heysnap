import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  readonly label: string;
  readonly value: number | string;
  readonly hint?: string;
  readonly icon?: React.ReactNode;
  readonly tone?: "default" | "success" | "warning" | "destructive";
}

const toneClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

export const StatCard = ({ label, value, hint, icon, tone = "default" }: StatCardProps) => (
  <Card className="overflow-hidden">
    <CardContent className="flex items-center justify-between gap-3 p-5">
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("text-2xl font-semibold", toneClasses[tone])}>{value}</div>
        {hint !== undefined && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {icon !== undefined && (
        <div className="rounded-lg border bg-card/60 p-2 text-muted-foreground">{icon}</div>
      )}
    </CardContent>
  </Card>
);
