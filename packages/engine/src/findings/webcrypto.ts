// Engine-internal helper. Wraps WebCrypto's verbose `subtle.digest` API.
// D-02: engine uses globalThis.crypto.subtle for hashing — no Node `crypto` import.
// Browser-safe: works wherever the Web Crypto API is present (Node 22+, modern browsers).

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const byte = view[i] ?? 0;
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
