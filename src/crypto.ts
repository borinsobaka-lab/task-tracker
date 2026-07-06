// Шифрование ключа доступа паролем (WebCrypto, без внешних зависимостей).
// Пароль -> ключ (PBKDF2, много итераций) -> AES-GCM шифрует токен GitHub.
// Зашифрованный блок публичен (лежит в публичном репозитории), но без пароля
// расшифровать его нельзя. Целостность проверяет тег GCM: неверный пароль ->
// ошибка расшифровки, по ней и понимаем, что пароль неправильный.

const PBKDF2_ITERATIONS = 250_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface EncryptedBlob {
  v: 1
  configured: true
  salt: string // base64
  iv: string // base64
  ct: string // base64 (ciphertext + GCM-тег)
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// TypeScript (с @types/node) считает Uint8Array потенциально SharedArrayBuffer-
// backed, а WebCrypto хочет ArrayBuffer-backed BufferSource — приводим явно.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', bs(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bs(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSecret(secret: string, password: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(password, salt)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(iv) }, key, bs(new TextEncoder().encode(secret)))
  return {
    v: 1,
    configured: true,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ct)),
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Неверный пароль')
    this.name = 'WrongPasswordError'
  }
}

export async function decryptSecret(blob: EncryptedBlob, password: string): Promise<string> {
  const key = await deriveKey(password, b64ToBytes(blob.salt))
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bs(b64ToBytes(blob.iv)) }, key, bs(b64ToBytes(blob.ct)))
    return new TextDecoder().decode(pt)
  } catch {
    throw new WrongPasswordError() // тег GCM не сошёлся — пароль неверный
  }
}

export function isEncryptedBlob(x: unknown): x is EncryptedBlob {
  return (
    !!x &&
    typeof x === 'object' &&
    (x as any).configured === true &&
    typeof (x as any).salt === 'string' &&
    typeof (x as any).iv === 'string' &&
    typeof (x as any).ct === 'string'
  )
}
