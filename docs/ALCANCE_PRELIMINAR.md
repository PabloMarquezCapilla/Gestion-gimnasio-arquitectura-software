# Alcance preliminar

## Problema

Un gimnasio necesita centralizar la administración de sus socios y, al mismo tiempo, controlar operaciones que tienen impacto directo en el negocio: vigencia de membresías, pagos, reservas de clases con capacidad limitada e ingresos a las sedes.

Una solución limitada únicamente a un CRUD de membresías no alcanza para representar estos flujos. Por eso, el dominio se amplía a un sistema integral de gestión del gimnasio.

## Actores preliminares

### Socio
Puede consultar su membresía, buscar clases, reservar o cancelar actividades y consultar el estado de sus operaciones.

### Administrador
Gestiona planes, clases, sedes y consulta información operativa del gimnasio.

### Personal de recepción
Valida el acceso de los socios y puede consultar el estado de una membresía cuando sea necesario.

## Capacidades principales

### Membresías
- Alta de membresía.
- Renovación.
- Suspensión.
- Vencimiento.
- Validación de beneficios y restricciones del plan.

### Pagos y facturación
- Registro y confirmación de pagos.
- Evitar duplicación de operaciones.
- Asociación entre pago, socio y membresía.
- Emisión/registro de factura.

### Clases y reservas
- Publicación de clases y horarios.
- Capacidad máxima.
- Reserva y cancelación.
- Lista de espera.
- Reasignación de cupos.

### Búsqueda
La entidad principal para la búsqueda será **Clase/Actividad**.

Criterios preliminares:
- texto: nombre o tipo de actividad;
- sede;
- profesor;
- día;
- franja horaria;
- disponibilidad;
- nivel o categoría.

La búsqueda deberá admitir paginación y ordenamiento.

### Control de acceso
Cada intento de ingreso validará el estado de la membresía. El sistema registrará el resultado del acceso y mantendrá información de ocupación de la sede.

## Datos y persistencia preliminar

### Relacional
Adecuado para:
- socios;
- planes;
- membresías;
- pagos;
- facturas;
- clases;
- reservas;
- lista de espera.

Motivo: relaciones fuertes, restricciones, integridad y necesidad de operaciones transaccionales.

### No relacional
Adecuado para:
- eventos de acceso;
- historial de asistencia;
- eventos operativos asociados al ingreso/egreso.

Motivo: volumen de eventos y patrón de escritura/consulta basado principalmente en socio, sede y tiempo.

## Caché preliminar

Se propone utilizar caché para el flujo de lectura de **ocupación actual por sede**, debido a que será consultado frecuentemente mientras que su valor puede derivarse de los eventos de ingreso y egreso.

La utilidad de la caché deberá validarse posteriormente mediante métricas comparativas de latencia y carga sobre el almacenamiento principal.

## Operación con consistencia

**Reservar el último cupo de una clase.**

Condiciones:
1. la membresía debe permitir la reserva;
2. el socio no debe tener una reserva duplicada;
3. la clase debe disponer de cupo;
4. ante solicitudes concurrentes nunca se podrá superar la capacidad máxima.

## Fuera de alcance inicial

Para evitar ampliar innecesariamente el proyecto, inicialmente quedan fuera:
- seguimiento de rutinas de entrenamiento;
- nutrición;
- progreso corporal;
- tienda de productos;
- red social del gimnasio.

Estos elementos podrán evaluarse más adelante si aportan valor al dominio o a algún requisito arquitectónico.
