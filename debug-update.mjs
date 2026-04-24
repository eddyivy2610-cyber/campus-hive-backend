import fs from 'fs';
const file = 'services/user.service.js';
let content = fs.readFileSync(file, 'utf8');

// Replace standard catch block to write error to a file
content = content.replace(
  'console.error("Update user service error:", error);',
  'console.error("Update user service error:", error);\n        fs.writeFileSync("error_log.txt", String(error.stack || error.message));'
);

fs.writeFileSync(file, content);
console.log('Successfully modified user.service.js to log errors to error_log.txt');
