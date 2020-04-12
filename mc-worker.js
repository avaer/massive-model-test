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

      const {positions: positionsData, normals: normalsData, colors: colorsData, uvs: uvsData, indices: indicesData, mins: minsData, maxs: maxsData, scales: scaleData, arrayBuffer} = data;
      const positions = allocator.alloc(Float32Array, positionsData.length);
      positions.set(positionsData);
      const normals = allocator.alloc(Float32Array, normalsData.length);
      normals.set(normalsData);
      const colors = allocator.alloc(Float32Array, colorsData.length);
      colors.set(colorsData);
      const uvs = allocator.alloc(Float32Array, uvsData.length);
      uvs.set(uvsData);
      const indices = allocator.alloc(Uint32Array, indicesData.length);
      indices.set(indicesData);

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
      const outFaces = allocator.alloc(Uint32Array, numSlots);
      for (let i = 0; i < numSlots; i++) {
        outPositions[i] = allocator.alloc(Float32Array, 500*1024).offset;
        outNormals[i] = allocator.alloc(Float32Array, 500*1024).offset;
        outColors[i] = allocator.alloc(Float32Array, 500*1024).offset;
        outUvs[i] = allocator.alloc(Float32Array, 500*1024).offset;
        outFaces[i] = allocator.alloc(Uint32Array, 500*1024).offset;
      }
      const outNumPositions = allocator.alloc(Uint32Array, numSlots);
      const outNumNormals = allocator.alloc(Uint32Array, numSlots);
      const outNumColors = allocator.alloc(Uint32Array, numSlots);
      const outNumUvs = allocator.alloc(Uint32Array, numSlots);
      const outNumFaces = allocator.alloc(Uint32Array, numSlots);

      self.Module._doChunk(
        positions.offset,
        positions.length,
        normals.offset,
        normals.length,
        colors.offset,
        colors.length,
        uvs.offset,
        uvs.length,
        indices.offset,
        indices.length,
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
        outNumUvs.offset,
        outFaces.offset,
        outNumFaces.offset
      );

      let index = 0;
      const outPs = Array(numSlots);
      const outNs = Array(numSlots);
      const outCs = Array(numSlots);
      const outUs = Array(numSlots);
      const outIs = Array(numSlots);
      for (let i = 0; i < numSlots; i++) {
        const numP = outNumPositions[i];
        const outP = new Float32Array(self.Module.HEAP8.buffer, self.Module.HEAP8.byteOffset + outPositions[i], numP);
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

        const numI = outNumFaces[i];
        const outI = new Uint32Array(self.Module.HEAP8.buffer, self.Module.HEAP8.byteOffset + outFaces[i], numI);
        new Uint32Array(arrayBuffer, index, numI).set(outI);
        outIs[i] = outI;
        index += Uint32Array.BYTES_PER_ELEMENT * numI;
      }

      self.postMessage({
        result: {
          positions: outPs,
          normals: outNs,
          colors: outCs,
          uvs: outUs,
          indices: outIs,
          arrayBuffer,
        },
      }, [arrayBuffer]);
      allocator.freeAll();
      break;
    }
    case 'decimate': {
      const allocator = new Allocator();

      const {positions: positionsData, normals: normalsData, colors: colorsData, uvs: uvsData, minTris, aggressiveness, base, iterationOffset, arrayBuffer} = data;
      const positions = allocator.alloc(Float32Array, positionsData.length);
      positions.set(positionsData);
      const normals = allocator.alloc(Float32Array, normalsData.length);
      normals.set(normalsData);
      const colors = allocator.alloc(Float32Array, colorsData.length);
      colors.set(colorsData);
      const uvs = allocator.alloc(Float32Array, uvsData.length);
      uvs.set(uvsData);
      const indices = allocator.alloc(Uint32Array, 1024*1024);

      const numPositions = allocator.alloc(Uint32Array, 1);
      numPositions[0] = positions.length;
      const numNormals = allocator.alloc(Uint32Array, 1);
      numNormals[0] = normals.length;
      const numColors = allocator.alloc(Uint32Array, 1);
      numColors[0] = colors.length;
      const numUvs = allocator.alloc(Uint32Array, 1);
      numUvs[0] = uvs.length;
      const numIndices = allocator.alloc(Uint32Array, 1);
      numIndices[0] = indices.length;

      self.Module._doDecimate(
        positions.offset,
        numPositions.offset,
        normals.offset,
        numNormals.offset,
        colors.offset,
        numColors.offset,
        uvs.offset,
        numUvs.offset,
        minTris,
        aggressiveness,
        base,
        iterationOffset,
        indices.offset,
        numIndices.offset
      );

      let index = 0;
      const outP = new Float32Array(arrayBuffer, index, numPositions[0]);
      outP.set(new Float32Array(positions.buffer, positions.byteOffset, numPositions[0]));
      index += Float32Array.BYTES_PER_ELEMENT * positions.length;

      const outN = new Float32Array(arrayBuffer, index, numNormals[0]);
      outN.set(new Float32Array(normals.buffer, normals.byteOffset, numNormals[0]));
      index += Float32Array.BYTES_PER_ELEMENT * normals.length;

      const outC = new Float32Array(arrayBuffer, index, numColors[0]);
      outC.set(new Float32Array(colors.buffer, colors.byteOffset, numColors[0]));
      index += Float32Array.BYTES_PER_ELEMENT * colors.length;

      const outU = new Float32Array(arrayBuffer, index, numUvs[0]);
      outU.set(new Float32Array(uvs.buffer, uvs.byteOffset, numUvs[0]));
      index += Float32Array.BYTES_PER_ELEMENT * uvs.length;

      const outI = new Uint32Array(arrayBuffer, index, numIndices[0]);
      outI.set(new Uint32Array(indices.buffer, indices.byteOffset, numIndices[0]));
      index += Uint32Array.BYTES_PER_ELEMENT * indices.length;

      self.postMessage({
        result: {
          positions: outP,
          normals: outN,
          colors: outC,
          uvs: outU,
          indices: outI,
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
