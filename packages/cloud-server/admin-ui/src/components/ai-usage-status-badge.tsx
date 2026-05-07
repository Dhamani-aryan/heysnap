import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AiUsageStatusBadgeProps {
  readonly status: string;
  readonly httpStatus?: number | null;
  readonly className?: string;
}

const VARIANT: Record<string, "success" | "warning" | "destructive" | "muted"> = {
  succeeded: "success",
  started: "warning",
  failed: "destructive",
  aborted: "muted",
};

const LABEL: Record<string, string> = {
  succeeded: "Succeeded",
  started: "In flight",
  failed: "Failed",
  aborted: "Aborted",
};

export const AiUsageStatusBadge = ({ status, httpStatus, className }: AiUsageStatusBadgeProps) => {
  const variant = VARIANT[status] ?? "muted";
  const label = LABEL[status] ?? status;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Badge variant={variant} className="font-medium">
        {label}
      </Badge>
      {httpStatus !== null && httpStatus !== undefined && (
        <span className="font-mono text-xs text-muted-foreground">{httpStatus}</span>
      )}
    </span>
  );
};
