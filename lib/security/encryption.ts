import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For AES, this is always 16

/**
 * Encrypt PII data using AES-256-GCM
 * @param text - Text to encrypt
 * @param key - Encryption key (should be 32 bytes)
 * @returns Encrypted string in format: iv:tag:ciphertext
 */
export function encryptPII(text: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes');
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Return as a single string: iv:tag:encrypted
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt PII data using AES-256-GCM
 * @param encryptedText - Encrypted text in format: iv:tag:ciphertext
 * @param key - Decryption key (should be 32 bytes)
 * @returns Decrypted string
 */
export function decryptPII(encryptedText: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error('Decryption key must be 32 bytes');
  }

  const [ivHex, tagHex, encryptedHex] = encryptedText.split(':');
  
  if (!ivHex || !tagHex || !encryptedHex) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Generate a 32-byte random encryption key
 * @returns Buffer containing the key
 */
export function generateEncryptionKey(): Buffer {
  return randomBytes(32);
}