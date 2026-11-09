// Validación del JWT del portal en el gateway (defensa en profundidad).
// Mismas reglas que los servicios: HS256, iss=gimnasio, aud=gimnasio-web, sub/rol y vigencia.
// Los servicios siguen validando la sesión y los permisos por rol; el gateway solo
// corta antes las solicitudes sin una sesión válida, sin depender de otro servicio.
const crypto = require('crypto');

const secreto = process.env.AUTH_JWT_SECRET || '';
const ttl = Number(process.env.AUTH_JWT_TTL_SECONDS || 3600);

function decodificar(parte) {
  return JSON.parse(Buffer.from(parte, 'base64url').toString());
}

function jwtValido(r) {
  if (secreto.length < 32) return '0';
  const header = r.headersIn.Authorization || '';
  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header);
  if (!match) return '0';
  try {
    const firma = crypto.createHmac('sha256', secreto).update(match[1] + '.' + match[2]).digest('base64url');
    if (firma !== match[3]) return '0';
    const cabecera = decodificar(match[1]);
    const claims = decodificar(match[2]);
    const ahora = Date.now() / 1000;
    if (cabecera.alg !== 'HS256' || claims.iss !== 'gimnasio' || claims.aud !== 'gimnasio-web'
      || typeof claims.sub !== 'string' || !claims.sub
      || (claims.rol !== 'SOCIO' && claims.rol !== 'ADMIN')
      || typeof claims.iat !== 'number' || typeof claims.exp !== 'number'
      || claims.exp <= ahora || ahora >= claims.iat + ttl) return '0';
    return '1';
  } catch (e) {
    return '0';
  }
}

export default { jwtValido };
