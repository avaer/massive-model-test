#!/bin/bash

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const mkdirp = require('mkdirp');
const express = require('express');

(async () => {

await mkdirp('data');

const app = express();
app.use(express.static(__dirname));
app.get(/^\/d\/(.+)$/, (req, res, next) => {
  const p = path.join('data', req.params[0]);
  const rs = fs.createReadStream(p);
  rs.once('error', err => {
    if (err.code === 'ENOENT') {
      res.end();
    } else {
      console.warn('got error', err.stack);
      res.statusCode = 500;
      res.end(err.stack);
    }
  });
  rs.pipe(res);
});
app.put(/^\/d\/(.+)$/, (req, res, next) => {
  const p = path.join('data', req.params[0]);
  const rs = fs.createWriteStream(p);
  rs.once('error', err => {
    console.warn('got error', err.stack);
    res.statusCode = 500;
    res.end(err.stack);
  });
  rs.once('finish', () => {
    res.end();
  });
  req.pipe(rs);
});

http.createServer(app)
  .listen(3000);

console.log(`http://127.0.0.1:3000`);

})();