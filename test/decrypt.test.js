import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";

// Polyfill Web Crypto for Node (vitest runs in Node, not a browser)
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = webcrypto;
}
if (typeof atob === "undefined") {
  globalThis.atob = (s) => Buffer.from(s, "base64").toString("binary");
}

const RailsDecryptor = await import("../decrypt.js").then(
  (m) => m.default || m
);

describe("hexToBytes", () => {
  it("converts a hex string to Uint8Array", () => {
    const result = RailsDecryptor.hexToBytes("deadbeef");
    expect(result).toBeInstanceOf(Uint8Array);
    expect([...result]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("handles a 32-char master key hex string", () => {
    const hex = "0123456789abcdef0123456789abcdef";
    const result = RailsDecryptor.hexToBytes(hex);
    expect(result.length).toBe(16);
  });

  it("returns empty array for empty string", () => {
    expect(RailsDecryptor.hexToBytes("").length).toBe(0);
  });
});

describe("base64Decode", () => {
  it("decodes a base64 string to Uint8Array", () => {
    const result = RailsDecryptor.base64Decode(btoa("hello"));
    expect(new TextDecoder().decode(result)).toBe("hello");
  });

  it("handles binary data", () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const b64 = btoa(String.fromCharCode(...bytes));
    const result = RailsDecryptor.base64Decode(b64);
    expect([...result]).toEqual([0, 1, 2, 255]);
  });
});

describe("extractStringFromMarshal", () => {
  it("extracts a UTF-8 string from Marshal envelope", () => {
    const yaml = "key: value\n";
    const yamlBytes = new TextEncoder().encode(yaml);

    // Build Marshal binary: \x04\x08 I " <len> <data> \x06 : \x06 E T
    const marshalLen = yamlBytes.length;
    const header = new Uint8Array([
      0x04,
      0x08, // version
      0x49, // I (instance vars)
      0x22, // " (raw string)
      marshalLen + 5, // Marshal int encoding for lengths 0..122: value + 5
    ]);
    const trailer = new Uint8Array([
      0x06, // 1 ivar
      0x3a, // : (symbol)
      0x06, // symbol length 1
      0x45, // "E"
      0x54, // T (true = UTF-8)
    ]);

    const full = new Uint8Array(
      header.length + yamlBytes.length + trailer.length
    );
    full.set(header, 0);
    full.set(yamlBytes, header.length);
    full.set(trailer, header.length + yamlBytes.length);

    const result = RailsDecryptor.extractStringFromMarshal(full);
    expect(result).toBe(yaml);
  });

  it("falls back to raw decode when no Marshal header", () => {
    const raw = new TextEncoder().encode("plain text");
    const result = RailsDecryptor.extractStringFromMarshal(raw);
    expect(result).toBe("plain text");
  });
});

describe("decrypt (end-to-end)", () => {
  it("decrypts AES-128-GCM content matching Rails format", async () => {
    const masterKeyHex = "00112233445566778899aabbccddeeff";
    const keyBytes = RailsDecryptor.hexToBytes(masterKeyHex);
    const plaintext = "secret: value123\n";

    // Encrypt with Web Crypto to produce test data in Rails format
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      cryptoKey,
      new TextEncoder().encode(plaintext)
    );

    const encBytes = new Uint8Array(encrypted);
    const ciphertext = encBytes.slice(0, encBytes.length - 16);
    const authTag = encBytes.slice(encBytes.length - 16);

    const toB64 = (arr) => btoa(String.fromCharCode(...arr));
    const railsContent = `${toB64(ciphertext)}--${toB64(iv)}--${toB64(authTag)}`;

    const result = await RailsDecryptor.decrypt(railsContent, masterKeyHex);
    expect(result).toBe(plaintext);
  });

  it("rejects invalid format (wrong number of parts)", async () => {
    await expect(
      RailsDecryptor.decrypt("onlyonepart", "00112233445566778899aabbccddeeff")
    ).rejects.toThrow("expected 3 parts");
  });

  it("rejects invalid master key length", async () => {
    const toB64 = (arr) => btoa(String.fromCharCode(...arr));
    const fakeContent = `${toB64([1, 2, 3])}--${toB64(new Uint8Array(12))}--${toB64(new Uint8Array(16))}`;

    await expect(
      RailsDecryptor.decrypt(fakeContent, "short")
    ).rejects.toThrow("Invalid master key");
  });
});
