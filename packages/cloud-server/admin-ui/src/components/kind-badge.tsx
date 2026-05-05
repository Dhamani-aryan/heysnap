import { Cloud, Laptop } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ComputerKind } from "@/lib/types";

export const KindBadge = ({ kind }: { readonly kind: ComputerKind }) => (
  <Badge variant="outline" className="gap-1 font-medium">
    {kind === "cloud" ? <Cloud className="h-3 w-3" /> : <Laptop className="h-3 w-3" />}
    {kind === "cloud" ? "Cloud" : "Local"}
  </Badge>
);
