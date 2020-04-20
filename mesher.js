import THREE from './three.module.js';
// import maxrects from './maxrects-packer.min.js';

const NUM_POSITIONS = 1 * 1024 * 1024;

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
const onDepthRender = ({target, near, far, pixelRatio, matrixWorld, projectionMatrix}) => {
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

export class XRRaycaster {
  constructor({width = 512, height = 512, pixelRatio = 1, voxelSize, renderer = new THREE.WebGLRenderer(), onDepthRender = (target, camera) => {}} = {}) {
    // this.width = width;
    // this.height = height;
    this.renderer = renderer;

    const depthBufferPixels = new Float32Array(width * pixelRatio * height * pixelRatio * 4);
    // this.depthBufferPixels = depthBufferPixels;

    let camera = new THREE.OrthographicCamera(
      voxelSize / -2, voxelSize / 2,
      voxelSize / 2, voxelSize / -2,
      0.001, voxelSize
    );
    // this.camera = camera;

    let far = voxelSize;

    const depthTarget = {};
    const depthTargets = (() => {
      const result = Array(6);
      for (let i = 0; i < 6; i++) {
        result[i] = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.NearestFilter,
          format: THREE.RGBAFormat,
          type: THREE.FloatType,
          depthBuffer: true,
          stencilBuffer: false,
        });
      }
      return result;
    })();
    depthTarget.updateSize = (uSize, vSize, dSize) => {
      camera.left = uSize / -2;
      camera.right = uSize / 2;
      camera.top = vSize / 2;
      camera.bottom = vSize / -2;
      camera.near = 0.001;
      camera.far = dSize;
      camera.updateProjectionMatrix();

      far = dSize;
    };
    depthTarget.updateView = (x, y, z, q) => {
      if (camera.position.x !== x || camera.position.y !== y || camera.position.z !== z || !camera.quaternion.equals(q)) {
        camera.position.set(x, y, z);
        camera.quaternion.copy(q);
        camera.updateMatrixWorld();
      }
    };
    depthTarget.renderDepthTexture = i => {
      onDepthRender({
        target: depthTargets[i],
        near: 0.001,
        far,
        pixelRatio,
        matrixWorld: camera.matrixWorld.toArray(),
        projectionMatrix: camera.projectionMatrix.toArray(),
      });
    };
    depthTarget.getDepthBufferPixels = (i, depthTextures, offset) => {
      renderer.readRenderTargetPixels(depthTargets[i], 0, 0, width * pixelRatio, height * pixelRatio, new Float32Array(depthTextures.buffer, depthTextures.byteOffset + offset * Float32Array.BYTES_PER_ELEMENT, width * pixelRatio * height * pixelRatio * 4), 0);
    };
    this.depthTarget = depthTarget;
  }
  updateView(x, y, z, q) {
    this.depthTarget.updateView(x, y, z, q);
  }
  updateSize(x, y, z) {
    this.depthTarget.updateSize(x, y, z);
  }
  renderDepthTexture(i) {
    this.depthTarget.renderDepthTexture(i);
  }
  getDepthBufferPixels(i, depthTextures, offset) {
    return this.depthTarget.getDepthBufferPixels(i, depthTextures, offset);
  }
}

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

    this.globalMaterial = null
    this.meshes = [];
    this.aabb = new THREE.Box3();
    this.arrayBuffer = null;
    this.arrayBuffers = [];
    this.chunks = [];

    // this.dbpCache = {};

    // this.reset();
  }
  reset() {
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

    const geometry = new THREE.BufferGeometry();

    if (!this.globalMaterial) {
      this.globalMaterial = makeGlobalMaterial();
    }

    /* const mesh = new THREE.Mesh(geometry, this.globalMaterial);
    mesh.frustumCulled = false;
    this.currentMesh = mesh; */
  }
  addMesh(o) {
    o.aabb = new THREE.Box3().setFromObject(o);
    this.meshes.push(o);
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].notifyMesh(o);
    }
  }
  getMeshesInAabb(aabb) {
    return this.meshes.filter(m => m.aabb.intersectsBox(aabb));
  }
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
      onDepthRender,
    });
  }
  async voxelize(m) {
    m.updateMatrixWorld();
    m.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false;
        o.isSkinnedMesh = false;
      }
    });
    scene.add(m);

    const aabb = new THREE.Box3().setFromObject(m);
    const center = aabb.getCenter(new THREE.Vector3());
    const size = aabb.getSize(new THREE.Vector3());
    size.multiplyScalar(1.5);

    const voxelResolution = size.clone().divideScalar(voxelWidth);

    const _multiplyLength = (a, b) => a.x*b.x + a.y*b.y + a.z*b.z;

    const depthTextures = new Float32Array(voxelWidth * pixelRatio * voxelWidth * pixelRatio * 4 * 6);
    // depthTextures.fill(Infinity);
    [
      [center.x, center.y, center.z + size.z/2, 0, 0, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
      [center.x + size.x/2, center.y, center.z, Math.PI/2, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)],
      [center.x, center.y, center.z - size.z/2, Math.PI/2*2, 0, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
      [center.x - size.x/2, center.y, center.z, Math.PI/2*3, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)],
      [center.x, center.y + size.y/2, center.z, 0, -Math.PI/2, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
      [center.x, center.y - size.y/2, center.z, 0, Math.PI/2, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
    ].forEach(([x, y, z, ry, rx, sx, sy, sz], i) => {
      if (ry !== 0) {
        localQuaternion.setFromAxisAngle(localVector.set(0, 1, 0), ry);
      } else if (rx !== 0) {
        localQuaternion.setFromAxisAngle(localVector.set(1, 0, 0), rx);
      } else {
        localQuaternion.set(0, 0, 0, 1);
      }
      xrRaycaster.updateView(x, y, z, localQuaternion);
      xrRaycaster.updateSize(_multiplyLength(size, sx), _multiplyLength(size, sy), _multiplyLength(size, sz));
      xrRaycaster.renderDepthTexture(i);
    });
    for (let i = 0; i < 6; i++) {
      xrRaycaster.getDepthBufferPixels(i, depthTextures, voxelWidth * pixelRatio * voxelWidth * pixelRatio * 4 * i);
    }

    this.reset();

    const {arrayBuffer} = this;
    this.arrayBuffer = null;
    const res = await this.worker.request({
      method: 'marchPotentials',
      depthTextures,
      dims: [voxelWidth, voxelWidth, voxelWidth],
      shift: [voxelResolution.x/2 + center.x - size.x/2, voxelResolution.y/2 + center.y - size.y/2, voxelResolution.z/2 + center.z - size.z/2],
      size: [size.x, size.y, size.z],
      pixelRatio,
      value: 1,
      nvalue: -1,
      arrayBuffer,
    }, [arrayBuffer]);
    // console.log('got res', res);
    this.arrayBuffers.push(res.arrayBuffer);

    // console.log('march potentials 2', res);

    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.globalMaterial);
    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    mesh.geometry.setAttribute('barycentric', new THREE.BufferAttribute(res.barycentrics, 3));

    scene.remove(m);

    return mesh;
  }
  getChunk(aabb) {
    const chunk = new EventTarget();
    (async () => {
      const meshes = this.getMeshesInAabb(aabb);
      const previewMeshes = [];
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        const previewMesh = await this.voxelize(mesh);
        previewMeshes.push(previewMesh);
        chunk.dispatchEvent(new MessageEvent('previewMesh', {
          data: {
            previewMesh,
          },
        }));
      }
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        const previewMesh = previewMeshes[i];
        chunk.dispatchEvent(new MessageEvent('mesh', {
          data: {
            mesh,
            previewMesh,
          }
        }));
      }
    })();
    chunk.notifyMesh = async mesh => {
      if (mesh.aabb.intersectsBox(aabb)) {
        const previewMesh = await this.voxelize(mesh);
        chunk.dispatchEvent(new MessageEvent('previewMesh', {
          data: {
            previewMesh,
          },
        }));
        chunk.dispatchEvent(new MessageEvent('mesh', {
          data: {
            mesh,
            previewMesh,
          }
        }));
      }
    };
    chunk.destroy = () => {
      this.chunks.splice(this.chunks.indexOf(chunk), 1);
    };
    this.chunks.push(chunk);
    return chunk;
  }
}

class MesherServer {
  handleMessage(data) {
    const {method} = data;
    switch (method) {
      case 'marchPotentials': {
        const allocator = new Allocator();

        const {depthTextures: depthTexturesData, dims: dimsData, shift: shiftData, size: sizeData, pixelRatio, value, nvalue, arrayBuffer} = data;

        const depthTextures = allocator.alloc(Float32Array, depthTexturesData.length);
        depthTextures.set(depthTexturesData);

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
          depthTextures.offset,
          dims.offset,
          shift.offset,
          size.offset,
          pixelRatio,
          value,
          nvalue,
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
};