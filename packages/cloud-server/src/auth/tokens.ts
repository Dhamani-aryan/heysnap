import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const createOpaqueToken = (): string => randomBytes(32).toString("base64url");

export const hashToken = (token: string, secret: string): string =>
  createHmac("sha256", secret).update(token).digest("hex");

export const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};
