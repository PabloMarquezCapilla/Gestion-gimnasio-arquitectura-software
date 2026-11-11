import cliente from '../services/tienda/dist/clients/fav-catalogo.client.js';

const { FavError, HttpFavCatalogoClient, favCatalogoConfigDesdeEntorno } = cliente;
const baseUrl = 'https://fav-ucc.chilecentral.cloudapp.azure.com';
let operacion = 'configuración';
try {
  const config = favCatalogoConfigDesdeEntorno({
    ...process.env,
    FAV_CATALOGO_BASE_URL: baseUrl,
  });
  const fav = new HttpFavCatalogoClient(config);
  operacion = 'GET /v1/productos';
  const productos = await fav.listarProductos();
  const variantes = productos.flatMap(producto => producto.variantes);
  if (!variantes.length) throw new Error('El catálogo no contiene variantes.');
  console.log(`${operacion}: HTTP 200, contrato 1.2.0 válido, ${productos.length} productos y ${variantes.length} variantes.`);

  operacion = 'GET /v1/disponibilidad';
  const ids = variantes.slice(0, 10).map(variante => variante.varianteId);
  const disponibilidad = await fav.consultarDisponibilidad(ids);
  console.log(`${operacion}: HTTP 200, contrato 1.2.0 válido para ${disponibilidad.length} variantes.`);
  console.table(variantes.slice(0, ids.length).map((variante, indice) => ({
    ...variante, disponibleOnline: disponibilidad[indice].disponible,
  })));
} catch (error) {
  const estado = error instanceof FavError
    ? [error.estadoHttpFav && `HTTP ${error.estadoHttpFav}`, error.codigoFav].filter(Boolean).join(' ')
    : operacion === 'configuración'
      ? 'Verificá FAV_CATALOGO_API_KEY y FAV_CATALOGO_TIMEOUT_MS.'
      : 'El catálogo no contiene variantes.';
  console.error(`${operacion}: ${estado}`);
  process.exitCode = 1;
}
