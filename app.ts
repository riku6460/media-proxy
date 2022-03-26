interface ResizeData {
  data: Buffer;
  contentType: string;
}

import 'source-map-support/register';
import * as http from 'http';
import * as url from 'url';
import * as bent from 'bent';
import * as sharp from 'sharp';
import * as FFmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as stream from 'stream';

const gifResize = require('@gumlet/gif-resize');

const ALLOWED_CONTENT_TYPE_PREFIXES = [
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

const copyHeaders = (keys: string[], from: http.IncomingHttpHeaders, to: http.OutgoingHttpHeaders) => {
  for (const key of keys) {
    to[key] = from[key];
    if (!to[key]) {
      delete to[key];
    }
  }
}

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
    if (ALLOWED_CONTENT_TYPE_PREFIXES.every(prefix => !contentType.startsWith(prefix))) {
      res.writeHead(301, {Location: reqUrl});
      res.end();
      return;
    }

    const headers: http.OutgoingHttpHeaders = {};
    if (parse.query.thumbnail === '1') {
      let resized: ResizeData;
      if (contentType.startsWith('image/')) {
        let body = Buffer.of();
        for await (const chunk of response) {
          body = Buffer.concat([body, chunk]);
        }
        resized = contentType === 'image/gif' ? {
          data: await gifResize({width: 280, height: 280})(body),
          contentType
        } : await resize(body);
      } else if (contentType.startsWith('video/')) {
        const rand = Math.random().toString(32).substring(2);
        const original = `${rand}-org`;
        const output = `${rand}.jpg`;
        try {
          await stream.promises.pipeline(response, fs.createWriteStream(original));
          await new Promise((resolve, reject) => {
            FFmpeg(original)
              .on('end', resolve)
              .on('error', reject)
              .screenshot({filename: output, count: 1});
          });
          resized = await resize(output);
        } finally {
          await Promise.allSettled([fs.promises.unlink(original), fs.promises.unlink(output)]);
        }
      } else {
        res.writeHead(301, {Location: reqUrl});
        res.end();
        return;
      }
      headers['Content-Type'] = resized.contentType;
      res.writeHead(200, headers);
      res.end(resized.data);
    } else {
      copyHeaders([
        'content-type',
        'content-disposition',
        'content-length',
        'etag',
        'last-modified',
        'x-amz-request-id'
      ], response.headers, headers);
      res.writeHead(200, headers);
      await stream.promises.pipeline(response, res);
    }
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end();
    return;
  }
}).listen(3000);
