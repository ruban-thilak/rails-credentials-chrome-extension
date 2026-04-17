/**
 * Rails Credentials Decryptor
 *
 * Decrypts Rails ActiveSupport::EncryptedFile content using AES-128-GCM.
 *
 * Rails format:
 *   - Cipher: aes-128-gcm
 *   - Master key: 32-char hex string → 16 raw bytes
 *   - Encrypted file: base64(ciphertext)--base64(iv)--base64(auth_tag)
 *   - Decrypted payload: Ruby Marshal-wrapped YAML string
 */

const RailsDecryptor = (() => {
  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  function base64Decode(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Extract a Ruby string from Marshal binary data.
   * Marshal format for a UTF-8 string:
   *   \x04\x08  (version header: major=4, minor=8)
   *   I         (instance variables follow — used for encoding)
   *   "         (raw string type)
   *   <length>  (Marshal integer encoding)
   *   <bytes>   (string content)
   *   \x06      (1 instance variable follows)
   *   :         (symbol type)
   *   \x06      (symbol name length = 1)
   *   E         (symbol name "E" — shorthand for encoding)
   *   T         (true — meaning UTF-8)
   */
  function extractStringFromMarshal(bytes) {
    let offset = 0;

    if (bytes[0] === 0x04 && bytes[1] === 0x08) {
      offset = 2;
    }

    if (bytes[offset] === 0x49) {
      offset++;
    }

    if (bytes[offset] === 0x22) {
      offset++;
    } else {
      return new TextDecoder().decode(bytes.slice(offset));
    }

    const { value: strLen, bytesRead } = readMarshalInt(bytes, offset);
    offset += bytesRead;

    const strBytes = bytes.slice(offset, offset + strLen);
    return new TextDecoder().decode(strBytes);
  }

  /**
   * Read a Marshal-encoded integer.
   * Marshal uses a compact variable-length encoding:
   *   0        → 0
   *   1..4     → next N bytes as little-endian positive int
   *   -1..-4   → next |N| bytes as little-endian negative int
   *   5..127   → value is (n - 5)
   *   -128..-5 → value is (n + 5)
   */
  function readMarshalInt(bytes, offset) {
    const n = bytes[offset] > 127 ? bytes[offset] - 256 : bytes[offset];
    offset++;

    if (n === 0) {
      return { value: 0, bytesRead: 1 };
    }

    if (n > 0 && n <= 4) {
      let val = 0;
      for (let i = 0; i < n; i++) {
        val |= bytes[offset + i] << (8 * i);
      }
      return { value: val, bytesRead: 1 + n };
    }

    if (n < 0 && n >= -4) {
      const count = -n;
      let val = -1;
      for (let i = 0; i < count; i++) {
        val &= ~(0xff << (8 * i));
        val |= bytes[offset + i] << (8 * i);
      }
      return { value: val, bytesRead: 1 + count };
    }

    if (n > 4) {
      return { value: n - 5, bytesRead: 1 };
    }

    return { value: n + 5, bytesRead: 1 };
  }

  /**
   * Decrypt a Rails encrypted credentials file.
   *
   * @param {string} encryptedContent - The full content of the .yml.enc file
   * @param {string} masterKeyHex - The 32-char hex master key
   * @returns {Promise<string>} The decrypted YAML string
   */
  async function decrypt(encryptedContent, masterKeyHex) {
    const cleaned = encryptedContent.trim();

    const parts = cleaned.split("--");
    if (parts.length !== 3) {
      throw new Error(
        `Invalid Rails encrypted format: expected 3 parts separated by '--', got ${parts.length}`
      );
    }

    const [ciphertextB64, ivB64, authTagB64] = parts;
    const ciphertext = base64Decode(ciphertextB64);
    const iv = base64Decode(ivB64);
    const authTag = base64Decode(authTagB64);

    if (authTag.length !== 16) {
      throw new Error(
        `Invalid auth tag length: expected 16, got ${authTag.length}`
      );
    }

    const keyBytes = hexToBytes(masterKeyHex.trim());
    if (keyBytes.length !== 16) {
      throw new Error(
        `Invalid master key: expected 32 hex chars (16 bytes), got ${masterKeyHex.trim().length} chars`
      );
    }

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    // Web Crypto API expects the auth tag appended to the ciphertext
    const dataWithTag = new Uint8Array(ciphertext.length + authTag.length);
    dataWithTag.set(ciphertext);
    dataWithTag.set(authTag, ciphertext.length);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv, tagLength: 128 },
      cryptoKey,
      dataWithTag
    );

    const decryptedBytes = new Uint8Array(decryptedBuffer);

    // Rails wraps the string in Ruby Marshal format
    if (decryptedBytes[0] === 0x04 && decryptedBytes[1] === 0x08) {
      return extractStringFromMarshal(decryptedBytes);
    }

    return new TextDecoder().decode(decryptedBytes);
  }

  return { decrypt, hexToBytes, base64Decode, extractStringFromMarshal };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = RailsDecryptor;
}
