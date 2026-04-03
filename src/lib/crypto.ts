import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY env var is required");
  }
  // Key must be 32 bytes for AES-256. Accept hex-encoded or raw.
  if (key.length === 64) {
    return Buffer.from(key, "hex");
  }
  return crypto.createHash("sha256").update(key).digest();
}

/**
 * Encrypt a plaintext string. Returns "iv:ciphertext:tag" in hex.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${encrypted}:${tag.toString("hex")}`;
}

/**
 * Decrypt an "iv:ciphertext:tag" hex string back to plaintext.
 */
export function decrypt(encryptedStr: string): string {
  const key = getKey();
  const [ivHex, ciphertext, tagHex] = encryptedStr.split(":");

  if (!ivHex || !ciphertext || !tagHex) {
    throw new Error("Invalid encrypted string format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
