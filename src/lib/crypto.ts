import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const CURRENT_VERSION = 1;

/**
 * Key versioning.
 *
 * TOKEN_ENCRYPTION_KEY is the active key (64-char hex, 32 bytes). When you
 * rotate, set TOKEN_ENCRYPTION_KEY to the new value and move the old key
 * to TOKEN_ENCRYPTION_KEY_V<N> (where N = the version it was encrypted under).
 *
 * New encryptions are written as `v<N>:iv:ciphertext:tag`. Legacy values
 * stored as `iv:ciphertext:tag` (no version prefix) are decrypted with the
 * current key for backwards compatibility with rows written before this change.
 *
 * Rotation flow:
 *   1. Generate new 32-byte key, e.g. `openssl rand -hex 32`
 *   2. Move current TOKEN_ENCRYPTION_KEY to TOKEN_ENCRYPTION_KEY_V<current>
 *   3. Set TOKEN_ENCRYPTION_KEY to the new key, bump CURRENT_VERSION here
 *   4. Old tokens decrypt via the version prefix; new writes use the new key
 *   5. Re-encrypt (read + write) eventually to retire old keys
 */
function keyForVersion(version: number): Buffer {
  const envName = version === CURRENT_VERSION
    ? "TOKEN_ENCRYPTION_KEY"
    : `TOKEN_ENCRYPTION_KEY_V${version}`;

  const key = process.env[envName];
  if (!key) {
    throw new Error(`${envName} env var is required (token version v${version})`);
  }
  if (key.length === 64) {
    return Buffer.from(key, "hex");
  }
  return crypto.createHash("sha256").update(key).digest();
}

/**
 * Encrypt a plaintext string. Returns "v<N>:iv:ciphertext:tag" in hex.
 */
export function encrypt(plaintext: string): string {
  const key = keyForVersion(CURRENT_VERSION);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  return `v${CURRENT_VERSION}:${iv.toString("hex")}:${encrypted}:${tag.toString("hex")}`;
}

/**
 * Decrypt a "v<N>:iv:ciphertext:tag" or legacy "iv:ciphertext:tag" hex string.
 */
export function decrypt(encryptedStr: string): string {
  const parts = encryptedStr.split(":");

  let version: number;
  let ivHex: string;
  let ciphertext: string;
  let tagHex: string;

  if (parts.length === 4 && parts[0].startsWith("v")) {
    version = parseInt(parts[0].slice(1), 10);
    [, ivHex, ciphertext, tagHex] = parts;
    if (Number.isNaN(version)) {
      throw new Error("Invalid encrypted string: bad version prefix");
    }
  } else if (parts.length === 3) {
    // Legacy format — pre-versioning. Decrypt with current key.
    version = CURRENT_VERSION;
    [ivHex, ciphertext, tagHex] = parts;
  } else {
    throw new Error("Invalid encrypted string format");
  }

  if (!ivHex || !ciphertext || !tagHex) {
    throw new Error("Invalid encrypted string format");
  }

  const key = keyForVersion(version);
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
