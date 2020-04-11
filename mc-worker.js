const width = 10;
const height = 10;
const depth = 10;
// let noiserOffset = 0;
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
importScripts('bin/mc.js');

class Allocator {
  constructor() {
    this.offsets = [];
  }
  alloc(constructor, size) {
    const offset = self.Module._doMalloc(size * constructor.BYTES_PER_ELEMENT);
    const b = new constructor(self.Module.HEAP8.buffer, self.Module.HEAP8.byteOffset + offset, size);
    b.offset = offset;
    this.offsets.push(offset);
    return b;
  }
  freeAll() {
    for (let i = 0; i < this.offsets.length; i++) {
      self.Module._doFree(this.offsets[i]);
    }
    this.offsets.length = 0;
  }
}

const queue = [];
let loaded = false;
const _handleMessage = data => {
  const {method} = data;
  switch (method) {
    case 'chunk': {
      const allocator = new Allocator();

      const {positions: positionsData, normals: normalsData, colors: colorsData, uvs: uvsData, mins: minsData, maxs: maxsData, scales: scaleData, arrayBuffer} = data;
      const positions = allocator.alloc(Float32Array, positionsData.length);
      positions.set(positionsData);
      const normals = allocator.alloc(Float32Array, normalsData.length);
      normals.set(normalsData);
      const colors = allocator.alloc(Float32Array, colorsData.length);
      colors.set(colorsData);
      const uvs = allocator.alloc(Float32Array, uvsData.length);
      uvs.set(uvsData);

      const mins = allocator.alloc(Float32Array, 3);
      mins[0] = minsData[0];
      mins[1] = minsData[1];
      mins[2] = minsData[2];
      const maxs = allocator.alloc(Float32Array, 3);
      maxs[0] = maxsData[0];
      maxs[1] = maxsData[1];
      maxs[2] = maxsData[2];
      const scale = allocator.alloc(Float32Array, 3);
      scale[0] = scaleData[0];
      scale[1] = scaleData[1];
      scale[2] = scaleData[2];

      const numSlots = Math.floor((maxs[0]-mins[0]) / scale[0]) * Math.floor((maxs[2]-mins[2]) / scale[2]);
      const outPositions = allocator.alloc(Uint32Array, numSlots);
      const outNormals = allocator.alloc(Uint32Array, numSlots);
      const outColors = allocator.alloc(Uint32Array, numSlots);
      const outUvs = allocator.alloc(Uint32Array, numSlots);
      for (let i = 0; i < numSlots; i++) {
        outPositions[i] = allocator.alloc(Float32Array, 500*1024).offset;
        outNormals[i] = allocator.alloc(Float32Array, 500*1024).offset;
        outColors[i] = allocator.alloc(Float32Array, 500*1024).offset;
        outUvs[i] = allocator.alloc(Float32Array, 500*1024).offset;
      }
      const outNumPositions = allocator.alloc(Uint32Array, numSlots);
      const outNumNormals = allocator.alloc(Uint32Array, numSlots);
      const outNumColors = allocator.alloc(Uint32Array, numSlots);
      const outNumUvs = allocator.alloc(Uint32Array, numSlots);

      self.Module._doChunk(
        positions.offset,
        positions.length,
        normals.offset,
        normals.length,
        colors.offset,
        colors.length,
        uvs.offset,
        uvs.length,
        mins.offset,
        maxs.offset,
        scale.offset,
        outPositions.offset,
        outNumPositions.offset,
        outNormals.offset,
        outNumNormals.offset,
        outColors.offset,
        outNumColors.offset,
        outUvs.offset,
        outNumUvs.offset
      );

      let index = 0;
      const outPs = Array(numSlots);
      const outNs = Array(numSlots);
      const outCs = Array(numSlots);
      const outUs = Array(numSlots);
      for (let i = 0; i < numSlots; i++) {
        const numP = outNumPositions[i];
        const outP = new Float32Array(self.Module.HEAP8.buffer, self.Module.HEAP8.byteOffset + outPositions[i], numP);
        // console.log('got num', outPositions[i], outNumPositions[i], outP, numP);
        new Float32Array(arrayBuffer, index, numP).set(outP);
        outPs[i] = outP;
        index += Float32Array.BYTES_PER_ELEMENT * numP;

        const numN = outNumNormals[i];
        const outN = new Float32Array(self.Module.HEAP8.buffer, self.Module.HEAP8.byteOffset + outNormals[i], numN);
        new Float32Array(arrayBuffer, index, numN).set(outN);
        outNs[i] = outN;
        index += Float32Array.BYTES_PER_ELEMENT * numN;

        const numC = outNumColors[i];
        const outC = new Float32Array(self.Module.HEAP8.buffer, self.Module.HEAP8.byteOffset + outColors[i], numC);
        new Float32Array(arrayBuffer, index, numC).set(outC);
        outCs[i] = outC;
        index += Float32Array.BYTES_PER_ELEMENT * numC;

        const numU = outNumUvs[i];
        const outU = new Float32Array(self.Module.HEAP8.buffer, self.Module.HEAP8.byteOffset + outUvs[i], numU);
        new Float32Array(arrayBuffer, index, numU).set(outU);
        outUs[i] = outU;
        index += Float32Array.BYTES_PER_ELEMENT * numU;
      }

      self.postMessage({
        result: {
          positions: outPs,
          normals: outNs,
          colors: outCs,
          uvs: outUs,
          arrayBuffer,
        },
      }, [arrayBuffer]);
      allocator.freeAll();
      break;
    }
    /* case 'cut': {
      const allocator = new Allocator();

      const {positions: positionsData, faces: facesData, position: positionData, quaternion: quaternionData, scale: scaleData, arrayBuffer} = data;

      const positions = allocator.alloc(Float32Array, positionsData.length);
      positions.set(positionsData);
      const faces = allocator.alloc(Uint32Array, facesData.length);
      faces.set(facesData);
      const position = allocator.alloc(Float32Array, 3);
      position.set(positionData);
      const quaternion = allocator.alloc(Float32Array, 4);
      quaternion.set(quaternionData);
      const scale = allocator.alloc(Float32Array, 3);
      scale.set(scaleData);

      const outPositions = allocator.alloc(Float32Array, 300*1024/Float32Array.BYTES_PER_ELEMENT);
      const numOutPositions = allocator.alloc(Uint32Array, 2);
      const outFaces = allocator.alloc(Uint32Array, 300*1024/Uint32Array.BYTES_PER_ELEMENT);
      const numOutFaces = allocator.alloc(Uint32Array, 2);

      self.Module._doCut(
        positions.offset,
        positions.length,
        faces.offset,
        faces.length,
        position.offset,
        quaternion.offset,
        scale.offset,
        outPositions.offset,
        numOutPositions.offset,
        outFaces.offset,
        numOutFaces.offset
      );

      let index = 0;
      const outPositions2 = new Float32Array(arrayBuffer, index, numOutPositions[0]);
      outPositions2.set(outPositions.slice(0, numOutPositions[0]));
      index += numOutPositions[0]*Float32Array.BYTES_PER_ELEMENT;
      const outFaces2 = new Uint32Array(arrayBuffer, index, numOutFaces[0]);
      outFaces2.set(outFaces.slice(0, numOutFaces[0]));
      index += numOutFaces[0]*Uint32Array.BYTES_PER_ELEMENT;

      const outPositions3 = new Float32Array(arrayBuffer, index, numOutPositions[1]);
      outPositions3.set(outPositions.slice(numOutPositions[0], numOutPositions[0] + numOutPositions[1]));
      index += numOutPositions[1]*Float32Array.BYTES_PER_ELEMENT;
      const outFaces3 = new Uint32Array(arrayBuffer, index, numOutFaces[1]);
      outFaces3.set(outFaces.slice(numOutFaces[0], numOutFaces[0] + numOutFaces[1]));
      index += numOutFaces[1]*Uint32Array.BYTES_PER_ELEMENT;

      self.postMessage({
        result: {
          positions: outPositions2,
          faces: outFaces2,
          positions2: outPositions3,
          faces2: outFaces3,
        },
      }, [arrayBuffer]);

      allocator.freeAll();
      break;
    } */
    default: {
      console.warn('unknown method', data.method);
      break;
    }
  }
};
const _flushMessages = () => {
  for (let i = 0; i < queue.length; i++) {
    _handleMessage(queue[i]);
  }
};
self.onmessage = e => {
  const {data} = e;
  if (!loaded) {
    queue.push(data);
  } else {
    _handleMessage(data);
  }
};
