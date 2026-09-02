const http = require('http');

// Login first
const loginBody = JSON.stringify({ email: 'demo@bugradar.dev', password: 'demo1234' });
const loginReq = http.request({
  hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) }
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const login = JSON.parse(data);
    const token = login.accessToken;
    
    // Get orgs
    http.get({ hostname: 'localhost', port: 3000, path: '/api/auth/me', headers: { Authorization: 'Bearer ' + token } }, (res2) => {
      let d2 = '';
      res2.on('data', c => d2 += c);
      res2.on('end', () => {
        const me = JSON.parse(d2);
        const orgId = me.organizations[0].id;
        
        // Get projects
        http.get({ hostname: 'localhost', port: 3000, path: '/api/projects/org/' + orgId, headers: { Authorization: 'Bearer ' + token } }, (res3) => {
          let d3 = '';
          res3.on('data', c => d3 += c);
          res3.on('end', () => {
            const projs = JSON.parse(d3);
            const projId = projs[0].id;
            console.log('Project:', projId);
            
            // Get issues
            http.get({ hostname: 'localhost', port: 3000, path: '/api/issues/project/' + projId + '?limit=2', headers: { Authorization: 'Bearer ' + token } }, (res4) => {
              let d4 = '';
              res4.on('data', c => d4 += c);
              res4.on('end', () => {
                console.log('Status:', res4.statusCode);
                console.log('Response:', d4.substring(0, 200));
                process.exit();
              });
            }).on('error', e => { console.error(e); process.exit(1); });
          });
        }).on('error', e => { console.error(e); process.exit(1); });
      });
    }).on('error', e => { console.error(e); process.exit(1); });
  });
});
loginReq.write(loginBody);
loginReq.end();
