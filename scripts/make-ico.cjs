const pngToIco = require('png-to-ico');
const fs = require('fs');

pngToIco('assets/icon.png')
  .then(buf => {
    fs.writeFileSync('assets/icon.ico', buf);
    console.log('icon.ico created successfully');
  })
  .catch(err => {
    console.error('Failed:', err);
    process.exit(1);
  });
