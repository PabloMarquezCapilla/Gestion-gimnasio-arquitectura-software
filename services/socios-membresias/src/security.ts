import crypto from 'node:crypto';

/**
 * Genera un hash criptográfico seguro utilizando scrypt con salt aleatorio de 16 bytes.
 * Formato resultante: salt:hash (ambos en hexadecimal)
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Compara en tiempo constante (timingSafeEqual) una contraseña en texto plano contra el hash almacenado.
 */
export function verifyPassword(password: string, storedHash?: string): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  try {
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    if (keyBuffer.length !== derivedKey.length) return false;
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

export function clavesIguales(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function configuracionAuth(options: {
  jwtSecret?: string;
  internalApiKey?: string;
  jwtTtlSeconds?: number;
} = {}) {
  const jwtSecret = options.jwtSecret ?? process.env.AUTH_JWT_SECRET;
  const internalApiKey = options.internalApiKey ?? process.env.SERVICIOS_API_KEY;
  const jwtTtlSeconds = options.jwtTtlSeconds ?? Number(process.env.AUTH_JWT_TTL_SECONDS ?? 3600);
  if (typeof jwtSecret !== 'string' || jwtSecret.trim().length < 32) {
    throw new Error('AUTH_JWT_SECRET debe contener al menos 32 caracteres y no tiene valor predeterminado.');
  }
  if (typeof internalApiKey !== 'string' || !internalApiKey.trim()) {
    throw new Error('SERVICIOS_API_KEY es obligatoria y no tiene valor predeterminado.');
  }
  if (!Number.isSafeInteger(jwtTtlSeconds) || jwtTtlSeconds < 1) {
    throw new Error('AUTH_JWT_TTL_SECONDS debe ser un entero positivo.');
  }
  return { jwtSecret, internalApiKey, jwtTtlSeconds };
}
