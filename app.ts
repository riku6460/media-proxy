require('source-map-support').install();

import * as http from 'http';
import * as url from 'url';
import * as request from 'request-promise-native';
import * as sharp from 'sharp';
import * as FFmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';

const whitelist = [
  'image/',
  'video/',
  'audio/'
];

const resize = async (src: string | Buffer): Promise<Buffer> => {
  return await sharp(src)
    .resize(280, 280, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({quality: 85}).toBuffer();
};

http.createServer(async (req, res) => {
  if (req.url === undefined) {
    res.writeHead(500);
    res.end();
    return;
  }
  const parse = url.parse(req.url, true);
  const reqUrl = parse.query.url as string;
  if (!reqUrl) {
    res.writeHead(400);
    res.end();
    return;
  }

  try {
    const response: request.FullResponse = await request.get(reqUrl, {
      encoding: null,
      resolveWithFullResponse: true,
      headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36'}
    });
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
    let body = response.body as Buffer;
    let returnContentType = contentType;
    if (parse.query.thumbnail === '1') {
      if (contentType.startsWith('image/')) {
        body = await resize(body);
      } else if (contentType.startsWith('video/')) {
        const rand = Math.random().toString(32).substring(2);
        const original = `${rand}-org.jpg`;
        const output = `${rand}.jpg`;
        try {
          await new Promise(resolve => fs.writeFile(original, body, resolve));
          await new Promise((resolve, reject) => {
            FFmpeg(original)
              .on('end', resolve)
              .on('error', reject)
              .screenshot({filename: output, count: 1});
          });
          body = await resize(output);
        } finally {
          await new Promise(resolve => fs.unlink(original, resolve));
          await new Promise(resolve => fs.unlink(output, resolve));
        }
      } else {
        res.writeHead(301, {Location: reqUrl});
        res.end();
        return;
      }
      returnContentType = 'image/jpeg';
    }
    res.writeHead(200, {'Content-Type': returnContentType});
    res.end(body);
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end();
    return;
  }
}).listen(3000);
