import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

export const NotFoundPage = () => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
    <p className="text-xs uppercase tracking-wide text-muted-foreground">404</p>
    <h1 className="text-2xl font-semibold">Page not found</h1>
    <p className="text-sm text-muted-foreground">The page you were looking for does not exist.</p>
    <Button asChild>
      <Link to="/">Back to overview</Link>
    </Button>
  </div>
);
