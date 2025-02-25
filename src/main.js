import './style.css';

import * as THREE from 'three';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

camera.position.set(0, 3000, 20);
camera.lookAt(0, -10, -100);

const citySize = 500;
const sectionLength = 500;
const gridDivisions = 30;
const minBuildingHeight = 10;
const maxBuildingHeight = 30;

const cellSize = citySize / gridDivisions;
// Track city sections and objects to remove
const citySections = [];
let farthestSectionZ = 0;

const buildingMaterials = {
  face: new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 1.0,
  }),
  edge: new THREE.LineBasicMaterial({
    color: 0xffffff,
    linewidth: 2,
    transparent: true,
    opacity: 1.0,
  }),
};

const buildingTypes = [];
for (let i = 0; i < 10; i++) {
  const width = cellSize * 0.95;
  const depth = cellSize * 0.95;
  const height = minBuildingHeight + Math.random() * (maxBuildingHeight - minBuildingHeight);

  const geometry = new THREE.BoxGeometry(width, height, depth);
  const edges = new THREE.EdgesGeometry(geometry);

  buildingTypes.push({
    width,
    depth,
    height,
    geometry,
    edges,
  });
}
function createBuilding(x, z, buildingType) {
  const group = new THREE.Group();

  const type = buildingType || buildingTypes[Math.floor(Math.random() * buildingTypes.length)];

  const building = new THREE.Mesh(type.geometry, buildingMaterials.face);
  building.position.y = type.height / 2;
  group.add(building);

  const wireframe = new THREE.LineSegments(type.edges, buildingMaterials.edge);
  wireframe.position.y = type.height / 2;
  group.add(wireframe);

  group.position.set(x, 0, z);

  return group;
}
const roadSegments = [];
function createRoadGrid(startZ, length) {
  const group = new THREE.Group();
  const gridSize = citySize;
  const lineColor = 0xffffff;
  const lineMaterial = new THREE.LineBasicMaterial({ color: lineColor });

  for (let z = startZ; z >= startZ - length; z -= gridSize / gridDivisions) {
    let horizontalLine;
    if (roadSegments.length > 0) {
      horizontalLine = roadSegments.pop();
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

  for (let x = -gridSize / 2; x <= gridSize / 2; x += gridSize / gridDivisions) {
    const verticalGeometry = new THREE.BufferGeometry();
    const verticalPoints = [new THREE.Vector3(x, 0.1, startZ), new THREE.Vector3(x, 0.1, startZ - length)];
    verticalGeometry.setFromPoints(verticalPoints);
    const verticalLine = new THREE.Line(verticalGeometry, lineMaterial);
    group.add(verticalLine);
  }

  return group;
}

let mouseX = 0;
let mouseY = 0;
let targetCameraY = 30;

document.addEventListener('mousemove', event => {
  mouseX = (event.clientX - window.innerWidth / 2) / window.innerWidth;
  mouseY = (event.clientY - window.innerHeight / 2) / window.innerHeight;
  // Smaller Y movement range
  targetCameraY = 30 + mouseY * -5;
});

function createCitySection(startZ) {
  const section = new THREE.Group();

  const roads = createRoadGrid(startZ, sectionLength);
  section.add(roads);

  const placementMap = Array(gridDivisions)
    .fill()
    .map(() => Array(gridDivisions).fill(false));

  const middleColumn = Math.floor(gridDivisions / 2);

  for (let x = 0; x < gridDivisions; x++) {
    for (let z = 0; z < gridDivisions; z++) {
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
          if (newX >= 0 && newX < gridDivisions && newZ >= 0 && newZ < gridDivisions && placementMap[newX][newZ]) {
            hasAdjacentBuilding = true;
            break;
          }
        }

        if (!hasAdjacentBuilding) {
          placementMap[x][z] = true;

          const posX = -citySize / 2 + x * cellSize + cellSize / 2;
          const posZ = startZ - z * (sectionLength / gridDivisions) - sectionLength / gridDivisions / 2;

          // Create building with random height but fixed width/depth
          const buildingType = buildingTypes[Math.floor(Math.random() * buildingTypes.length)];
          const building = createBuilding(posX, posZ, buildingType);
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

  addCornerBuildings(section, startZ, citySize, placementMap, gridDivisions, cellSize, cornerParams);

  scene.add(section);
  citySections.push({
    group: section,
    startZ: startZ,
    endZ: startZ - sectionLength,
  });

  return section;
}

function addCornerBuildings(section, startZ, gridSize, placementMap, gridDivisions, cellSize, params) {
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
          const posZ = startZ - z * (sectionLength / gridDivisions) - (sectionLength / gridDivisions) * 0.5;

          const buildingType = buildingTypes[Math.floor(Math.random() * buildingTypes.length)];
          const building = createBuilding(posX, posZ, buildingType);
          building.scale.set(params.scale, params.scale, params.scale);
          section.add(building);

          placed = true;
        }

        attempts++;
      }
    }
  });
}

function initializeObjectPool() {
  for (let i = 0; i < 10; i++) {
    const width = cellSize * 0.95;
    const depth = cellSize * 0.95;
    const height = minBuildingHeight + Math.random() * (maxBuildingHeight - minBuildingHeight);

    const geometry = new THREE.BoxGeometry(width, height, depth);
    const edges = new THREE.EdgesGeometry(geometry);

    buildingTypes.push({
      geometry,
      edges,
      width,
      depth,
      height,
    });
  }
}

initializeObjectPool();
createCitySection(0);
createCitySection(-sectionLength);
farthestSectionZ = -sectionLength * 2;

let zoomSpeed = 0.8;
let cameraZ = camera.position.z;

let lastSectionTime = 0;
const sectionGenerationThreshold = 200; // ms

function animate(timestamp) {
  requestAnimationFrame(animate);

  cameraZ -= zoomSpeed;
  camera.position.z = cameraZ;

  camera.position.y += (targetCameraY - camera.position.y) * 0.05;

  camera.rotation.x = mouseY * 0.02;
  camera.rotation.y = mouseX * 0.02;

  if (camera.position.z < farthestSectionZ + sectionLength * 2 && timestamp - lastSectionTime > sectionGenerationThreshold) {
    createCitySection(farthestSectionZ);
    farthestSectionZ -= sectionLength;
    lastSectionTime = timestamp;
  }

  const removeDistance = camera.position.z + sectionLength * 2;
  for (let i = citySections.length - 1; i >= 0; i--) {
    if (citySections[i].endZ > removeDistance) {
      citySections[i].group.traverse(child => {
        if (child instanceof THREE.Line && child.geometry.type === 'BufferGeometry') {
          roadSegments.push(child);
        }
      });

      scene.remove(citySections[i].group);
      citySections.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
