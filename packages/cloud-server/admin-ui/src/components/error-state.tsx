import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  readonly message: string;
  readonly onRetry?: () => void;
  readonly className?: string;
}

export const ErrorState = ({ message, onRetry, className }: ErrorStateProps) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-10 text-center",
      className,
    )}
  >
    <AlertTriangle className="h-6 w-6 text-destructive" />
    <p className="text-sm text-destructive">{message}</p>
    {onRetry !== undefined && (
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    )}
  </div>
);
