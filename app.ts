require('source-map-support').install();

import * as http from 'http';
import * as url from 'url';
import * as request from 'request-promise-native';
import * as sharp from 'sharp';

const whitelist = [
  'image/',
  'video/',
  'audio/'
];

http.createServer(async (req, res) => {
  if (req.url === undefined) {
    res.writeHead(500);
    res.end();
    return;
  }
  const parse = url.parse(req.url, true);
  const isThumbnail = parse.pathname === '/thumbnail';
  if (parse.pathname !== '/' && !isThumbnail) {
    res.writeHead(400);
    res.end();
    return;
  }
  const reqUrl = parse.query.url as string;
  if (!reqUrl) {
    res.writeHead(400);
    res.end();
    return;
  }

  try {
    const response: request.FullResponse = await request.get(reqUrl, {encoding: null, resolveWithFullResponse: true});
    if (response.statusCode !== 200) {
      res.writeHead(502);
      res.end();
      return;
    }
    const contentType = response.headers['content-type'] as string;
    if (whitelist.find(value => contentType.startsWith(value)) === undefined) {
      res.writeHead(301, {Location: reqUrl});
      res.end();
      return;
    }
    let body = response.body;
    if (isThumbnail) {
      if (contentType.startsWith('image/')) {
        body = await sharp(response.body)
          .resize(280, 280, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({quality: 30}).toBuffer();
      } else {
        res.writeHead(301, {Location: reqUrl});
        res.end();
        return;
      }
    }
    res.end(body);
  } catch (e) {
    res.writeHead(502);
    res.end();
    return;
  }
}).listen(3000);
