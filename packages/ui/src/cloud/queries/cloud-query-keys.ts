"use client";

export const cloudQueryKeys = {
  authMe: () => ["cloud", "auth", "me"] as const,
  computers: () => ["cloud", "computers"] as const,
  accessSession: (computerId: string) => ["cloud", "computers", computerId, "access-session"] as const,
};
