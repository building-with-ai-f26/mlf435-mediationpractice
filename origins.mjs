// Origins and hosts the server accepts. localhost and 127.0.0.1 are the same machine.
export function allowedOrigins(port) {
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

export function isOriginAllowed(origin, port) {
  return allowedOrigins(port).includes(origin);
}
