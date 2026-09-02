import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void | Promise<void>;
  readonly onCancel: () => void;
}

export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => (
  <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description !== undefined && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          onClick={() => {
            void onConfirm();
          }}
          disabled={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
