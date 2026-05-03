import http from 'http';

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/upload-image',
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data; boundary=---boundary',
  }
};

const req = http.request(options, (res) => {
  console.log('STATUS:', res.statusCode);
  res.on('data', (chunk) => {
    console.log('BODY:', chunk.toString());
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write('-----boundary\r\n');
req.write('Content-Disposition: form-data; name="user_id"\r\n\r\n');
req.write('test\r\n');
req.write('-----boundary\r\n');
req.write('Content-Disposition: form-data; name="image_title"\r\n\r\n');
req.write('title\r\n');
req.write('-----boundary--\r\n');
req.end();
