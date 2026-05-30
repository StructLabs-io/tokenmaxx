'use strict';
/**
 * brave-cookies.js — Read cookies from Brave browser profile on disk (macOS)
 *
 * No browser needs to be open. Reads the SQLite cookie DB directly, decrypts
 * values using the macOS Keychain master password (Brave Safe Storage).
 *
 * Encryption scheme (Brave / Chromium on macOS):
 *   1. Master password from Keychain: `security find-generic-password -w -s "Brave Safe Storage"`
 *   2. AES key: PBKDF2(password, salt='saltysalt', iterations=1003, keylen=16, sha1)
 *   3. Decrypt: AES-128-CBC, IV = 0x20 × 16
 *   4. Encrypted value prefix 'v10' (3 bytes) is stripped before decryption
 *   5. Result is UTF-8 string with PKCS#7 padding stripped
 *
 * Requires: better-sqlite3 (npm install better-sqlite3)
 * macOS only — Keychain lookup via `security` CLI.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Default Brave profile path on macOS
const DEFAULT_BRAVE_COOKIE_PATH = path.join(
  os.homedir(),
  'Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies'
);

const PBKDF2_SALT = 'saltysalt';
const PBKDF2_ITERATIONS = 1003;
const PBKDF2_KEYLEN = 16;
const AES_IV = Buffer.alloc(16, 0x20); // 16 space characters

let _cachedKey = null;

/**
 * Get (and cache) the AES decryption key derived from the Brave Keychain password.
 * @returns {Buffer} 16-byte AES key
 */
function getDecryptionKey() {
  if (_cachedKey) return _cachedKey;

  let rawPassword;
  try {
    rawPassword = execSync('security find-generic-password -w -s "Brave Safe Storage"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    throw new Error(
      `Failed to read Brave Safe Storage password from macOS Keychain.\n` +
      `This only works on macOS with Brave installed.\n` +
      `Underlying error: ${err.message}`
    );
  }

  _cachedKey = crypto.pbkdf2Sync(rawPassword, PBKDF2_SALT, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, 'sha1');
  return _cachedKey;
}

/**
 * Decrypt a Chromium-encrypted cookie value.
 *
 * Chromium v10 format on macOS (AES-128-CBC):
 *   encrypted_value = "v10" (3 bytes) + ciphertext
 *   ciphertext decrypts to: 16-byte garbage block + 16-byte metadata block + actual value + PKCS7 padding
 *   The first 32 bytes of decrypted output are always discarded — they contain CBC artifacts
 *   from the fixed IV and a random salt that Chromium embeds in the plaintext.
 *
 * @param {Buffer} encryptedBuf
 * @returns {string} decrypted value
 */
function decryptCookieValue(encryptedBuf) {
  // Prefix is 'v10' (3 bytes ASCII)
  const prefix = encryptedBuf.slice(0, 3).toString('ascii');
  if (prefix !== 'v10') {
    throw new Error(`Unknown encryption prefix: "${prefix}" — only v10 supported on macOS`);
  }
  const ciphertext = encryptedBuf.slice(3);
  const key = getDecryptionKey();
  // Use no auto-padding so we can handle the stripping manually
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, AES_IV);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Strip first 32 bytes: 16-byte CBC IV-corrupted block + 16-byte Chromium salt prefix
  const withoutPrefix = decrypted.slice(32);

  // Strip PKCS7 padding manually
  const padLen = withoutPrefix[withoutPrefix.length - 1];
  if (padLen > 0 && padLen <= 16) {
    return withoutPrefix.slice(0, withoutPrefix.length - padLen).toString('utf8');
  }
  return withoutPrefix.toString('utf8');
}

/**
 * Get the path to the Brave cookie DB, copying it to a temp file to avoid lock issues.
 * @returns {string} path to the temp copy
 */
function getCookieDbCopy() {
  const dbPath = process.env.BRAVE_PROFILE_PATH || DEFAULT_BRAVE_COOKIE_PATH;

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `Brave cookie DB not found at: ${dbPath}\n` +
      `Set BRAVE_PROFILE_PATH env var to override the default location.`
    );
  }

  const tmpPath = '/tmp/brave-cookies-tmp.db';
  fs.copyFileSync(dbPath, tmpPath);
  return tmpPath;
}

/**
 * Query cookie rows from the Brave SQLite DB.
 * @param {string} domain - e.g. 'claude.ai' or '.claude.ai' or a partial match
 * @param {string[]} names - cookie names to fetch (empty = fetch all for domain)
 * @returns {Array<{name: string, value: string, encrypted_value: Buffer, host_key: string}>}
 */
function queryCookieRows(domain, names) {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    throw new Error('better-sqlite3 is required: run `npm install better-sqlite3` in the tokenmaxx directory');
  }

  const tmpPath = getCookieDbCopy();
  const db = new Database(tmpPath, { readonly: true, fileMustExist: true });

  let sql, params;
  if (names && names.length > 0) {
    const placeholders = names.map(() => '?').join(', ');
    sql = `
      SELECT name, value, encrypted_value, host_key
      FROM cookies
      WHERE host_key LIKE ?
        AND name IN (${placeholders})
    `;
    params = [`%${domain}`, ...names];
  } else {
    sql = `
      SELECT name, value, encrypted_value, host_key
      FROM cookies
      WHERE host_key LIKE ?
    `;
    params = [`%${domain}`];
  }

  const rows = db.prepare(sql).all(...params);
  db.close();
  return rows;
}

/**
 * Resolve a single cookie row to its plaintext value.
 * @param {{name: string, value: string, encrypted_value: Buffer}} row
 * @returns {string|null}
 */
function resolveRowValue(row) {
  const encBuf = row.encrypted_value;

  // Non-empty encrypted_value that starts with 'v10' — decrypt
  if (encBuf && encBuf.length > 3) {
    const prefix = encBuf.slice(0, 3).toString('ascii');
    if (prefix === 'v10') {
      try {
        return decryptCookieValue(encBuf);
      } catch (e) {
        // Fall through to plaintext fallback
        console.warn(`[brave-cookies] Failed to decrypt "${row.name}": ${e.message}`);
        return null;
      }
    }
  }

  // Plaintext fallback
  if (row.value) return row.value;

  return null;
}

/**
 * Get a single cookie value from the Brave browser profile.
 *
 * @param {string} domain - e.g. 'claude.ai' or '.claude.ai'
 * @param {string} name - cookie name e.g. 'sessionKey'
 * @returns {Promise<string|null>} decrypted cookie value, or null if not found
 */
async function getBraveCookie(domain, name) {
  const rows = queryCookieRows(domain, [name]);
  if (!rows || rows.length === 0) return null;
  return resolveRowValue(rows[0]);
}

/**
 * Get multiple cookies for a domain in one DB read.
 *
 * @param {string} domain - e.g. 'claude.ai'
 * @param {string[]} names - cookie names to fetch
 * @returns {Promise<Record<string, string|null>>} map of name -> value (null if not found)
 */
async function getBraveCookies(domain, names) {
  const rows = queryCookieRows(domain, names);

  // Build name -> row map (last row wins if there are duplicates)
  const rowMap = {};
  for (const row of rows) {
    rowMap[row.name] = row;
  }

  const result = {};
  for (const name of names) {
    if (rowMap[name]) {
      result[name] = resolveRowValue(rowMap[name]);
    } else {
      result[name] = null;
    }
  }
  return result;
}

module.exports = { getBraveCookie, getBraveCookies };
