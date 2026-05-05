import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ComputerStatus } from "@/lib/types";

const statusVariant: Record<
  ComputerStatus,
  { readonly variant: "success" | "warning" | "destructive" | "muted" | "secondary"; readonly label: string }
> = {
  creating: { variant: "warning", label: "Creating" },
  starting: { variant: "warning", label: "Starting" },
  online: { variant: "success", label: "Online" },
  idle: { variant: "success", label: "Idle" },
  sleeping: { variant: "muted", label: "Sleeping" },
  offline: { variant: "muted", label: "Offline" },
  failed: { variant: "destructive", label: "Failed" },
  deleted: { variant: "destructive", label: "Deleted" },
};

export const StatusBadge = ({ status, className }: { readonly status: ComputerStatus; readonly className?: string }) => {
  const config = statusVariant[status];

  return (
    <Badge variant={config.variant} className={cn("font-medium", className)}>
      {config.label}
    </Badge>
  );
};
