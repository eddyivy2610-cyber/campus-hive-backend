import fs from 'fs';
const file = 'controllers/upload.controller.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'console.error("Upload error:", error);',
  'console.error("Upload error:", error);\n        import("fs").then(m => m.writeFileSync("upload_error_log.txt", String(error.stack || error.message)));'
);

fs.writeFileSync(file, content);
console.log('Successfully modified upload.controller.js to log errors to upload_error_log.txt');
