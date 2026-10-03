# Sistema integral de gestión de gimnasio

Trabajo Práctico Integrador — Arquitectura de Software 2026

## Integrantes

- Lorenzo Rossi
- Javier Baudino
- Pablo Marquez

## Dominio

Sistema integral de gestión de gimnasios orientado a membresías, pagos y facturación, reserva de clases, control de acceso y ocupación de sedes.

## Objetivo

Construir una plataforma que permita gestionar el ciclo completo de un socio dentro de un gimnasio: contratación y vigencia de membresías, pagos y facturación, búsqueda y reserva de actividades con cupos limitados, control de ingreso y consulta de ocupación de las sedes.

## Alcance preliminar

El sistema contemplará inicialmente:

- Gestión de socios y membresías.
- Planes con distintos beneficios, vigencias y restricciones.
- Registro de pagos, renovaciones, vencimientos y facturación.
- Búsqueda de clases por actividad, sede, profesor, día y horario.
- Reserva de clases con capacidad limitada.
- Lista de espera cuando una clase no tenga cupos disponibles.
- Cancelación de reservas y reasignación de cupos.
- Control de acceso al gimnasio según el estado de la membresía.
- Registro de ingresos y egresos.
- Consulta de ocupación actual de cada sede.

## Reglas de negocio preliminares

- Un socio solo puede acceder al gimnasio si posee una membresía habilitada.
- Una clase no puede superar su capacidad máxima.
- Un mismo socio no puede reservar dos veces la misma clase.
- Si se libera un cupo, podrá asignarse al siguiente socio de la lista de espera.
- Un pago confirmado no debe registrarse dos veces.
- Los cambios de estado de una membresía tienen consecuencias sobre reservas y accesos.

## Necesidades arquitectónicas identificadas

El dominio fue ampliado para que los requisitos técnicos del trabajo surjan de necesidades reales del negocio:

- **Base de datos relacional:** membresías, planes, pagos, facturas, clases y reservas, donde se requieren relaciones, integridad y transacciones.
- **Base de datos no relacional:** historial de accesos y eventos de asistencia, orientado a alto volumen de registros.
- **Motor de búsqueda:** búsqueda de clases con paginación, filtros y ordenamiento.
- **Caché:** lecturas frecuentes como ocupación actual de las sedes y otros datos de consulta repetitiva.
- **Consistencia y concurrencia:** reserva del último cupo disponible y procesamiento idempotente de pagos.
- **Mensajería asíncrona:** eventos como reserva confirmada, cancelación, promoción desde lista de espera y cambios de membresía.

## Operación crítica preliminar

La reserva de una clase con cupos limitados será una de las operaciones críticas del sistema. Si dos usuarios intentan reservar el último cupo al mismo tiempo, el sistema deberá garantizar que solo uno obtenga la reserva y que nunca se supere la capacidad máxima.

## Estado

Instancia inicial — 02/10/2026.

Dominio y alcance preliminar sujetos a aprobación de la cátedra.
