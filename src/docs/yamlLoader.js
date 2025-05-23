const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const dirToScan = path.join(__dirname); // Adjust this if needed

let combined = { paths: {}, components: { schemas: {} } };

function getAllYamlFiles(dir) {
  let results = [];

  fs.readdirSync(dir).forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat && stat.isDirectory()) {
      results = results.concat(getAllYamlFiles(fullPath));
    } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      results.push(fullPath);
    }
  });

  return results;
}

const files = getAllYamlFiles(dirToScan);

files.forEach((file) => {
  const doc = YAML.parse(fs.readFileSync(file, 'utf8'));

  if (doc.paths) {
    combined.paths = { ...combined.paths, ...doc.paths };
  }

  if (doc.components?.schemas) {
    combined.components.schemas = {
      ...combined.components.schemas,
      ...doc.components.schemas
    };
  }
});

module.exports = combined;
