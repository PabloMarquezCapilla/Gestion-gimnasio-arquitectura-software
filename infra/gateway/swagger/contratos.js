// Contratos que el gimnasio publica para otros grupos. Los YAML se copian
// sin cambios desde docs/contracts/ al construir la imagen del gateway.
window.ui = SwaggerUIBundle({
  urls: [
    { name: 'FAV · Stock y reposiciones de Tienda (openapi-fav-v1)', url: 'contracts/openapi-fav-v1.yaml' },
    { name: 'Car Cruds · Recepción de empleados (openapi-empleados-v1)', url: 'contracts/openapi-empleados-v1.yaml' }
  ],
  'urls.primaryName': 'FAV · Stock y reposiciones de Tienda (openapi-fav-v1)',
  dom_id: '#swagger-ui',
  deepLinking: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  plugins: [SwaggerUIBundle.plugins.DownloadUrl],
  layout: 'StandaloneLayout'
});
