require('source-map-support').install();

import * as http from 'http';
import * as url from 'url';
import * as request from 'request-promise-native';

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
  if (parse.pathname !== '/') {
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
    res.end(response.body);
  } catch (e) {
    res.writeHead(502);
    res.end();
    return;
  }
}).listen(3000);
