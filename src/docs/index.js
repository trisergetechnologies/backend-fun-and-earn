const yamlLoader = require('./yamlLoader');

const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Dual App Backend API',
    version: '1.0.0',
    description: 'Docs for E-Cart and Short Video APIs'
  },
  paths: {
    ...yamlLoader.paths
  },
  components: {
    schemas: {
      ...yamlLoader.components.schemas
    }
  }
};

module.exports = swaggerSpec;
