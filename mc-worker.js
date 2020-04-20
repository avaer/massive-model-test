import {MesherServer} from './mesher.js';

const _flushMessages = () => {
  for (let i = 0; i < queue.length; i++) {
    server.handleMessage(queue[i]);
  }
};

const queue = [];
let loaded = false;
self.wasmModule = (moduleName, moduleFn) => {
  // console.log('wasm module', moduleName, moduleFn);
  if (moduleName === 'mc') {
    self.Module = moduleFn({
      print(text) { console.log(text); },
      printErr(text) { console.warn(text); },
      locateFile(path, scriptDirectory) {
        if (path === 'mc.wasm') {
          return (importScripts.basePath || '') + 'bin/' + path;
        } else {
          return path;
        }
      },
      onRuntimeInitialized: () => {
        loaded = true;
        _flushMessages();
      },
    });

    // console.log('got module', Module);
  } else {
    console.warn('unknown wasm module', moduleName);
  }
};
import('./bin/mc.js')
  .then(() => {
    console.log('loaded wasm');
  })
  .catch(err => {
    console.warn(err.stack);
  });

const server = new MesherServer();

self.onmessage = e => {
  const {data} = e;
  if (!loaded) {
    queue.push(data);
  } else {
    server.handleMessage(data);
  }
};
