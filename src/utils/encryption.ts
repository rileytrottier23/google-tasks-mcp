import crypto from "node:crypto";
import process from "node:process";
import { Buffer } from "node:buffer";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const ITERATIONS = 100000;

const keyCache = new Map<string, Buffer>();

function deriveKey(secret: string, name: string): Buffer {
  if (secret.length < 32) {
    throw new Error(`${name} must be at least 32 characters long`);
  }
  let key = keyCache.get(secret);
  if (!key) {
    const salt = Buffer.from("google-tasks-mcp-salt");
    key = crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_LENGTH, "sha256");
    keyCache.set(secret, key);
  }
  return key;
}

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET environment variable is not set");
  }
  return deriveKey(secret, "ENCRYPTION_SECRET");
}

// During a rotation, set ENCRYPTION_SECRET_PREVIOUS to the old secret so
// tokens saved under it can still be read (and are re-saved under the new
// one). Remove it once every client has reconnected or 30 days have passed.
function getPreviousKey(): Buffer | null {
  const secret = process.env.ENCRYPTION_SECRET_PREVIOUS;
  if (!secret) return null;
  return deriveKey(secret, "ENCRYPTION_SECRET_PREVIOUS");
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  const result = Buffer.concat([salt, iv, tag, Buffer.from(encrypted, "hex")]);
  return result.toString("base64");
}

function decryptWithKey(encryptedData: string, key: Buffer): string {
  const buffer = Buffer.from(encryptedData, "base64");

  const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buffer.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + TAG_LENGTH
  );
  const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted.toString("hex"), "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// Tries the current key, then the previous one if it is set. usedPrevious
// tells the caller to re-encrypt the value under the current key.
export function decryptWithRotation(encryptedData: string): { text: string; usedPrevious: boolean } {
  try {
    return { text: decryptWithKey(encryptedData, getEncryptionKey()), usedPrevious: false };
  } catch (err) {
    const previous = getPreviousKey();
    if (!previous) throw err;
    return { text: decryptWithKey(encryptedData, previous), usedPrevious: true };
  }
}

export function decrypt(encryptedData: string): string {
  return decryptWithRotation(encryptedData).text;
}
