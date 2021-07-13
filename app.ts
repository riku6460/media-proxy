require('source-map-support').install();

interface ResizeData {
  data: Buffer;
  contentType: string;
}

import * as http from 'http';
import * as url from 'url';
import * as bent from 'bent';
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
  return {
    data: await (isOpaque ? resize.jpeg({quality: 85}) : resize.png()).toBuffer(),
    contentType: isOpaque ? 'image/jpeg' : 'image/png'
  };
};

const addHeader = (key: string, value: string | undefined, headers: http.OutgoingHttpHeaders) => {
  headers[key] = value;
  if (!value) {
    delete headers[key];
  }
};

const bentRequest = bent(200, 300, 301, 302, 303, 307, 308, {'User-Agent': 'media-proxy (+https://github.com/riku6460/media-proxy)'});

const request = async (url: string, count: number): Promise<bent.NodeResponse> => {
  const res = await bentRequest(url) as bent.NodeResponse;
  if (res.statusCode === 300 || res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
    if (++count >= 5) {
      throw new Error('Too many redirects!');
    }
    return await request(res.headers.location, count);
  }
  return res;
}

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
    const response = await request(reqUrl, 0) as bent.NodeResponse;
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
    const headers: http.OutgoingHttpHeaders = {};
    if (parse.query.thumbnail === '1') {
      let resized: ResizeData;
      if (contentType.startsWith('image/')) {
        const body: Buffer = await new Promise(resolve => {
          const chunks: Buffer[] = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
        });
        resized = contentType === 'image/gif' ? {
          data: await gifResize({width: 280, height: 280})(body),
          contentType
        } : await resize(body);
      } else if (contentType.startsWith('video/')) {
        const rand = Math.random().toString(32).substring(2);
        const original = `${rand}-org`;
        const output = `${rand}.jpg`;
        try {
          await new Promise(resolve => response.pipe(fs.createWriteStream(original)).on('close', resolve));
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
      addHeader('Content-Type', resized.contentType, headers);
      res.writeHead(200, headers);
      res.end(resized.data);
    } else {
      addHeader('Content-Type', contentType, headers);
      addHeader('Content-Disposition', response.headers['content-disposition'], headers);
      addHeader('Content-Length', response.headers['content-length'], headers);
      addHeader('ETag', response.headers['etag'] as string | undefined, headers);
      addHeader('Last-Modified', response.headers['last-modified'], headers);
      addHeader('x-amz-request-id', response.headers['x-amz-request-id'] as string | undefined, headers);
      res.writeHead(200, headers);
      response.pipe(res);
    }
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end();
    return;
  }
}).listen(3000);
