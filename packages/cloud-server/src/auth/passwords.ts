import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, KEY_LENGTH) as Buffer;

  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
};

export const verifyPassword = async (password: string, passwordHash: string): Promise<boolean> => {
  const [algorithm, salt, hash] = passwordHash.split(":");

  if (algorithm !== "scrypt" || salt === undefined || hash === undefined) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
};
