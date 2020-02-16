require('source-map-support').install();

interface ResizeData {
  data: Buffer;
  contentType: string;
}

import * as http from 'http';
import * as url from 'url';
import * as request from 'request-promise-native';
import * as sharp from 'sharp';
import * as FFmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
const gifResize = require('@gumlet/gif-resize');

const whitelist = [
  'image/',
  'video/',
  'audio/'
];

const resize = async (src: string | Buffer): Promise<ResizeData> => {
  const isOpaque = (await sharp(src).stats()).isOpaque;
  const resize = sharp(src)
    .resize(280, 280, {
      fit: 'inside',
      withoutEnlargement: true
    });
  return {data: await (isOpaque ? resize.jpeg({quality: 85}) : resize.png()).toBuffer(), contentType: isOpaque ? 'image/jpeg' : 'image/png'};
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
      let resized: ResizeData;
      if (contentType === 'image/gif') {
        resized = {data: await gifResize({width: 280, height: 280})(body), contentType: 'image/gif'};
      } else if (contentType.startsWith('image/')) {
        resized = await resize(body);
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
          resized = await resize(output);
        } finally {
          await new Promise(resolve => fs.unlink(original, resolve));
          await new Promise(resolve => fs.unlink(output, resolve));
        }
      } else {
        res.writeHead(301, {Location: reqUrl});
        res.end();
        return;
      }
      returnContentType = resized.contentType;
      body = resized.data;
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
