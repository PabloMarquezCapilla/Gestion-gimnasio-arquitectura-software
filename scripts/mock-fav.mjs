// Mock local del catálogo de FAV (contrato catalogo-pedidos 1.1.0, fijado en docs/contracts).
// Sirve el ejemplo del contrato y permite simular caídas para la jornada de fallas:
//   POST /__mock/modo {"modo":"normal"|"caido"|"lento"|"invalido"}
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = parse(readFileSync(resolve(root, 'docs/contracts/fav-catalogo-pedidos-1.1.0.openapi.yaml'), 'utf8'));
const port = Number(process.env.MOCK_FAV_PORT ?? 8090);
const apiKey = process.env.MOCK_FAV_API_KEY ?? 'clave-fav-local';
const catalogo = contract.components.examples.Catalogo.value;
let modo = 'normal';

function problema(res, status, codigo, title) {
  res.writeHead(status, { 'Content-Type': 'application/problem+json' });
  res.end(JSON.stringify({ type: `https://fav.example/errores/${codigo.toLowerCase()}`, title, status, codigo }));
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://mock');
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  res.setHeader('X-Correlation-Id', correlationId);
  if (req.method === 'POST' && url.pathname === '/__mock/modo') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { modo = JSON.parse(body).modo; } catch { modo = 'normal'; }
      console.log(JSON.stringify({ evento: 'modo', modo }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ modo }));
    });
    return;
  }
  console.log(JSON.stringify({ metodo: req.method, ruta: url.pathname, modo, correlationId }));
  if (req.headers['x-api-key'] !== apiKey) return problema(res, 401, 'NO_AUTENTICADO', 'No autenticado');
  if (modo === 'caido') return problema(res, 503, 'NO_DISPONIBLE', 'Servicio no disponible');
  const responder = () => {
    if (req.method === 'GET' && url.pathname === '/v1/productos') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(modo === 'invalido' ? { productos: [] } : catalogo));
    }
    if (req.method === 'GET' && url.pathname === '/v1/disponibilidad') {
      const ids = [...new Set((url.searchParams.get('variantes') ?? '').split(',').filter(Boolean))];
      if (!ids.length || ids.length > 200) return problema(res, 400, 'PEDIDO_INVALIDO', 'Pedido inválido');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items: ids.map(varianteId => ({ varianteId, disponible: 10 })) }));
    }
    problema(res, 404, 'PEDIDO_INVALIDO', 'Ruta inexistente');
  };
  if (modo === 'lento') setTimeout(responder, 5000); else responder();
}).listen(port, () => {
  console.log(`Mock de FAV en http://localhost:${port} (X-API-Key: ${apiKey}). Cambiar modo con POST /__mock/modo.`);
});
