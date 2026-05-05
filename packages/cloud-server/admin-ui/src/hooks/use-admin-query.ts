import * as React from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/lib/api";
import { clearStoredAdminToken } from "@/lib/auth";

interface AdminQueryState<T> {
  readonly data: T | undefined;
  readonly error: string | null;
  readonly loading: boolean;
  reload: () => void;
}

export const useAdminQuery = <T,>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
): AdminQueryState<T> => {
  const navigate = useNavigate();
  const [data, setData] = React.useState<T | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [reloadIndex, setReloadIndex] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }
        if (cause instanceof ApiError && cause.status === 401) {
          clearStoredAdminToken();
          navigate("/login", { replace: true });
          return;
        }
        if (cause instanceof Error) {
          setError(cause.message);
        } else {
          setError("Request failed");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadIndex, ...deps]);

  return {
    data,
    error,
    loading,
    reload: () => setReloadIndex((value) => value + 1),
  };
};
