const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../docs');

const swaggerSetup = (app) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  console.log('📚 Swagger docs at http://localhost:PORT/api-docs');
};

module.exports = { swaggerSetup };
