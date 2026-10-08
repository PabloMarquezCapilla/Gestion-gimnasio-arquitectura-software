// Inicialización local: un nodo habilita transacciones; no ofrece redundancia.
const mongoAddress = "mongodb://mongodb:27017/?directConnection=true&serverSelectionTimeoutMS=2000";

class InitializationError extends Error {}

function fail(message) {
  throw new InitializationError(message);
}

function waitFor(check, message) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const result = check();
      if (result) return result;
    } catch {
      // Reintentar el arranque sin imprimir errores que puedan incluir secretos.
    }
    sleep(1000);
  }
  fail(message);
}

try {
  if (!process.env.MONGO_ROOT_PASSWORD || !process.env.ACCESOS_DB_PASSWORD) {
    fail("Faltan las claves de inicialización de MongoDB.");
  }

  const connection = waitFor(() => {
    const candidate = new Mongo(mongoAddress);
    const admin = candidate.getDB("admin");
    if (!admin.auth("root", process.env.MONGO_ROOT_PASSWORD)) return null;
    return admin.runCommand({ ping: 1 }).ok === 1 ? candidate : null;
  }, "MongoDB no está disponible o no acepta las credenciales de .env.");

  const admin = connection.getDB("admin");
  let initialized = false;
  try {
    const status = admin.runCommand({ replSetGetStatus: 1 });
    initialized = status.ok === 1;
    if (initialized && status.set !== "rs0") {
      fail("El volumen contiene un replica set distinto de rs0.");
    }
    if (!initialized && status.code !== 94) {
      fail("No se pudo consultar el estado del replica set.");
    }
  } catch (error) {
    if (error.code !== 94) {
      fail("No se pudo consultar el replica set; comprobar su configuración.");
    }
  }

  if (!initialized) {
    const result = admin.runCommand({
      replSetInitiate: {
        _id: "rs0",
        members: [{ _id: 0, host: "mongodb:27017" }],
      },
    });
    if (result.ok !== 1) fail("No se pudo iniciar el replica set rs0.");
  }

  waitFor(() => admin.runCommand({ hello: 1 }).isWritablePrimary,
    "MongoDB no eligió un primario dentro del plazo de inicialización.");

  const database = connection.getDB("accesos");
  if (!database.getUser("accesos")) {
    database.createUser({
      user: "accesos",
      pwd: process.env.ACCESOS_DB_PASSWORD,
      roles: [{ role: "readWrite", db: "accesos" }],
    });
  }

  const application = new Mongo(mongoAddress).getDB("accesos");
  if (!application.auth("accesos", process.env.ACCESOS_DB_PASSWORD)) {
    fail("La clave de Accesos no coincide con la almacenada; conservar el .env original.");
  }

  print("Replica set rs0 y usuario de Accesos disponibles.");
} catch (error) {
  // Solo nuestros mensajes controlados son imprimibles; omitir errores del motor.
  print(error instanceof InitializationError ? error.message : "Falló la inicialización de MongoDB.");
  quit(1);
}
