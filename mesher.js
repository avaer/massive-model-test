import THREE from './three.module.js';
import maxrects from './maxrects-packer.min.js';
import {XRRaycaster} from './spatial-engine.js';

const NUM_POSITIONS = 8 * 1024 * 1024;
const TEXTURE_SIZE = 4*1024;
const CHUNK_SIZE = 16;

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localColor = new THREE.Color();
const localColor2 = new THREE.Color();

function mod(a, n) {
  return ((a%n)+n)%n;
}

let voxelWidth = 0;
let voxelSize = 0;
let voxelResolution = 0;
let pixelRatio = 0;
let canvas = null;
let renderer = null;
let xrRaycaster = null;
const scene = new THREE.Scene();
// scene.autoUpdate = false;

const ambientLight = new THREE.AmbientLight(0xFFFFFF);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xFFFFFF, 3);
directionalLight.position.set(0.5, 1, 0.5).multiplyScalar(100);
/* directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 500; */
scene.add(directionalLight);

const directionalLight2 = new THREE.DirectionalLight(0xFFFFFF, 3);
directionalLight2.position.set(-0.5, -0.1, 0.5).multiplyScalar(100);
scene.add(directionalLight2);

const depthMaterial = (() => {
  const depthVsh = `
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
    }
  `;
  const depthFsh = `
    uniform float uNear;
    uniform float uFar;
    vec4 encodePixelDepth( float v ) {
      float x = fract(v);
      v -= x;
      v /= 255.0;
      float y = fract(v);
      v -= y;
      v /= 255.0;
      float z = fract(v);
      /* v -= y;
      v /= 255.0;
      float w = fract(v);
      float w = 0.0;
      if (x == 0.0 && y == 0.0 && z == 0.0 && w == 0.0) {
        return vec4(0.0, 0.0, 0.0, 1.0);
      } else { */
        return vec4(x, y, z, 0.0);
      // }
    }
    void main() {
      float originalZ = uNear + gl_FragCoord.z / gl_FragCoord.w * (uFar - uNear);
      gl_FragColor = encodePixelDepth(originalZ);
    }
  `;
  return new THREE.ShaderMaterial({
    uniforms: {
      uNear: {
        type: 'f',
        value: 0,
      },
      uFar: {
        type: 'f',
        value: 0,
      },
    },
    vertexShader: depthVsh,
    fragmentShader: depthFsh,
    // transparent: true,
    side: THREE.DoubleSide,
  });
})();
const raycasterCamera = new THREE.PerspectiveCamera();
const _onDepthRender = ({target, near, far, width, height, pixelRatio, matrixWorld, projectionMatrix}) => {
  raycasterCamera.near = near;
  raycasterCamera.far = far;
  raycasterCamera.matrixWorld.fromArray(matrixWorld).decompose(raycasterCamera.position, raycasterCamera.quaternion, raycasterCamera.scale);
  raycasterCamera.projectionMatrix.fromArray(projectionMatrix);
  depthMaterial.uniforms.uNear.value = near;
  depthMaterial.uniforms.uFar.value = far;

  // console.log('render', target, near, far, matrixWorld, projectionMatrix);

  {
    // const unhideUiMeshes = _hideUiMeshes();

    scene.overrideMaterial = depthMaterial;
    // const oldVrEnabled = renderer.vr.enabled;
    // renderer.vr.enabled = false;
    // const oldClearColor = localColor.copy(renderer.getClearColor());
    // const oldClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);

    renderer.setClearColor(new THREE.Color(0, 0, 0), 1);
    // renderer.setViewport(0, 0, width*pixelRatio, height*pixelRatio);
    renderer.render(scene, raycasterCamera);

    scene.overrideMaterial = null;
    // renderer.vr.enabled = oldVrEnabled;
    // renderer.setClearColor(oldClearColor, oldClearAlpha);

    // unhideUiMeshes();

    renderer.setRenderTarget(null);
  }
};

const makeGlobalMaterial = () => new THREE.ShaderMaterial({
  uniforms: {},
  vertexShader: `\
    // attribute vec3 color;
    attribute vec3 barycentric;
    varying vec3 vPosition;
    // varying vec3 vColor;
    varying vec3 vBC;
    void main() {
      // vColor = color;
      vBC = barycentric;
      vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
      vPosition = modelViewPosition.xyz;
      gl_Position = projectionMatrix * modelViewPosition;
    }
  `,
  fragmentShader: `\
    uniform sampler2D uCameraTex;
    varying vec3 vPosition;
    // varying vec3 vColor;
    varying vec3 vBC;
    vec3 color = vec3(0.984313725490196, 0.5490196078431373, 0.0);
    vec3 lightDirection = vec3(0.0, 0.0, 1.0);
    float edgeFactor() {
      vec3 d = fwidth(vBC);
      vec3 a3 = smoothstep(vec3(0.0), d*1.5, vBC);
      return min(min(a3.x, a3.y), a3.z);
    }
    void main() {
      // vec3 color = vColor;
      float barycentricFactor = (0.2 + (1.0 - edgeFactor()) * 0.8);
      vec3 xTangent = dFdx( vPosition );
      vec3 yTangent = dFdy( vPosition );
      vec3 faceNormal = normalize( cross( xTangent, yTangent ) );
      float lightFactor = dot(faceNormal, lightDirection);
      gl_FragColor = vec4((0.5 + color * barycentricFactor) * lightFactor, 0.5 + barycentricFactor * 0.5);
    }
  `,
  // side: THREE.BackSide,
  /* polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4, */
  // transparent: true,
  // depthWrite: false,
  extensions: {
    derivatives: true,
  },
});
const makeTexture = (i) => {
  const t = new THREE.Texture(i);
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; // THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
};
const _makeWasmWorker = () => {
  console.log('make wasm worker');
  let cbs = [];
  const w = new Worker('mc-worker.js', {
    type: 'module',
  });
  w.onmessage = e => {
    const {data} = e;
    const {error, result} = data;
    cbs.shift()(error, result);
  };
  w.onerror = err => {
    console.warn(err);
  };
  w.request = (req, transfers) => new Promise((accept, reject) => {
    w.postMessage(req, transfers);

    cbs.push((err, result) => {
      if (!err) {
        accept(result);
      } else {
        reject(err);
      }
    });
  });
  return w;
};

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

class Mesher {
  constructor(renderer) {
    this.renderer = renderer;

    this.worker = _makeWasmWorker();

    this.positionsIndex = 0;
    this.normalsIndex = 0;
    this.colorsIndex = 0;
    this.uvsIndex = 0;
    this.idsIndex = 0;
    this.currentId = 0;
    this.globalMaterial = null
    this.currentMesh = null;
    this.packer = null;
    this.meshes = [];
    this.aabb = new THREE.Box3();
    this.arrayBuffer = null;
    this.arrayBuffers = [];

    this.dbpCache = {};

    this.reset();
  }
  reset() {
    /* this.positionsIndex = 0;
    this.normalsIndex = 0;
    this.colorsIndex = 0;
    this.uvsIndex = 0;
    this.idsIndex = 0;
    this.currentId = 0; */

    if (!this.arrayBuffer) {
      this.arrayBuffer = this.arrayBuffers.pop();
    }
    if (!this.arrayBuffer) {
      const arrayBufferSize =
        NUM_POSITIONS*3*Float32Array.BYTES_PER_ELEMENT +
        NUM_POSITIONS*3*Float32Array.BYTES_PER_ELEMENT +
        NUM_POSITIONS*3*Float32Array.BYTES_PER_ELEMENT +
        NUM_POSITIONS*2*Float32Array.BYTES_PER_ELEMENT +
        NUM_POSITIONS*Uint32Array.BYTES_PER_ELEMENT;
      this.arrayBuffer = new ArrayBuffer(arrayBufferSize);
    }
    /* const {arrayBuffer} = this;
    let index = 0;

    const positions = new Float32Array(arrayBuffer, index, NUM_POSITIONS*3);
    index += Float32Array.BYTES_PER_ELEMENT * NUM_POSITIONS*3;

    const normals = new Float32Array(arrayBuffer, index, NUM_POSITIONS*3);
    index += Float32Array.BYTES_PER_ELEMENT * NUM_POSITIONS*3;

    const colors = new Float32Array(arrayBuffer, index, NUM_POSITIONS*3);
    index += Float32Array.BYTES_PER_ELEMENT * NUM_POSITIONS*3;

    const uvs = new Float32Array(arrayBuffer, index, NUM_POSITIONS*2);
    index += Float32Array.BYTES_PER_ELEMENT * NUM_POSITIONS*2;

    const ids = new Uint32Array(arrayBuffer, index, NUM_POSITIONS);
    index += Uint32Array.BYTES_PER_ELEMENT * NUM_POSITIONS; */

    const geometry = new THREE.BufferGeometry();
    /* const positionsAttribute = new THREE.BufferAttribute(positions, 3);
    geometry.setAttribute('position', positionsAttribute);
    const normalsAttribute = new THREE.BufferAttribute(normals, 3);
    geometry.setAttribute('normal', normalsAttribute);
    const colorsAttribute = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute('color', colorsAttribute);
    const uvsAttribute = new THREE.BufferAttribute(uvs, 2);
    geometry.setAttribute('uv', uvsAttribute);
    const idsAttribute = new THREE.BufferAttribute(ids, 1);
    geometry.setAttribute('id', idsAttribute);
    geometry.setDrawRange(0, 0); */

    this.globalMaterial = makeGlobalMaterial();

    const mesh = new THREE.Mesh(geometry, this.globalMaterial);
    mesh.frustumCulled = false;
    this.currentMesh = mesh;
    /* this.packer = new maxrects.MaxRectsPacker(TEXTURE_SIZE, TEXTURE_SIZE, 0, {
      smart: true,
      pot: true,
      square: false,
      allowRotation: false,
      tag: false,
      // border: 10,
      border: 0,
    });
    this.packer.images = []; */
  }
  pushAtlasImage(image, currentId) {
    let spec = this.packer.images.find(o => o.image === image);
    const hadSpec = !!spec;
    if (!spec) {
      spec = {
        image,
        currentIds: [],
      };
      this.packer.images.push(spec);
    }
    spec.currentIds.push(currentId);

    if (!hadSpec) {
      if (image.width > 512) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512*image.height/image.width;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        image = canvas;
      } else if (image.height > 512) {
        const canvas = document.createElement('canvas');
        canvas.width = 512*image.height/image.width;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        image = canvas;
      }
      this.packer.add(image.width, image.height, spec);
    }
  }
  addMesh(o) {
    this.meshes.push(o);
    o.aabb = new THREE.Box3().setFromObject(o);
    o.aabb.min.x = Math.floor(o.aabb.min.x/CHUNK_SIZE)*CHUNK_SIZE;
    o.aabb.max.x = Math.ceil(o.aabb.max.x/CHUNK_SIZE)*CHUNK_SIZE;
    o.aabb.min.z = Math.floor(o.aabb.min.z/CHUNK_SIZE)*CHUNK_SIZE;
    o.aabb.max.z = Math.ceil(o.aabb.max.z/CHUNK_SIZE)*CHUNK_SIZE;
    this.aabb.union(o.aabb);
  }
  mergeMeshGeometry(o, mergeMaterial, forceUvs) {
    const {geometry, material} = this.currentMesh;
    const positionsAttribute = geometry.attributes.position;
    const positions = positionsAttribute.array;
    const normalsAttribute = geometry.attributes.normal;
    const normals = normalsAttribute.array;
    const colorsAttribute = geometry.attributes.color;
    const colors = colorsAttribute.array;
    const uvsAttribute = geometry.attributes.uv;
    const uvs = uvsAttribute.array;
    const idsAttribute = geometry.attributes.id;
    const ids = idsAttribute.array;

    o.geometry.applyMatrix4(o.matrixWorld);
    o.matrixWorld.identity();
    if (o.geometry.index) {
      o.geometry = o.geometry.toNonIndexed();
    }
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const {map} = mat;

    new Float32Array(positions.buffer, positions.byteOffset + this.positionsIndex*Float32Array.BYTES_PER_ELEMENT, o.geometry.attributes.position.array.length)
      .set(o.geometry.attributes.position.array);
    positionsAttribute.updateRange.offset = this.positionsIndex;
    positionsAttribute.updateRange.count = o.geometry.attributes.position.array.length;
    this.positionsIndex += o.geometry.attributes.position.array.length;

    new Float32Array(normals.buffer, normals.byteOffset + this.normalsIndex*Float32Array.BYTES_PER_ELEMENT, o.geometry.attributes.normal.array.length)
      .set(o.geometry.attributes.normal.array);
    normalsAttribute.updateRange.offset = this.normalsIndex;
    normalsAttribute.updateRange.count = o.geometry.attributes.normal.array.length;
    this.normalsIndex += o.geometry.attributes.normal.array.length;

    colorsAttribute.updateRange.offset = this.colorsIndex;
    colorsAttribute.updateRange.count = o.geometry.attributes.position.array.length;
    if (o.geometry.attributes.color) {
      for (let i = 0; i < o.geometry.attributes.color.array.length; i += o.geometry.attributes.color.itemSize) {
        colors[this.colorsIndex++] = o.geometry.attributes.color.array[i];
        if (o.geometry.attributes.color.itemSize >= 2) {
          colors[this.colorsIndex++] = o.geometry.attributes.color.array[i+1];
        } else {
          this.colorsIndex++;
        }
        if (o.geometry.attributes.color.itemSize >= 3) {
          colors[this.colorsIndex++] = o.geometry.attributes.color.array[i+2];
        } else {
          this.colorsIndex++;
        }
      }
    } else {
      if (o.geometry.groups.length > 0) {
        for (let i = 0; i < o.geometry.groups.length; i++) {
          const group = o.geometry.groups[i];
          const {start, count, materialIndex} = group;
          const material = o.material[materialIndex];
          for (let j = start; j < start + count; j++) {
            colors[this.colorsIndex + j*3] = material.color.r;
            colors[this.colorsIndex + j*3 + 1] = material.color.g;
            colors[this.colorsIndex + j*3 + 2] = material.color.b;
          }
        }
        this.colorsIndex += o.geometry.attributes.position.array.length;
      } else {
        const material = Array.isArray(o.material) ? o.material[0] : o.material;
        for (let i = 0; i < o.geometry.attributes.position.array.length; i += 3) {
          colors[this.colorsIndex++] = material.color.r;
          colors[this.colorsIndex++] = material.color.g;
          colors[this.colorsIndex++] = material.color.b;
        }
      }
    }

    if (((map && map.image) || forceUvs) && o.geometry.attributes.uv) { // XXX won't be picked up on the second pass
      if (mergeMaterial) {
        this.pushAtlasImage(map.image, this.currentId);
      }

    // if (o.geometry.attributes.uv) {
      new Float32Array(uvs.buffer, uvs.byteOffset + this.uvsIndex*Float32Array.BYTES_PER_ELEMENT, o.geometry.attributes.uv.array.length)
        .set(o.geometry.attributes.uv.array);
      uvsAttribute.updateRange.offset = this.uvsIndex;
      uvsAttribute.updateRange.count = o.geometry.attributes.uv.array.length;
      this.uvsIndex += o.geometry.attributes.uv.array.length;
    } else {
      this.uvsIndex += o.geometry.attributes.position.array.length/3*2;
    }

    if (o.geometry.attributes.id) {
      new Uint32Array(ids.buffer, ids.byteOffset + this.idsIndex*Uint32Array.BYTES_PER_ELEMENT, o.geometry.attributes.id.array.length)
        .set(o.geometry.attributes.id.array);
      this.idsIndex += o.geometry.attributes.id.array.length;
    } else {
      new Uint32Array(ids.buffer, ids.byteOffset + this.idsIndex*Uint32Array.BYTES_PER_ELEMENT, o.geometry.attributes.position.array.length/3)
        .fill(this.currentId);
      this.idsIndex += o.geometry.attributes.position.array.length/3;
      this.currentId++;
    }

    /* positionsAttribute.needsUpdate = true;
    this.renderer.attributes.update(positionsAttribute, 34962);
    normalsAttribute.needsUpdate = true;
    this.renderer.attributes.update(normalsAttribute, 34962);
    colorsAttribute.needsUpdate = true;
    this.renderer.attributes.update(colorsAttribute, 34962);
    uvsAttribute.needsUpdate = true;
    this.renderer.attributes.update(uvsAttribute, 34962); */
    geometry.setDrawRange(0, this.positionsIndex/3);
  }
  mergeMeshGeometryScene(o, mergeMaterial, forceUvs) {
    o.updateMatrixWorld();
    o.traverse(o => {
      if (o.isMesh) {
        this.mergeMeshGeometry(o, mergeMaterial, forceUvs);
      }
    });
  }
  mergePacker(packer) {
    for (let j = 0; j < packer.images.length; j++) {
      const {image, currentIds} = packer.images[j];
      for (let k = 0; k < currentIds.length; k++) {
        this.pushAtlasImage(image, currentIds[k]);
      }
    }
  }
  splitOversizedMesh(maxSize) {
    const {currentMesh} = this;
    const numIndices = currentMesh.geometry.attributes.position.array.length/3;
    if (numIndices > maxSize) {
      const result = [];
      for (let index = 0; index < numIndices; index += maxSize) {
        const positions = new Float32Array(currentMesh.geometry.attributes.position.array.buffer, currentMesh.geometry.attributes.position.array.byteOffset + index*3*Float32Array.BYTES_PER_ELEMENT, currentMesh.geometry.drawRange.count*3);
        const normals = new Float32Array(currentMesh.geometry.attributes.normal.array.buffer, currentMesh.geometry.attributes.normal.array.byteOffset + index*3*Float32Array.BYTES_PER_ELEMENT, currentMesh.geometry.drawRange.count*3);
        const colors = new Float32Array(currentMesh.geometry.attributes.color.array.buffer, currentMesh.geometry.attributes.color.array.byteOffset + index*3*Float32Array.BYTES_PER_ELEMENT, currentMesh.geometry.drawRange.count*3);
        const uvs = new Float32Array(currentMesh.geometry.attributes.uv.array.buffer, currentMesh.geometry.attributes.uv.array.byteOffset + index*2*Float32Array.BYTES_PER_ELEMENT, currentMesh.geometry.drawRange.count*2);
        const ids = new Uint32Array(currentMesh.geometry.attributes.id.array.buffer, currentMesh.geometry.attributes.id.array.byteOffset + index*Float32Array.BYTES_PER_ELEMENT, currentMesh.geometry.drawRange.count);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('id', new THREE.BufferAttribute(ids, 1));

        const material = makeGlobalMaterial();
        const mesh = new THREE.Mesh(geometry, maxSize);
        // mesh.frustumCulled = false;
        result.push(mesh);
      }
      return result;
    } else {
      return [this.currentMesh];
    }
  }
  async decimateMesh(x, z, minTris) {
    const {currentMesh} = this;

    const positions = new Float32Array(currentMesh.geometry.attributes.position.array.buffer, currentMesh.geometry.attributes.position.array.byteOffset, currentMesh.geometry.drawRange.count*3);

    currentMesh.aabb = new THREE.Box3().setFromObject(currentMesh);
    currentMesh.aabb.min.x = Math.floor(currentMesh.aabb.min.x/CHUNK_SIZE)*CHUNK_SIZE;
    currentMesh.aabb.max.x = Math.ceil(currentMesh.aabb.max.x/CHUNK_SIZE)*CHUNK_SIZE;
    currentMesh.aabb.min.z = Math.floor(currentMesh.aabb.min.z/CHUNK_SIZE)*CHUNK_SIZE;
    currentMesh.aabb.max.z = Math.ceil(currentMesh.aabb.max.z/CHUNK_SIZE)*CHUNK_SIZE;

    const {arrayBuffer} = this;
    this.arrayBuffer = null;
    /* const shift = currentMesh.aabb.min.clone();
    const size = currentMesh.aabb.getSize(new THREE.Vector3());
    const sizeVector = Math.max(size.x, size.y, size.z);
    size.set(sizeVector, sizeVector, sizeVector); */
    const res = await this.worker.request({
      method: 'decimateMarch',
      positions,
      arrayBuffer,
      dims: [200, 200, 200],
      shift: [x, -8, z],
      size: [16, 16, 16],
    }, [arrayBuffer]);
    this.arrayBuffers.push(res.arrayBuffer);

    /* currentMesh.position.x = x;
    currentMesh.position.y = -8;
    currentMesh.position.z = z;
    currentMesh.updateMatrixWorld(); */
    /* currentMesh.position.copy(currentMesh.aabb.min);
    currentMesh.scale.copy(size);
    currentMesh.updateMatrixWorld(); */

    currentMesh.geometry.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    currentMesh.geometry.deleteAttribute('normal', undefined);
    const c = new THREE.Color(Math.random(), Math.random(), Math.random());
    const cs = new Float32Array(res.positions.length);
    for (let i = 0; i < res.positions.length; i += 3) {
      cs[i] = c.r;
      cs[i+1] = c.g;
      cs[i+2] = c.b;
    }
    currentMesh.geometry.setAttribute('color', new THREE.BufferAttribute(cs, 3));
    currentMesh.geometry.deleteAttribute('uv', undefined);
    currentMesh.geometry.deleteAttribute('id', undefined);
    currentMesh.geometry.setIndex(new THREE.BufferAttribute(res.indices, 1));
    currentMesh.geometry = currentMesh.geometry.toNonIndexed();
    currentMesh.geometry.computeVertexNormals();
    currentMesh.geometry.setDrawRange(0, Infinity);

    /* currentMesh.aabb = new THREE.Box3().setFromObject(currentMesh);
    currentMesh.aabb.min.x = Math.floor(currentMesh.aabb.min.x/CHUNK_SIZE)*CHUNK_SIZE;
    currentMesh.aabb.max.x = Math.ceil(currentMesh.aabb.max.x/CHUNK_SIZE)*CHUNK_SIZE;
    currentMesh.aabb.min.z = Math.floor(currentMesh.aabb.min.z/CHUNK_SIZE)*CHUNK_SIZE;
    currentMesh.aabb.max.z = Math.ceil(currentMesh.aabb.max.z/CHUNK_SIZE)*CHUNK_SIZE; */
    currentMesh.packer = this.packer;

    currentMesh.x = 0;
    currentMesh.z = 0;

    return currentMesh;
  }
  repackTexture() {
    const {currentMesh, globalMaterial, packer} = this;

    const canvas = document.createElement('canvas');
    canvas.width = packer.width;
    canvas.height = packer.height;
    packer.repack(false);
    if (packer.bins.length > 0) {
      const {bins: [{rects}]} = packer;

      const scale = packer.width/canvas.width;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFF';
      ctx.fillRect(0, 0, 1, 1);

      const rectById = [];
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        let {x, y, width: w, height: h, data: {image, currentIds}} = rect;
        x++;

        ctx.drawImage(image, x/scale, y/scale, w/scale, h/scale);

        for (let i = 0; i < currentIds.length; i++) {
          const currentId = currentIds[i];
          rectById[currentId] = rect;
        }
      }

      const uvs = currentMesh.geometry.attributes.uv.array;
      const ids = currentMesh.geometry.attributes.id.array;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const rect = rectById[id];

        if (rect) {
          let {x, y, width: w, height: h} = rect;
          x++;

          while (ids[i] === id) {
            let u = uvs[i*2];
            let v = uvs[i*2+1];
            if (u !== 0 || v !== 0) {
              u = Math.min(Math.max(u, 0), 1);
              v = Math.min(Math.max(v, 0), 1);
              u = (x + u*w)/packer.width;
              v = (y + v*h)/packer.height;
            }
            uvs[i*2] = u;
            uvs[i*2+1] = v;

            i++;
          }
          i--;
        }
      }
      currentMesh.geometry.attributes.uv.updateRange.offset = 0;
      currentMesh.geometry.attributes.uv.updateRange.count = -1;
      currentMesh.geometry.attributes.uv.needsUpdate = true;
      globalMaterial.map = makeTexture(canvas);
      globalMaterial.needsUpdate = true;
    }
  }
  async chunkMesh(x, z) {
    const {currentMesh, globalMaterial} = this;

    const positions = new Float32Array(currentMesh.geometry.attributes.position.array.buffer, currentMesh.geometry.attributes.position.array.byteOffset, currentMesh.geometry.drawRange.count*3);
    const normals = new Float32Array(currentMesh.geometry.attributes.normal.array.buffer, currentMesh.geometry.attributes.normal.array.byteOffset, currentMesh.geometry.drawRange.count*3);
    const colors = new Float32Array(currentMesh.geometry.attributes.color.array.buffer, currentMesh.geometry.attributes.color.array.byteOffset, currentMesh.geometry.drawRange.count*3);
    const uvs = new Float32Array(currentMesh.geometry.attributes.uv.array.buffer, currentMesh.geometry.attributes.uv.array.byteOffset, currentMesh.geometry.drawRange.count*2);
    const ids = new Uint32Array(currentMesh.geometry.attributes.id.array.buffer, currentMesh.geometry.attributes.id.array.byteOffset, currentMesh.geometry.drawRange.count);
    // const indices = currentMesh.geometry.index.array;
    const indices = new Uint32Array(positions.length/3);
    for (let i = 0; i < indices.length; i++) {
      indices[i] = i;
    }

    const mins = [x, 0, z];
    const maxs = [x+CHUNK_SIZE, 0, z+CHUNK_SIZE];
    const {arrayBuffer} = this;
    this.arrayBuffer = null;
    const res = await this.worker.request({
      method: 'chunkOne',
      positions,
      normals,
      colors,
      uvs,
      ids,
      indices,
      mins,
      maxs,
      arrayBuffer,
    }, [arrayBuffer]);
    this.arrayBuffers.push(res.arrayBuffer);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(res.colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(res.uvs, 2));
    geometry.setAttribute('id', new THREE.BufferAttribute(res.ids, 1));
    // geometry.setIndex(new THREE.BufferAttribute(res.indices[i], 1));
    // geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, globalMaterial);
    mesh.frustumCulled = false;

    mesh.x = x/CHUNK_SIZE;
    mesh.z = z/CHUNK_SIZE;

    return mesh;
  }
  getMeshesInChunk(x, y, z, offsetx, offsety, offsetz, lod) {
    const lodVoxelSize = voxelSize * (3**lod);
    const lodVoxelWidth = voxelWidth;
    const lodVoxelResolution = voxelResolution * (3**lod);

    const aabb = new THREE.Box3(
      new THREE.Vector3(x*lodVoxelSize + offsetx, y*lodVoxelSize + offsety, z*lodVoxelSize + offsetz),
      new THREE.Vector3((x+1)*lodVoxelSize + offsetx, (y+1)*lodVoxelSize + offsety, (z+1)*lodVoxelSize + offsetz)
    );
    // console.log('got aabbs', this.meshes.map(m => ([m.aabb.min.toArray(), m.aabb.max.toArray()])));
    return this.meshes.filter(m => m.aabb.intersectsBox(aabb));
  }
  /* getMeshBudgets(meshes) {
    let chunkWeights = {};
    for (let x = this.aabb.min.x; x < this.aabb.max.x; x += CHUNK_SIZE) {
      for (let z = this.aabb.min.z; z < this.aabb.max.z; z += CHUNK_SIZE) {
        const k = x + ':' + z;
        if (chunkWeights[k] === undefined) {
          chunkWeights[k] = this.getMeshesInChunk(x, z).length;
        }
      }
    }
    return meshes.map(m => {
      let budget = 0;
      for (let x = m.aabb.min.x; x < m.aabb.max.x; x += CHUNK_SIZE) {
        for (let z = m.aabb.min.z; z < m.aabb.max.z; z += CHUNK_SIZE) {
          const k = x + ':' + z;
          budget += 1/chunkWeights[k];
        }
      }
      return budget;
    });
  } */
  initVoxelize(newWidth, newSize, newPixelRatio) {
    voxelWidth = newWidth;
    voxelSize = newSize;
    voxelResolution = voxelSize / voxelWidth;
    pixelRatio = newPixelRatio;
    canvas = new OffscreenCanvas(1, 1);
    renderer = new THREE.WebGLRenderer({
      canvas,
    });
    // document.body.appendChild(renderer.domElement);
    xrRaycaster = new XRRaycaster({
      width: voxelWidth,
      height: voxelWidth,
      pixelRatio,
      voxelSize,
      renderer,
      onDepthRender: _onDepthRender,
    });
  }
  async getBufferPixels(x, y, z, offsetx, offsety, offsetz, lod) {
    const lodVoxelSize = voxelSize * (3**lod);
    const lodVoxelWidth = voxelWidth;
    const lodVoxelResolution = voxelResolution * (3**lod);

    // x = Math.floor(x*lodVoxelSize/lodVoxelWidth);
    // y = Math.floor(y*lodVoxelSize/lodVoxelWidth);
    // z = Math.floor(z*lodVoxelSize/lodVoxelWidth);

    const k = x + ':' + y + ':' + z + ':' + lod;
    const depthBufferPixels = this.dbpCache[k];
    if (!depthBufferPixels) {
      const ax = x * lodVoxelSize + lodVoxelSize/2 + offsetx;
      const ay = y * lodVoxelSize + lodVoxelSize/2 + offsety;
      const az = z * lodVoxelSize + lodVoxelSize/2 + offsetz;

      const o = Math.floor(pixelRatio/2);

      xrRaycaster.updateLod(voxelSize, lod);

      const depthTextures = new Float32Array(lodVoxelWidth * lodVoxelWidth * 6);
      depthTextures.fill(Infinity);
      [
        [ax, ay, az + lodVoxelSize/2, 0, 0],
        [ax + lodVoxelSize/2, ay, az, Math.PI/2, 0],
        [ax, ay, az - lodVoxelSize/2, Math.PI/2*2, 0],
        [ax - lodVoxelSize/2, ay, az, Math.PI/2*3, 0],
        [ax, ay + lodVoxelSize/2, az, 0, -Math.PI/2],
        [ax, ay - lodVoxelSize/2, az, 0, Math.PI/2],
      ].forEach(([x, y, z, ry, rx], i) => {
        if (ry !== 0) {
          localQuaternion.setFromAxisAngle(localVector.set(0, 1, 0), ry);
        } else if (rx !== 0) {
          localQuaternion.setFromAxisAngle(localVector.set(1, 0, 0), rx);
        } else {
          localQuaternion.set(0, 0, 0, 1);
        }
        xrRaycaster.updateView(x, y, z, localQuaternion);

        xrRaycaster.updateDepthTexture();
        xrRaycaster.updateDepthBuffer();
        xrRaycaster.updateDepthBufferPixels();
        const depthTexture = xrRaycaster.getDepthBufferPixels();

        const startIndex = i * lodVoxelWidth * lodVoxelWidth;
        for (let x = 0; x < lodVoxelWidth; x++) {
          for (let y = 0; y < lodVoxelWidth; y++) {
            let acc = Infinity;
            for (let dx = -o; dx <= o; dx++) {
              for (let dy = -o; dy <= o; dy++) {
                const ax = o + x*pixelRatio + dx;
                const ay = o + y*pixelRatio + dy;
                const index = ax + ay*lodVoxelWidth*pixelRatio;
                const v = depthTexture[index];
                acc = Math.min(acc, v);
              }
            }
            if (acc < Infinity) {
              const index = startIndex + x + y*lodVoxelWidth;
              depthTextures[index] = acc;
            }
          }
        }
      });

      this.reset();

      // console.log('push chunk texture 1', x, y, z, lod);

      const {arrayBuffer} = this;
      this.arrayBuffer = null;
      const res = await this.worker.request({
        method: 'pushChunkTexture',
        depthTextures,
        x, y, z, lod, voxelWidth: lodVoxelWidth, voxelSize: lodVoxelSize, voxelResolution: lodVoxelResolution,
        arrayBuffer,
      }, [arrayBuffer]);
      // console.log('got res', res);
      this.arrayBuffers.push(res.arrayBuffer);

      // console.log('push chunk texture 2', x, y, z, lod);

      this.dbpCache[k] = true;
    }
  }
  async voxelize(x, y, z, offsetx, offsety, offsetz, lod, meshes) {
    if (this.meshes.length > 0) {
      meshes.forEach(m => {
        m.traverse(o => {
          if (o.isMesh) {
            o.frustumCulled = false;
            o.isSkinnedMesh = false;
          }
        });
        scene.add(m);
      });

      const lodVoxelSize = voxelSize * (3**lod);
      const lodVoxelWidth = voxelWidth;
      const lodVoxelResolution = voxelResolution * (3**lod);

      for (let iz = -1; iz <= 1; iz++) {
        for (let ix = -1; ix <= 1; ix++) {
          for (let iy = -1; iy <= 1; iy++) {
            // if (lod === 0 || ix !== 0 || iy !== 0 || iz !== 0) {
              // const ax = (x+ix) * lodVoxelWidth;
              // const ay = (y+iy) * lodVoxelWidth;
              // const az = (z+iz) * lodVoxelWidth;
              await this.getBufferPixels(x + ix, y + iy, z + iz, offsetx, offsety, offsetz, lod);
            // }
          }
        }
      }

      this.reset();

      // console.log('march potentials 1', x, y, z, lod);

      const {arrayBuffer} = this;
      this.arrayBuffer = null;
      const res = await this.worker.request({
        method: 'marchPotentials',
        x,
        y,
        z,
        lod,
        dims: [lodVoxelWidth, lodVoxelWidth, lodVoxelWidth],
        shift: [-lodVoxelResolution + x*lodVoxelSize + offsetx, -lodVoxelResolution + y*lodVoxelSize + offsety, -lodVoxelResolution + z*lodVoxelSize + offsety],
        size: [lodVoxelSize + 2*lodVoxelResolution, lodVoxelSize + 2*lodVoxelResolution, lodVoxelSize + 2*lodVoxelResolution],
        arrayBuffer,
      }, [arrayBuffer]);
      // console.log('got res', res);
      this.arrayBuffers.push(res.arrayBuffer);

      // console.log('march potentials 2', x, y, z, lod);

      const {currentMesh} = this;
      currentMesh.geometry.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
      currentMesh.geometry.setAttribute('barycentric', new THREE.BufferAttribute(res.barycentrics, 3));
      /* const c = new THREE.Color(Math.random(), Math.random(), Math.random());
      const cs = new Float32Array(res.positions.length);
      for (let i = 0; i < res.positions.length; i += 3) {
        cs[i] = c.r;
        cs[i+1] = c.g;
        cs[i+2] = c.b;
      }
      currentMesh.geometry.setAttribute('color', new THREE.BufferAttribute(cs, 3)); */
      currentMesh.geometry.deleteAttribute('uv', undefined);
      currentMesh.geometry.deleteAttribute('id', undefined);
      /* currentMesh.geometry.setIndex(new THREE.BufferAttribute(res.indices, 1));
      currentMesh.geometry = currentMesh.geometry.toNonIndexed();
      currentMesh.geometry.computeVertexNormals(); */
      currentMesh.geometry.setDrawRange(0, Infinity);

      /* currentMesh.aabb = new THREE.Box3().setFromObject(currentMesh);
      currentMesh.aabb.min.x = Math.floor(currentMesh.aabb.min.x/CHUNK_SIZE)*CHUNK_SIZE;
      currentMesh.aabb.max.x = Math.ceil(currentMesh.aabb.max.x/CHUNK_SIZE)*CHUNK_SIZE;
      currentMesh.aabb.min.z = Math.floor(currentMesh.aabb.min.z/CHUNK_SIZE)*CHUNK_SIZE;
      currentMesh.aabb.max.z = Math.ceil(currentMesh.aabb.max.z/CHUNK_SIZE)*CHUNK_SIZE; */
      // currentMesh.packer = this.packer;

      // currentMesh.x = 0;
      // currentMesh.z = 0;

      meshes.forEach(m => {
        scene.remove(m);
      });
    }

    return this.currentMesh;
  }
  async getChunk(x, y, z, offsetx, offsety, offsetz, lod) {
    const {currentMesh, packer, globalMaterial} = this;

    const meshes = this.getMeshesInChunk(x, y, z, offsetx, offsety, offsetz, lod);
    return this.voxelize(x, y, z, offsetx, offsety, offsetz, lod, meshes);

    const meshBudgets = this.getMeshBudgets(meshes);

    this.reset();

    const decimatedMeshes = [];
    const decimatedMeshPackers = [];
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      // const meshBudget = meshBudgets[i];

      this.mergeMeshGeometryScene(mesh, true, false);
      // decimatedMeshPackers.push(this.packer);

      /* for (let i = 0; i < this.currentMesh.geometry.attributes.position.array.length; i++) {
        this.currentMesh.geometry.attributes.position.array[i] = Math.floor(this.currentMesh.geometry.attributes.position.array[i]/0.05)*0.05;
      }
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const cb = new THREE.Vector3();
      const ab = new THREE.Vector3();
      const positions = this.currentMesh.geometry.attributes.position.array;
      const normals = this.currentMesh.geometry.attributes.normal.array;
      window.positions = positions;
      window.normals = normals;
      for (let i = 0; i < positions.length; i += 9) {
        a.fromArray(positions, i);
        b.fromArray(positions, i+3);
        c.fromArray(positions, i+6);

        cb.subVectors(c, b);
        ab.subVectors(a, b);
        cb.cross(ab);

        normals[ i ] = cb.x;
        normals[ i + 1 ] = cb.y;
        normals[ i + 2 ] = cb.z;

        normals[ i + 3 ] = cb.x;
        normals[ i + 4 ] = cb.y;
        normals[ i + 5 ] = cb.z;

        normals[ i + 6 ] = cb.x;
        normals[ i + 7 ] = cb.y;
        normals[ i + 8 ] = cb.z;
      }
      for (let i = 0; i < positions.length; i += 3) {
        const length = Math.sqrt(normals[i] * normals[i] + normals[i+1] * normals[i+1] + normals[i+2] * normals[i+2]);
        normals[i] /= length;
        normals[i+1] /= length;
        normals[i+2] /= length;
      } */
      // debugger;
      // this.currentMesh.geometry.computeVertexNormals();
    }

    const decimatedMesh = await this.decimateMesh(x, z, lod);
    return decimatedMesh;

    this.reset();
    for (let i = 0; i < decimatedMeshes.length; i++) {
      const decimatedMesh = decimatedMeshes[i];
      this.mergeMeshGeometryScene(decimatedMesh, false, true);
    }
    for (let i = 0; i < decimatedMeshPackers.length; i++) {
      this.mergePacker(decimatedMeshPackers[i]);
    }
    this.repackTexture();

    const chunkMesh = await this.chunkMesh(x, z);
    return chunkMesh;
  }
}

class MesherServer {
  // constructor() {}
  handleMessage(data) {
    const {method} = data;
    switch (method) {
      case 'chunk': {
        const allocator = new Allocator();

        const {positions: positionsData, normals: normalsData, colors: colorsData, uvs: uvsData, ids: idsData, indices: indicesData, mins: minsData, maxs: maxsData, scales: scaleData, arrayBuffer} = data;
        const positions = allocator.alloc(Float32Array, positionsData.length);
        positions.set(positionsData);
        const normals = allocator.alloc(Float32Array, normalsData.length);
        normals.set(normalsData);
        const colors = allocator.alloc(Float32Array, colorsData.length);
        colors.set(colorsData);
        const uvs = allocator.alloc(Float32Array, uvsData.length);
        uvs.set(uvsData);
        const ids = allocator.alloc(Float32Array, idsData.length);
        ids.set(idsData);
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
        const outIds = allocator.alloc(Uint32Array, numSlots);
        const outFaces = allocator.alloc(Uint32Array, numSlots);
        for (let i = 0; i < numSlots; i++) {
          outPositions[i] = allocator.alloc(Float32Array, 500*1024).offset;
          outNormals[i] = allocator.alloc(Float32Array, 500*1024).offset;
          outColors[i] = allocator.alloc(Float32Array, 500*1024).offset;
          outUvs[i] = allocator.alloc(Float32Array, 500*1024).offset;
          outIds[i] = allocator.alloc(Uint32Array, 500*1024).offset;
          outFaces[i] = allocator.alloc(Uint32Array, 500*1024).offset;
        }
        const outNumPositions = allocator.alloc(Uint32Array, numSlots);
        const outNumNormals = allocator.alloc(Uint32Array, numSlots);
        const outNumColors = allocator.alloc(Uint32Array, numSlots);
        const outNumUvs = allocator.alloc(Uint32Array, numSlots);
        const outNumIds = allocator.alloc(Uint32Array, numSlots);
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
          ids.offset,
          ids.length,
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
          outIds.offset,
          outNumIds.offset,
          outFaces.offset,
          outNumFaces.offset
        );

        let index = 0;
        const outPs = Array(numSlots);
        const outNs = Array(numSlots);
        const outCs = Array(numSlots);
        const outUs = Array(numSlots);
        const outXs = Array(numSlots);
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

          const numX = outNumIds[i];
          const outX = new Float32Array(self.Module.HEAP8.buffer, self.Module.HEAP8.byteOffset + outIds[i], numX);
          new Float32Array(arrayBuffer, index, numX).set(outX);
          outXs[i] = outX;
          index += Float32Array.BYTES_PER_ELEMENT * numX;

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
            ids: outXs,
            indices: outIs,
            arrayBuffer,
          },
        }, [arrayBuffer]);
        allocator.freeAll();
        break;
      }
      case 'chunkOne': {
        const allocator = new Allocator();

        const {positions: positionsData, normals: normalsData, colors: colorsData, uvs: uvsData, ids: idsData, indices: indicesData, mins: minsData, maxs: maxsData, arrayBuffer} = data;
        const positions = allocator.alloc(Float32Array, positionsData.length);
        positions.set(positionsData);
        const normals = allocator.alloc(Float32Array, normalsData.length);
        normals.set(normalsData);
        const colors = allocator.alloc(Float32Array, colorsData.length);
        colors.set(colorsData);
        const uvs = allocator.alloc(Float32Array, uvsData.length);
        uvs.set(uvsData);
        const ids = allocator.alloc(Uint32Array, idsData.length);
        ids.set(idsData);
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

        const outPositions = allocator.alloc(Float32Array, 500*1024);
        const outNormals = allocator.alloc(Float32Array, 500*1024);
        const outColors = allocator.alloc(Float32Array, 500*1024);
        const outUvs = allocator.alloc(Float32Array, 500*1024);
        const outIds = allocator.alloc(Uint32Array, 500*1024);
        const outFaces = allocator.alloc(Uint32Array, 500*1024);

        const outNumPositions = allocator.alloc(Uint32Array, 1);
        const outNumNormals = allocator.alloc(Uint32Array, 1);
        const outNumColors = allocator.alloc(Uint32Array, 1);
        const outNumUvs = allocator.alloc(Uint32Array, 1);
        const outNumIds = allocator.alloc(Uint32Array, 1);
        const outNumFaces = allocator.alloc(Uint32Array, 1);

        self.Module._doChunkOne(
          positions.offset,
          positions.length,
          normals.offset,
          normals.length,
          colors.offset,
          colors.length,
          uvs.offset,
          uvs.length,
          ids.offset,
          ids.length,
          indices.offset,
          indices.length,
          mins.offset,
          maxs.offset,
          outPositions.offset,
          outNumPositions.offset,
          outNormals.offset,
          outNumNormals.offset,
          outColors.offset,
          outNumColors.offset,
          outUvs.offset,
          outNumUvs.offset,
          outIds.offset,
          outNumIds.offset,
          outFaces.offset,
          outNumFaces.offset
        );

        const arrayBuffer2 = new ArrayBuffer(
          Uint32Array.BYTES_PER_ELEMENT +
          outNumPositions[0]*Float32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          outNumNormals[0]*Float32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          outNumColors[0]*Float32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          outNumUvs[0]*Float32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          outNumIds[0]*Uint32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          outNumFaces[0]*Uint32Array.BYTES_PER_ELEMENT
        );
        let index = 0;

        const numP = outNumPositions[0];
        const outP = new Float32Array(arrayBuffer2, index, numP);
        outP.set(new Float32Array(outPositions.buffer, outPositions.byteOffset, numP));
        index += Float32Array.BYTES_PER_ELEMENT * numP;

        const numN = outNumNormals[0];
        const outN = new Float32Array(arrayBuffer2, index, numN);
        outN.set(new Float32Array(outNormals.buffer, outNormals.byteOffset, numN));
        index += Float32Array.BYTES_PER_ELEMENT * numN;

        const numC = outNumColors[0];
        const outC = new Float32Array(arrayBuffer2, index, numC);
        outC.set(new Float32Array(outColors.buffer, outColors.byteOffset, numC));
        index += Float32Array.BYTES_PER_ELEMENT * numC;

        const numU = outNumUvs[0];
        const outU = new Float32Array(arrayBuffer2, index, numU);
        outU.set(new Float32Array(outUvs.buffer, outUvs.byteOffset, numU));
        index += Float32Array.BYTES_PER_ELEMENT * numU;

        const numX = outNumIds[0];
        const outX = new Uint32Array(arrayBuffer2, index, numX);
        outX.set(new Uint32Array(outIds.buffer, outIds.byteOffset, numX));
        index += Uint32Array.BYTES_PER_ELEMENT * numX;

        const numI = outNumFaces[0];
        const outI = new Uint32Array(arrayBuffer2, index, numI);
        outI.set(new Uint32Array(outFaces.buffer, outFaces.byteOffset, numI));
        index += Uint32Array.BYTES_PER_ELEMENT * numI;

        self.postMessage({
          result: {
            positions: outP,
            normals: outN,
            colors: outC,
            uvs: outU,
            ids: outX,
            indices: outI,
            arrayBuffer,
          },
        }, [arrayBuffer, arrayBuffer2]);
        allocator.freeAll();
        break;
      }
      case 'decimate': {
        const allocator = new Allocator();

        const {positions: positionsData, normals: normalsData, colors: colorsData, uvs: uvsData, ids: idsData, minTris, quantization, targetError, aggressiveness, base, iterationOffset, arrayBuffer} = data;
        const positions = allocator.alloc(Float32Array, positionsData.length);
        positions.set(positionsData);
        const normals = allocator.alloc(Float32Array, normalsData.length);
        normals.set(normalsData);
        const colors = allocator.alloc(Float32Array, colorsData.length);
        colors.set(colorsData);
        const uvs = allocator.alloc(Float32Array, uvsData.length);
        uvs.set(uvsData);
        const ids = allocator.alloc(Uint32Array, idsData.length);
        ids.set(idsData);
        const indices = allocator.alloc(Uint32Array, positions.length/3);

        const numPositions = allocator.alloc(Uint32Array, 1);
        numPositions[0] = positions.length;
        const numNormals = allocator.alloc(Uint32Array, 1);
        numNormals[0] = normals.length;
        const numColors = allocator.alloc(Uint32Array, 1);
        numColors[0] = colors.length;
        const numUvs = allocator.alloc(Uint32Array, 1);
        numUvs[0] = uvs.length;
        const numIds = allocator.alloc(Uint32Array, 1);
        numIds[0] = ids.length;
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
          ids.offset,
          numIds.offset,
          minTris,
          quantization,
          targetError,
          aggressiveness,
          base,
          iterationOffset,
          indices.offset,
          numIndices.offset
        );

        const arrayBuffer2 = new ArrayBuffer(
          Uint32Array.BYTES_PER_ELEMENT +
          numPositions[0]*Float32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          numNormals[0]*Float32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          numColors[0]*Float32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          numUvs[0]*Float32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          numIds[0]*Uint32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          numIndices[0]*Uint32Array.BYTES_PER_ELEMENT
        );
        let index = 0;

        const outP = new Float32Array(arrayBuffer2, index, numPositions[0]);
        outP.set(new Float32Array(positions.buffer, positions.byteOffset, numPositions[0]));
        index += Float32Array.BYTES_PER_ELEMENT * numPositions[0];

        const outN = new Float32Array(arrayBuffer2, index, numNormals[0]);
        outN.set(new Float32Array(normals.buffer, normals.byteOffset, numNormals[0]));
        index += Float32Array.BYTES_PER_ELEMENT * numNormals[0];

        const outC = new Float32Array(arrayBuffer2, index, numColors[0]);
        outC.set(new Float32Array(colors.buffer, colors.byteOffset, numColors[0]));
        index += Float32Array.BYTES_PER_ELEMENT * numColors[0];

        const outU = new Float32Array(arrayBuffer2, index, numUvs[0]);
        outU.set(new Float32Array(uvs.buffer, uvs.byteOffset, numUvs[0]));
        index += Float32Array.BYTES_PER_ELEMENT * numUvs[0];

        const outX = new Uint32Array(arrayBuffer2, index, numIds[0]);
        outX.set(new Uint32Array(ids.buffer, ids.byteOffset, numIds[0]));
        index += Uint32Array.BYTES_PER_ELEMENT * numIds[0];

        const outI = new Uint32Array(arrayBuffer2, index, numIndices[0]);
        outI.set(new Uint32Array(indices.buffer, indices.byteOffset, numIndices[0]));
        index += Uint32Array.BYTES_PER_ELEMENT * numIndices[0];

        self.postMessage({
          result: {
            positions: outP,
            normals: outN,
            colors: outC,
            uvs: outU,
            ids: outX,
            indices: outI,
            arrayBuffer,
          },
        }, [arrayBuffer, arrayBuffer2]);
        allocator.freeAll();
        break;
      }
      case 'decimateMarch': {
        const allocator = new Allocator();

        const {positions: positionsData, dims: dimsData, shift: shiftData, size: sizeData, arrayBuffer} = data;
        const positions = allocator.alloc(Float32Array, 512*1024*Float32Array.BYTES_PER_ELEMENT);
        positions.set(positionsData);
        const indices = allocator.alloc(Uint32Array, 512*1024*Uint32Array.BYTES_PER_ELEMENT);

        const numPositions = allocator.alloc(Uint32Array, 1);
        numPositions[0] = positions.length;
        const numIndices = allocator.alloc(Uint32Array, 1);
        numIndices[0] = indices.length;

        const dims = allocator.alloc(Uint32Array, 3);
        dims.set(Uint32Array.from(dimsData));

        const shift = allocator.alloc(Float32Array, 3);
        shift.set(Float32Array.from(shiftData));

        const size = allocator.alloc(Float32Array, 3);
        size.set(Float32Array.from(sizeData));

        self.Module._doDecimateMarch(
          dims.offset,
          shift.offset,
          size.offset,
          positions.offset,
          indices.offset,
          numPositions.offset,
          numIndices.offset
        );

        const arrayBuffer2 = new ArrayBuffer(
          Uint32Array.BYTES_PER_ELEMENT +
          numPositions[0]*Float32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          numIndices[0]*Uint32Array.BYTES_PER_ELEMENT
        );
        let index = 0;

        const outP = new Float32Array(arrayBuffer2, index, numPositions[0]);
        outP.set(new Float32Array(positions.buffer, positions.byteOffset, numPositions[0]));
        index += Float32Array.BYTES_PER_ELEMENT * numPositions[0];

        const outI = new Uint32Array(arrayBuffer2, index, numIndices[0]);
        outI.set(new Uint32Array(indices.buffer, indices.byteOffset, numIndices[0]));
        index += Uint32Array.BYTES_PER_ELEMENT * numIndices[0];

        self.postMessage({
          result: {
            positions: outP,
            indices: outI,
            arrayBuffer,
          },
        }, [arrayBuffer, arrayBuffer2]);
        allocator.freeAll();
        break;
      }
      case 'pushChunkTexture': {
        const allocator = new Allocator();

        const {x, y, z, lod, depthTextures: depthTexturesData, voxelWidth, voxelSize, voxelResolution, arrayBuffer} = data;

        const depthTextures = allocator.alloc(Float32Array, depthTexturesData.length);
        depthTextures.set(depthTexturesData);

        self.Module._doPushChunkTexture(
          x,
          y,
          z,
          lod,
          depthTextures.offset,
          voxelWidth,
          voxelSize,
          voxelResolution,
          1,
          -1
        );

        self.postMessage({
          result: {
            arrayBuffer,
          },
        }, [arrayBuffer]);
        allocator.freeAll();
        break;
      }
      case 'marchPotentials': {
        const allocator = new Allocator();

        const {x, y, z, lod, dims: dimsData, shift: shiftData, size: sizeData, arrayBuffer} = data;

        const positions = allocator.alloc(Float32Array, 1024*1024*Float32Array.BYTES_PER_ELEMENT);
        const barycentrics = allocator.alloc(Float32Array, 1024*1024*Float32Array.BYTES_PER_ELEMENT);

        const numPositions = allocator.alloc(Uint32Array, 1);
        numPositions[0] = positions.length;
        const numBarycentrics = allocator.alloc(Uint32Array, 1);
        numBarycentrics[0] = barycentrics.length;

        const dims = allocator.alloc(Int32Array, 3);
        dims.set(Int32Array.from(dimsData));

        const shift = allocator.alloc(Float32Array, 3);
        shift.set(Float32Array.from(shiftData));

        const size = allocator.alloc(Float32Array, 3);
        size.set(Float32Array.from(sizeData));

        self.Module._doMarchPotentials(
          x,
          y,
          z,
          lod,
          dims.offset,
          shift.offset,
          size.offset,
          positions.offset,
          barycentrics.offset,
          numPositions.offset,
          numBarycentrics.offset
        );

        // console.log('out num positions', numPositions[0], numBarycentrics[0]);

        const arrayBuffer2 = new ArrayBuffer(
          Uint32Array.BYTES_PER_ELEMENT +
          numPositions[0]*Float32Array.BYTES_PER_ELEMENT +
          Uint32Array.BYTES_PER_ELEMENT +
          numBarycentrics[0]*Uint32Array.BYTES_PER_ELEMENT
        );
        let index = 0;

        const outP = new Float32Array(arrayBuffer2, index, numPositions[0]);
        outP.set(new Float32Array(positions.buffer, positions.byteOffset, numPositions[0]));
        index += Float32Array.BYTES_PER_ELEMENT * numPositions[0];

        const outB = new Float32Array(arrayBuffer2, index, numBarycentrics[0]);
        outB.set(new Float32Array(barycentrics.buffer, barycentrics.byteOffset, numBarycentrics[0]));
        index += Float32Array.BYTES_PER_ELEMENT * numBarycentrics[0];

        self.postMessage({
          result: {
            positions: outP,
            barycentrics: outB,
            arrayBuffer,
          },
        }, [arrayBuffer, arrayBuffer2]);
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
}

export {
  Mesher,
  MesherServer,
  makeGlobalMaterial,
  makeTexture,
  CHUNK_SIZE,
};