async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoded = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    encoded.encode(password) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: 200_000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptHotWalletKey(
  secretKey: Uint8Array,
  password: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    secretKey.buffer as ArrayBuffer,
  );
  const packed = new Uint8Array(28 + ciphertext.byteLength);
  packed.set(salt);
  packed.set(iv, 16);
  packed.set(new Uint8Array(ciphertext), 28);
  return btoa(String.fromCharCode(...packed));
}

export async function decryptHotWalletKey(
  encrypted: string,
  password: string,
): Promise<Uint8Array> {
  const packed = Uint8Array.from(atob(encrypted), (character) =>
    character.charCodeAt(0),
  );
  if (packed.length < 45) {
    throw new Error("Stored wallet data is invalid.");
  }
  const key = await deriveKey(password, packed.slice(0, 16));
  const secret = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: packed.slice(16, 28).buffer as ArrayBuffer,
    },
    key,
    packed.slice(28).buffer as ArrayBuffer,
  );
  return new Uint8Array(secret);
}

export async function deriveHotWalletRecoveryKey(
  secret: Uint8Array,
): Promise<CryptoKey> {
  const salt = secret.slice(0, 16);
  const password = Array.from(secret.slice(0, 32))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return deriveKey(password, salt);
}
