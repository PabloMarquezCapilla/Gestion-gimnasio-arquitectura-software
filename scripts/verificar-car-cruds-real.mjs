import cliente from '../services/socios-membresias/dist/clients/car-cruds.client.js';

const { CarCrudsError, HttpCarCrudsClient, carCrudsConfigDesdeEntorno } = cliente;
const employeeId = process.argv[2];
let etapa = 'Configuración';
try {
  const config = carCrudsConfigDesdeEntorno();
  if (!config || new URL(config.baseUrl).protocol !== 'https:') {
    throw new Error('Configurar URL HTTPS y token gym.');
  }
  const proveedor = new HttpCarCrudsClient(config);

  etapa = 'GET /v1/employees';
  const primera = await proveedor.listarEmpleados(1, 20);
  if (primera.total > primera.pageSize) await proveedor.listarEmpleados(2, primera.pageSize);
  console.log(`${etapa}: HTTP 200, esquema compatible con 0.4.0 y paginación validada.`);

  if (employeeId) {
    etapa = 'GET /v1/employees/{id}/status';
    const estado = await proveedor.consultarEstado(employeeId);
    console.log(`${etapa}: HTTP 200, esquema compatible con 0.4.0, activo=${estado.active}.`);
  } else {
    console.log('Estado laboral pendiente del identificador ficticio acordado.');
  }
} catch (error) {
  const detalle = error instanceof CarCrudsError ? error.codigo :
    etapa === 'Configuración' ? 'Verificá CAR_CRUDS_BASE_URL, CAR_CRUDS_TOKEN y CAR_CRUDS_TIMEOUT_MS.' :
      'No se pudo completar la consulta.';
  console.error(`${etapa}: ${detalle}`);
  process.exitCode = 1;
}
