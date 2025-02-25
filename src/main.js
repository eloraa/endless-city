import './style.css';

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';

const GlowShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2() },
    glowAmount: { value: 2.0 },
    glowSize: { value: 4.0 },
    color: { value: new THREE.Color('#f7d7f3') },
    time: { value: 0 },
    isDynamic: { value: true },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float glowAmount;
    uniform float glowSize;
    uniform vec3 color;
    uniform float time;
    uniform bool isDynamic;
    varying vec2 vUv;

    vec3 getDynamicColor() {
      return vec3(
        abs(sin(time * 0.3)),
        abs(sin(time * 0.5)),
        abs(sin(time * 0.7))
      );
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 pixelSize = 1.0 / resolution;
      float brightness = 0.0;

      for(float x = -glowSize; x <= glowSize; x++) {
        for(float y = -glowSize; y <= glowSize; y++) {
          vec2 offset = vec2(x, y) * pixelSize;
          vec4 sampleColor = texture2D(tDiffuse, vUv + offset);
          float dist = length(vec2(x, y)) / glowSize;
          brightness += sampleColor.r * (1.0 - dist);
        }
      }

      brightness = brightness / (glowSize * 2.0);
      
      vec3 glowColor = isDynamic ? getDynamicColor() : color;
      vec3 glow = glowColor * brightness * glowAmount;
      gl_FragColor = vec4(texel.rgb + glow, 1.0);
    }
  `,
};

class City {
  constructor() {
    this.citySize = 500;
    this.sectionLength = 500;
    this.gridDivisions = 30;
    this.minBuildingHeight = 10;
    this.maxBuildingHeight = 30;
    this.cellSize = this.citySize / this.gridDivisions;
    this.citySections = [];
    this.farthestSectionZ = 0;
    this.roadSegments = [];
    this.buildingTypes = [];
    this.mouseX = 0;
    this.mouseY = 0;
    this.targetCameraY = 30;
    this.zoomSpeed = 0.8;
    this.lastSectionTime = 0;
    this.sectionGenerationThreshold = 100;
    this.maxSections = 8;
    this.minVisibleSections = 4;
    this.composer = null;
    this.glowPass = null;
    this.time = 0;

    this.initScene();
    this.initPostProcessing();
    this.initMaterials();
    this.initBuildingTypes();
    this.setupEventListeners();
    this.start();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 5000);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 3000, 20);
    this.camera.lookAt(0, -10, -100);
    this.cameraZ = this.camera.position.z;
    this.camera.position.x = 10;
  }

  initPostProcessing() {
    this.composer = new EffectComposer(this.renderer);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.glowPass = new ShaderPass(GlowShader);
    this.glowPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    this.composer.addPass(this.glowPass);

    this.initGlowControls();
  }

  initMaterials() {
    this.buildingMaterials = {
      face: new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 1.0,
      }),
      edge: new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 2,
        transparent: true,
        opacity: 0.8,
      }),
    };
  }

  initBuildingTypes() {
    for (let i = 0; i < 10; i++) {
      const width = this.cellSize * 0.95;
      const depth = this.cellSize * 0.95;
      const height = this.minBuildingHeight + Math.random() * (this.maxBuildingHeight - this.minBuildingHeight);

      const geometry = new THREE.BoxGeometry(width, height, depth);
      const edges = new THREE.EdgesGeometry(geometry);

      this.buildingTypes.push({
        width,
        depth,
        height,
        geometry,
        edges,
      });
    }
  }

  createBuilding(x, z, buildingType) {
    const group = new THREE.Group();

    const type = buildingType || this.buildingTypes[Math.floor(Math.random() * this.buildingTypes.length)];

    const building = new THREE.Mesh(type.geometry, this.buildingMaterials.face);
    building.position.y = type.height / 2;
    group.add(building);

    const wireframe = new THREE.LineSegments(type.edges, this.buildingMaterials.edge);
    wireframe.position.y = type.height / 2;
    group.add(wireframe);

    group.position.set(x, 0, z);

    return group;
  }

  createRoadGrid(startZ, length) {
    const group = new THREE.Group();
    const gridSize = this.citySize;
    const lineColor = 0xffffff;
    const lineMaterial = new THREE.LineBasicMaterial({ color: lineColor });

    for (let z = startZ; z >= startZ - length; z -= gridSize / this.gridDivisions) {
      let horizontalLine;
      if (this.roadSegments.length > 0) {
        horizontalLine = this.roadSegments.pop();
        const points = horizontalLine.geometry.attributes.position.array;
        points[2] = z;
        points[5] = z;
        horizontalLine.geometry.attributes.position.needsUpdate = true;
      } else {
        const horizontalGeometry = new THREE.BufferGeometry();
        const horizontalPoints = [new THREE.Vector3(-gridSize / 2, 0.1, z), new THREE.Vector3(gridSize / 2, 0.1, z)];
        horizontalGeometry.setFromPoints(horizontalPoints);
        horizontalLine = new THREE.Line(horizontalGeometry, lineMaterial);
      }
      group.add(horizontalLine);
    }

    for (let x = -gridSize / 2; x <= gridSize / 2; x += gridSize / this.gridDivisions) {
      const verticalGeometry = new THREE.BufferGeometry();
      const verticalPoints = [new THREE.Vector3(x, 0.1, startZ), new THREE.Vector3(x, 0.1, startZ - length)];
      verticalGeometry.setFromPoints(verticalPoints);
      const verticalLine = new THREE.Line(verticalGeometry, lineMaterial);
      group.add(verticalLine);
    }

    return group;
  }

  createCitySection(startZ) {
    const section = new THREE.Group();

    const roads = this.createRoadGrid(startZ, this.sectionLength);
    section.add(roads);

    const placementMap = Array(this.gridDivisions)
      .fill()
      .map(() => Array(this.gridDivisions).fill(false));

    const middleColumn = Math.floor(this.gridDivisions / 2);

    for (let x = 0; x < this.gridDivisions; x++) {
      for (let z = 0; z < this.gridDivisions; z++) {
        if (x === middleColumn) continue;

        if (Math.random() < 0.6 && !placementMap[x][z]) {
          let hasAdjacentBuilding = false;
          const checkDirections = [
            { dx: 0, dz: 1 }, // front
            { dx: 0, dz: -1 }, // back
            { dx: 1, dz: 0 }, // right
            { dx: -1, dz: 0 }, // left
          ];

          for (const dir of checkDirections) {
            const newX = x + dir.dx;
            const newZ = z + dir.dz;
            if (newX >= 0 && newX < this.gridDivisions && newZ >= 0 && newZ < this.gridDivisions && placementMap[newX][newZ]) {
              hasAdjacentBuilding = true;
              break;
            }
          }

          if (!hasAdjacentBuilding) {
            placementMap[x][z] = true;

            const posX = -this.citySize / 2 + x * this.cellSize + this.cellSize / 2;
            const posZ = startZ - z * (this.sectionLength / this.gridDivisions) - this.sectionLength / this.gridDivisions / 2;

            const buildingType = this.buildingTypes[Math.floor(Math.random() * this.buildingTypes.length)];
            const building = this.createBuilding(posX, posZ, buildingType);
            section.add(building);
          }
        }
      }
    }

    const cornerParams = {
      buildingCount: 15 + Math.floor(Math.random() * 10),
      scale: 0.85,
      probability: 0.7,
    };

    this.addCornerBuildings(section, startZ, this.citySize, placementMap, this.gridDivisions, this.cellSize, cornerParams);

    this.scene.add(section);
    this.citySections.push({
      group: section,
      startZ: startZ,
      endZ: startZ - this.sectionLength,
    });

    return section;
  }

  addCornerBuildings(section, startZ, gridSize, placementMap, gridDivisions, cellSize, params) {
    const corners = [
      { xStart: 0, xEnd: gridDivisions * 0.2, zStart: 0, zEnd: gridDivisions * 0.2 },
      { xStart: gridDivisions * 0.8, xEnd: gridDivisions, zStart: 0, zEnd: gridDivisions * 0.2 },
      { xStart: 0, xEnd: gridDivisions * 0.2, zStart: gridDivisions * 0.8, zEnd: gridDivisions },
      { xStart: gridDivisions * 0.8, xEnd: gridDivisions, zStart: gridDivisions * 0.8, zEnd: gridDivisions },
    ];

    corners.forEach(corner => {
      for (let i = 0; i < params.buildingCount; i++) {
        let attempts = 0;
        let placed = false;

        while (!placed && attempts < 15) {
          const x = Math.floor(corner.xStart + Math.random() * (corner.xEnd - corner.xStart));
          const z = Math.floor(corner.zStart + Math.random() * (corner.zEnd - corner.zStart));

          if (x < gridDivisions && z < gridDivisions && !placementMap[x][z] && Math.random() < params.probability) {
            placementMap[x][z] = true;

            const posX = -gridSize / 2 + x * cellSize + cellSize * 0.5;
            const posZ = startZ - z * (this.sectionLength / gridDivisions) - (this.sectionLength / gridDivisions) * 0.5;

            const buildingType = this.buildingTypes[Math.floor(Math.random() * this.buildingTypes.length)];
            const building = this.createBuilding(posX, posZ, buildingType);
            building.scale.set(params.scale, params.scale, params.scale);
            section.add(building);

            placed = true;
          }

          attempts++;
        }
      }
    });
  }

  animate = timestamp => {
    requestAnimationFrame(this.animate);

    this.time += 0.01;
    this.glowPass.uniforms.time.value = this.time;

    this.cameraZ -= this.zoomSpeed;
    this.camera.position.z = this.cameraZ;

    this.camera.position.y += (this.targetCameraY - this.camera.position.y) * 0.05;

    this.camera.rotation.x = this.mouseY * 0.02;
    this.camera.rotation.y = this.mouseX * 0.02;

    const sectionsAhead = this.citySections.filter(section => section.endZ < this.camera.position.z).length;

    if (sectionsAhead < this.minVisibleSections && timestamp - this.lastSectionTime > this.sectionGenerationThreshold) {
      this.createCitySection(this.farthestSectionZ);
      this.farthestSectionZ -= this.sectionLength;
      this.lastSectionTime = timestamp;
    }

    this.cleanupSections();
    this.composer.render();
  };

  cleanupSections() {
    const removeDistance = this.camera.position.z + this.sectionLength * 3;

    while (this.citySections.length > this.maxSections) {
      const furthestSection = this.citySections[this.citySections.length - 1];
      if (furthestSection.endZ > removeDistance) {
        furthestSection.group.traverse(child => {
          if (child instanceof THREE.Line && child.geometry.type === 'BufferGeometry') {
            this.roadSegments.push(child);
          }
        });

        this.scene.remove(furthestSection.group);
        this.citySections.pop();
      } else {
        break;
      }
    }
  }

  setupEventListeners() {
    document.addEventListener('mousemove', event => {
      this.mouseX = (event.clientX - window.innerWidth / 2) / window.innerWidth;
      this.mouseY = (event.clientY - window.innerHeight / 2) / window.innerHeight;
      this.targetCameraY = 30 + this.mouseY * -5;
    });

    window.addEventListener('resize', () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(width, height);
      this.composer.setSize(width, height);

      this.glowPass.uniforms.resolution.value.set(width, height);
    });
  }

  initGlowControls() {
    const controls = document.createElement('div');
    controls.style.position = 'fixed';
    controls.style.top = '10px';
    controls.style.right = '10px';
    controls.style.color = 'white';
    controls.style.background = 'rgba(0,0,0,0.5)';
    controls.style.padding = '10px';
    controls.style.borderRadius = '5px';

    controls.innerHTML = `
      <style>
        .control-row {
          display: flex;
          align-items: center;
          margin-bottom: 10px;
          gap: 10px;
        }
        .manual-input {
          width: 60px;
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.3);
          color: white;
          padding: 2px 5px;
          border-radius: 3px;
        }
      </style>
      <div class="control-row">
        <label>Glow Amount: <input id="glowAmount" type="range" min="0" max="3" step="0.1" value="2.0"></label>
        <span id="glowAmountValue">2.0</span>
        <input type="number" id="glowAmountManual" class="manual-input" value="2.0" step="0.1">
      </div>
      <div class="control-row">
        <label>Glow Size: <input id="glowSize" type="range" min="1" max="10" step="0.5" value="4.0"></label>
        <span id="glowSizeValue">4.0</span>
        <input type="number" id="glowSizeManual" class="manual-input" value="4.0" step="0.5">
      </div>
      <div class="control-row">
        <label>Color: <input id="glowColor" type="color" value="#f7d7f3"></label>
        <span id="glowColorValue">#f7d7f3</span>
      </div>
      <div class="control-row">
        <label><input id="dynamicColor" type="checkbox" checked> Dynamic Color</label>
      </div>
      <div style="border-top: 1px solid white; margin: 10px 0; padding-top: 10px;">
        <h4 style="margin: 0 0 10px 0;">Camera Controls</h4>
        <div class="control-row">
          <label>Camera X: <input id="cameraX" type="range" min="-100" max="100" step="1" value="0"></label>
          <span id="cameraXValue">0</span>
          <input type="number" id="cameraXManual" class="manual-input" value="0">
        </div>
        <div class="control-row">
          <label>Camera Y: <input id="cameraY" type="range" min="10" max="100" step="1" value="30"></label>
          <span id="cameraYValue">30</span>
          <input type="number" id="cameraYManual" class="manual-input" value="30">
        </div>
        <div class="control-row">
          <label>Camera Speed: <input id="cameraSpeed" type="range" min="0" max="2" step="0.1" value="0.8"></label>
          <span id="cameraSpeedValue">0.8</span>
          <input type="number" id="cameraSpeedManual" class="manual-input" value="0.8" step="0.1">
        </div>
        <div class="control-row">
          <label>FOV: <input id="cameraFov" type="range" min="20" max="120" step="1" value="90"></label>
          <span id="cameraFovValue">90</span>
          <input type="number" id="cameraFovManual" class="manual-input" value="90">
        </div>
      </div>
    `;

    const amountInput = controls.querySelector('#glowAmount');
    const sizeInput = controls.querySelector('#glowSize');
    const colorInput = controls.querySelector('#glowColor');
    const dynamicToggle = controls.querySelector('#dynamicColor');
    const cameraXInput = controls.querySelector('#cameraX');
    const cameraYInput = controls.querySelector('#cameraY');
    const cameraSpeedInput = controls.querySelector('#cameraSpeed');
    const cameraFovInput = controls.querySelector('#cameraFov');

    const amountManual = controls.querySelector('#glowAmountManual');
    const sizeManual = controls.querySelector('#glowSizeManual');
    const cameraXManual = controls.querySelector('#cameraXManual');
    const cameraYManual = controls.querySelector('#cameraYManual');
    const cameraSpeedManual = controls.querySelector('#cameraSpeedManual');
    const cameraFovManual = controls.querySelector('#cameraFovManual');

    const amountValue = controls.querySelector('#glowAmountValue');
    const sizeValue = controls.querySelector('#glowSizeValue');
    const colorValue = controls.querySelector('#glowColorValue');
    const cameraXValue = controls.querySelector('#cameraXValue');
    const cameraYValue = controls.querySelector('#cameraYValue');
    const cameraSpeedValue = controls.querySelector('#cameraSpeedValue');
    const cameraFovValue = controls.querySelector('#cameraFovValue');

    controls.querySelectorAll('span').forEach(span => {
      span.style.marginLeft = '10px';
      span.style.fontSize = '0.9em';
      span.style.opacity = '0.8';
    });

    const updateValue = (value, slider, display, manual, toFixed = true) => {
      slider.value = value;
      display.textContent = toFixed ? parseFloat(value).toFixed(1) : value;
      manual.value = value;
      return parseFloat(value);
    };

    amountInput.addEventListener('input', e => {
      const value = updateValue(e.target.value, amountInput, amountValue, amountManual);
      this.glowPass.uniforms.glowAmount.value = value;
    });

    amountManual.addEventListener('change', e => {
      const value = updateValue(e.target.value, amountInput, amountValue, amountManual);
      this.glowPass.uniforms.glowAmount.value = value;
    });

    sizeInput.addEventListener('input', e => {
      const value = updateValue(e.target.value, sizeInput, sizeValue, sizeManual);
      this.glowPass.uniforms.glowSize.value = value;
    });

    sizeManual.addEventListener('change', e => {
      const value = updateValue(e.target.value, sizeInput, sizeValue, sizeManual);
      this.glowPass.uniforms.glowSize.value = value;
    });

    colorInput.addEventListener('input', e => {
      const value = e.target.value;
      this.glowPass.uniforms.color.value = new THREE.Color(value);
      colorValue.textContent = value;
    });

    dynamicToggle.addEventListener('change', e => {
      this.glowPass.uniforms.isDynamic.value = e.target.checked;
    });

    cameraXInput.addEventListener('input', e => {
      const value = updateValue(e.target.value, cameraXInput, cameraXValue, cameraXManual, false);
      this.camera.position.x = value;
    });

    cameraXManual.addEventListener('change', e => {
      const value = updateValue(e.target.value, cameraXInput, cameraXValue, cameraXManual, false);
      this.camera.position.x = value;
    });

    cameraYInput.addEventListener('input', e => {
      const value = updateValue(e.target.value, cameraYInput, cameraYValue, cameraYManual, false);
      this.targetCameraY = value;
    });

    cameraYManual.addEventListener('change', e => {
      const value = updateValue(e.target.value, cameraYInput, cameraYValue, cameraYManual, false);
      this.targetCameraY = value;
    });

    cameraSpeedInput.addEventListener('input', e => {
      const value = updateValue(e.target.value, cameraSpeedInput, cameraSpeedValue, cameraSpeedManual);
      this.zoomSpeed = value;
    });

    cameraSpeedManual.addEventListener('change', e => {
      const value = updateValue(e.target.value, cameraSpeedInput, cameraSpeedValue, cameraSpeedManual);
      this.zoomSpeed = value;
    });

    cameraFovInput.addEventListener('input', e => {
      const value = updateValue(e.target.value, cameraFovInput, cameraFovValue, cameraFovManual, false);
      this.camera.fov = value;
      this.camera.updateProjectionMatrix();
    });

    cameraFovManual.addEventListener('change', e => {
      const value = updateValue(e.target.value, cameraFovInput, cameraFovValue, cameraFovManual, false);
      this.camera.fov = value;
      this.camera.updateProjectionMatrix();
    });

    document.body.appendChild(controls);
  }

  start() {
    let currentZ = 0;
    for (let i = 0; i < this.minVisibleSections; i++) {
      this.createCitySection(currentZ);
      currentZ -= this.sectionLength;
    }
    this.farthestSectionZ = currentZ;
    this.animate();
  }
}

new City();
