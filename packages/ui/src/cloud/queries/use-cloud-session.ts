"use client";

import { useCallback, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { CloudApiError } from "../cloud-client";
import { useCloudRuntime } from "../cloud-runtime";
import {
  readStoredToken,
  removeStoredBoolean,
  removeStoredToken,
  writeStoredToken,
} from "../state/cloud-storage";

export const MACHINES_ONBOARDING_STORAGE_KEY_SUFFIX = ":machines-onboarding-shown";

export const isAuthFailure = (error: unknown): boolean =>
  error instanceof CloudApiError && error.status === 401 ||
  (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { readonly status?: unknown }).status === 401
  );

export const useClearCloudSession = (input?: { readonly redirectToLogin?: () => void }) => {
  const { accessStore, authStore, machinesStore, storageKey } = useCloudRuntime();
  const queryClient = useQueryClient();
  const redirectToLogin = input?.redirectToLogin;

  return useCallback(() => {
    removeStoredToken(storageKey);
    removeStoredBoolean(`${storageKey}${MACHINES_ONBOARDING_STORAGE_KEY_SUFFIX}`);
    authStore.getState().clear();
    machinesStore.getState().reset();
    accessStore.getState().reset();
    queryClient.clear();
    redirectToLogin?.();
  }, [accessStore, authStore, machinesStore, queryClient, redirectToLogin, storageKey]);
};

export const useBootstrapAuth = (input?: { readonly onAuthFailure?: () => void }): void => {
  const { authStore, client, storageKey } = useCloudRuntime();
  const clearSession = useClearCloudSession({ redirectToLogin: input?.onAuthFailure });

  useEffect(() => {
    const storedToken = readStoredToken(storageKey);

    if (storedToken === null) {
      authStore.getState().clear();
      return;
    }

    let isCurrent = true;
    authStore.getState().setChecking(storedToken);

    void client.me(storedToken)
      .then((response) => {
        if (isCurrent) {
          authStore.getState().setAuthenticatedSession({
            token: storedToken,
            user: response.user,
          });
        }
      })
      .catch(() => {
        if (isCurrent) {
          clearSession();
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [authStore, clearSession, client, storageKey]);
};

export const useLoginMutation = () => {
  const { authStore, client, storageKey } = useCloudRuntime();

  return useMutation({
    mutationFn: (input: { readonly email: string; readonly password: string }) => client.login(input),
    onSuccess: (response) => {
      writeStoredToken(storageKey, response.session.token);
      authStore.getState().setPendingLoginSession({
        token: response.session.token,
        user: response.user,
      });
    },
  });
};

export const useLogoutMutation = (input?: { readonly onLogout?: () => void }) => {
  const { authStore, client } = useCloudRuntime();
  const clearSession = useClearCloudSession({ redirectToLogin: input?.onLogout });

  return useMutation({
    mutationFn: async () => {
      const currentToken = authStore.getState().token;
      clearSession();

      if (currentToken !== null) {
        await client.logout(currentToken);
      }
    },
  });
};
