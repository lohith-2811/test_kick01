import React, { useState, useRef, useMemo, Suspense, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useTexture, Text } from '@react-three/drei';
import * as THREE from 'three';

// --- GLOBAL FETCH CACHE (Fixes CORS & 429 Too Many Requests) ---
let cachedGeoData = null;
let geoFetchPromise = null;

function fetchGeoData() {
  if (cachedGeoData) return Promise.resolve(cachedGeoData);
  if (!geoFetchPromise) {
    // Pulling the exact same data from jsDelivr's NPM mirror which allows CORS
    geoFetchPromise = fetch('https://cdn.jsdelivr.net/npm/@highcharts/map-collection/countries/in/in-all.geo.json')
      .then(res => res.json())
      .then(data => {
        cachedGeoData = data;
        return data;
      })
      .catch(err => console.error("Failed to fetch map data:", err));
  }
  return geoFetchPromise;
}

// --- MATHEMATICAL HELPER TO DRAW SHAPES ---
function isInsidePolygon(point, vs) {
  let x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    let xi = vs[i][0], yi = vs[i][1];
    let xj = vs[j][0], yj = vs[j][1];
    let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// --- 1. THE HIGH-TECH 3D EARTH GLOBE ---
function DottedGlobe({ onExplode }) {
  const groupRef = useRef();
  const materialRef = useRef();
  const innerSphereRef = useRef();
  const [phase, setPhase] = useState('spinning');
  const targetRotation = useRef({ x: 0.35, y: 0 });

  const earthMap = useTexture('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg');

  const particlesCount = 75000; 
  const { positions, uvs } = useMemo(() => {
    const posArray = new Float32Array(particlesCount * 3);
    const uvArray = new Float32Array(particlesCount * 2);
    const phi = Math.PI * (3 - Math.sqrt(5)); 
    for (let i = 0; i < particlesCount; i++) {
      const y = 1 - (i / (particlesCount - 1)) * 2; 
      const radius = Math.sqrt(1 - y * y); 
      const theta = phi * i; 
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      posArray[i * 3] = x * 2; posArray[i * 3 + 1] = y * 2; posArray[i * 3 + 2] = z * 2;
      uvArray[i * 2] = 0.5 + (Math.atan2(z, x) / (2 * Math.PI));
      uvArray[i * 2 + 1] = 0.5 + (Math.asin(y) / Math.PI);
    }
    return { positions: posArray, uvs: uvArray };
  }, []);

  const shaderArgs = useMemo(() => ({
    uniforms: {
      earthMap: { value: earthMap },
      uExplodeTime: { value: 0.0 },
      opacity: { value: 1.0 }
    },
    vertexShader: `
      uniform float uExplodeTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 dir = normalize(position);
        float randomSpeed = 1.0 + fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 54.53))) * 43758.5453) * 3.0;
        vec3 newPosition = position + (dir * uExplodeTime * randomSpeed);
        vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
        gl_PointSize = 2.5 * (10.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D earthMap;
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        vec4 texColor = texture2D(earthMap, vUv);
        if (texColor.r > 0.5) discard;
        if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, opacity);
      }
    `,
    transparent: true, depthWrite: false
  }), [earthMap]);

  useFrame(() => {
    if (!materialRef.current) return;
    if (phase === 'spinning') {
      groupRef.current.rotation.y += 0.002;
    } else if (phase === 'focusing') {
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetRotation.current.x, 0.03);
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetRotation.current.y, 0.03);
    } else if (phase === 'exploding') {
      materialRef.current.uniforms.uExplodeTime.value += 0.02;
      groupRef.current.rotation.y += 0.005; 
      materialRef.current.uniforms.opacity.value -= 0.003;
      if (innerSphereRef.current) {
        const scale = Math.max(0, innerSphereRef.current.scale.x - 0.01);
        innerSphereRef.current.scale.set(scale, scale, scale);
      }
      if (materialRef.current.uniforms.opacity.value <= 0) {
        setPhase('done');
        onExplode();
      }
    }
  });

  const handleClick = () => {
    if (phase !== 'spinning') return;
    const currentY = groupRef.current.rotation.y;
    const twoPi = Math.PI * 2;
    let nextY = Math.floor(currentY / twoPi) * twoPi + 1.45; 
    if (nextY < currentY) nextY += twoPi; 
    targetRotation.current.y = nextY;
    setPhase('focusing');
    setTimeout(() => setPhase('exploding'), 1800);
  };

  return (
    <group ref={groupRef} onClick={handleClick}>
      <mesh ref={innerSphereRef}><sphereGeometry args={[1.98, 64, 64]} /><meshBasicMaterial color="#000000" /></mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={particlesCount} array={positions} itemSize={3} />
          <bufferAttribute attach="attributes-uv" count={particlesCount} array={uvs} itemSize={2} />
        </bufferGeometry>
        <shaderMaterial ref={materialRef} args={[shaderArgs]} />
      </points>
    </group>
  );
}

// --- 2. THE 3D HOLOGRAPHIC INDIA DOT MAP ---
function India3DDotMap({ onExplode }) {
  const [geometryData, setGeometryData] = useState(null);
  const materialRef = useRef();
  const [isExploding, setIsExploding] = useState(false);

  useEffect(() => {
    fetchGeoData().then(data => {
      if (!data) return;
      const features = data.features;
      const pts = []; const offsets = [];
      for (let lon = 68; lon <= 98; lon += 0.25) {
        for (let lat = 6; lat <= 38; lat += 0.25) {
          let inside = false;
          for (let feature of features) {
            if (feature.geometry.type === 'Polygon' && isInsidePolygon([lon, lat], feature.geometry.coordinates[0])) inside = true;
            else if (feature.geometry.type === 'MultiPolygon') {
              for (let poly of feature.geometry.coordinates) {
                if (isInsidePolygon([lon, lat], poly[0])) inside = true;
              }
            }
          }
          if (inside) {
            pts.push((lon - 82.5) * 0.2, (lat - 22.5) * 0.22, 0);
            offsets.push((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
          }
        }
      }
      setGeometryData({ positions: new Float32Array(pts), offsets: new Float32Array(offsets), count: pts.length / 3 });
    });
  }, []);

  const shaderArgs = useMemo(() => ({
    uniforms: {
      uTime: { value: 0.0 }, uProgress: { value: 0.0 },
      uExplode: { value: 0.0 }, uOpacity: { value: 0.8 } 
    },
    vertexShader: `
      uniform float uTime; uniform float uProgress; uniform float uExplode;
      attribute vec3 offset;
      void main() {
        vec3 targetPos = position;
        targetPos.z += sin(targetPos.x * 2.0 + uTime * 2.0) * 0.15;
        targetPos.z += cos(targetPos.y * 2.0 + uTime * 2.0) * 0.15;
        vec3 startPos = targetPos + offset;
        vec3 finalPos = mix(startPos, targetPos, uProgress);
        
        vec3 explodeDir = normalize(finalPos + vec3(0.001, 0.001, 1.0));
        float speed = 1.0 + fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 54.53))) * 43758.5453) * 5.0;
        finalPos += explodeDir * uExplode * speed;

        vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
        gl_PointSize = 2.5 * (10.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      void main() {
        if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, uOpacity);
      }
    `,
    transparent: true, depthWrite: false
  }), []);

  useFrame((state) => {
    if (!materialRef.current) return;
    if (!isExploding) {
      if (materialRef.current.uniforms.uProgress.value < 1.0) materialRef.current.uniforms.uProgress.value += 0.005;
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    } else {
      materialRef.current.uniforms.uExplode.value += 0.05;
      materialRef.current.uniforms.uOpacity.value -= 0.015;
      if (materialRef.current.uniforms.uOpacity.value <= 0) onExplode();
    }
  });

  if (!geometryData) return null;

  return (
    <group>
      <mesh onClick={() => setIsExploding(true)} position={[0, 0, -0.5]}>
        <planeGeometry args={[15, 15]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={geometryData.count} array={geometryData.positions} itemSize={3} />
          <bufferAttribute attach="attributes-offset" count={geometryData.count} array={geometryData.offsets} itemSize={3} />
        </bufferGeometry>
        <shaderMaterial ref={materialRef} args={[shaderArgs]} />
      </points>
    </group>
  );
}

// --- 3. THE 3D HOLOGRAPHIC ANDHRA PRADESH DOT MAP ---
function AndhraPradesh3DDotMap({ onExplode }) {
  const [geometryData, setGeometryData] = useState(null);
  const materialRef = useRef();
  const [isExploding, setIsExploding] = useState(false);

  useEffect(() => {
    fetchGeoData().then(data => {
      if (!data) return;
      const features = data.features;
      const pts = []; const offsets = [];
      for (let lon = 76.5; lon <= 85.0; lon += 0.04) {
        for (let lat = 12.5; lat <= 19.5; lat += 0.04) {
          let inside = false;
          for (let feature of features) {
            if (feature.properties.name && feature.properties.name.toLowerCase().includes('andhra')) {
              if (feature.geometry.type === 'Polygon' && isInsidePolygon([lon, lat], feature.geometry.coordinates[0])) inside = true;
              else if (feature.geometry.type === 'MultiPolygon') {
                for (let poly of feature.geometry.coordinates) {
                  if (isInsidePolygon([lon, lat], poly[0])) inside = true;
                }
              }
            }
          }
          if (inside) {
            pts.push((lon - 79.5) * 1.0, (lat - 16.0) * 1.0, 0);
            offsets.push((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
          }
        }
      }
      setGeometryData({ positions: new Float32Array(pts), offsets: new Float32Array(offsets), count: pts.length / 3 });
    });
  }, []);

  const shaderArgs = useMemo(() => ({
    uniforms: { 
      uTime: { value: 0.0 }, 
      uProgress: { value: 0.0 },
      uExplode: { value: 0.0 }, 
      uOpacity: { value: 0.9 }
    },
    vertexShader: `
      uniform float uTime; uniform float uProgress; uniform float uExplode;
      attribute vec3 offset;
      void main() {
        vec3 targetPos = position;
        targetPos.z += sin(targetPos.x * 3.0 + uTime * 2.0) * 0.2;
        targetPos.z += cos(targetPos.y * 3.0 + uTime * 2.0) * 0.2;
        vec3 startPos = targetPos + offset;
        vec3 finalPos = mix(startPos, targetPos, uProgress);

        vec3 explodeDir = normalize(finalPos + vec3(0.0, 0.0, 1.0));
        float speed = 1.0 + fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 54.53))) * 43758.5453) * 6.0;
        finalPos += explodeDir * uExplode * speed;

        vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
        gl_PointSize = 2.0 * (10.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      void main() {
        if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, uOpacity);
      }
    `,
    transparent: true, depthWrite: false
  }), []);

  useFrame((state) => {
    if (!materialRef.current) return;
    if (!isExploding) {
      if (materialRef.current.uniforms.uProgress.value < 1.0) materialRef.current.uniforms.uProgress.value += 0.006;
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    } else {
      materialRef.current.uniforms.uExplode.value += 0.06;
      materialRef.current.uniforms.uOpacity.value -= 0.02;
      if (materialRef.current.uniforms.uOpacity.value <= 0) onExplode();
    }
  });

  if (!geometryData) return null;

  return (
    <group>
      <mesh onClick={() => setIsExploding(true)} position={[0, 0, -0.5]}>
        <planeGeometry args={[30, 30]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={geometryData.count} array={geometryData.positions} itemSize={3} />
          <bufferAttribute attach="attributes-offset" count={geometryData.count} array={geometryData.offsets} itemSize={3} />
        </bufferGeometry>
        <shaderMaterial ref={materialRef} args={[shaderArgs]} />
      </points>
    </group>
  );
}

// --- 4. REALISTIC NATURE TREADMILL (GRASS & FLOWERS) ---
function TerrainChunk({ offsetZ }) {
  const groupRef = useRef();
  const grassRef = useRef();
  const flowersRef = useRef();

  const size = 60;
  const numGrass = 3000;
  const numFlowers = 250;

  useEffect(() => {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < numGrass; i++) {
      dummy.position.set((Math.random() - 0.5) * size, 0, (Math.random() - 0.5) * size);
      dummy.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, 0);
      dummy.scale.set(1, 1 + Math.random() * 2, 1);
      dummy.updateMatrix();
      grassRef.current.setMatrixAt(i, dummy.matrix);
      
      color.setHSL(0.28 + Math.random() * 0.05, 0.8, 0.15 + Math.random() * 0.15);
      grassRef.current.setColorAt(i, color);
    }
    grassRef.current.instanceMatrix.needsUpdate = true;
    grassRef.current.instanceColor.needsUpdate = true;

    for (let i = 0; i < numFlowers; i++) {
      dummy.position.set((Math.random() - 0.5) * size, Math.random() * 0.3 + 0.2, (Math.random() - 0.5) * size);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.setScalar(0.5 + Math.random() * 1.5);
      dummy.updateMatrix();
      flowersRef.current.setMatrixAt(i, dummy.matrix);

      const hue = Math.random() > 0.5 ? Math.random() * 0.1 : 0.7 + Math.random() * 0.2;
      color.setHSL(hue, 0.9, 0.6);
      flowersRef.current.setColorAt(i, color);
    }
    flowersRef.current.instanceMatrix.needsUpdate = true;
    flowersRef.current.instanceColor.needsUpdate = true;
  }, []);

  useFrame((state, delta) => {
    const speed = 6; 
    groupRef.current.position.z += speed * delta;
    if (groupRef.current.position.z > size / 2) {
      groupRef.current.position.z -= size * 2;
    }
  });

  return (
    <group ref={groupRef} position={[0, -3, offsetZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#0a1705" roughness={1} />
      </mesh>
      
      <instancedMesh ref={grassRef} args={[null, null, numGrass]} castShadow receiveShadow>
        <coneGeometry args={[0.04, 0.6, 3]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>

      <instancedMesh ref={flowersRef} args={[null, null, numFlowers]} castShadow>
        <sphereGeometry args={[0.1, 7, 7]} />
        <meshStandardMaterial emissiveIntensity={0.4} roughness={0.4} />
      </instancedMesh>
    </group>
  );
}

function NatureEnvironment() {
  return (
    <group>
      <ambientLight intensity={1.2} color="#ffffff" />
      <directionalLight position={[5, 10, -5]} intensity={2.5} color="#ffd4a3" castShadow />
      <pointLight position={[0, 2, 5]} intensity={1} color="#5588ff" />
      
      <TerrainChunk offsetZ={0} />
      <TerrainChunk offsetZ={-60} />
      
      <Fireflies />
    </group>
  );
}

function Fireflies() {
  const pointsRef = useRef();
  const count = 300;
  
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3] = (Math.random() - 0.5) * 40;
      pos[i*3+1] = Math.random() * 4 - 2;
      pos[i*3+2] = (Math.random() - 0.5) * 40;
    }
    return pos;
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for(let i=0; i < count; i++) {
      pointsRef.current.geometry.attributes.position.array[i*3+1] += Math.sin(t * 2 + i) * 0.005;
      pointsRef.current.geometry.attributes.position.array[i*3] += Math.cos(t * 1.5 + i) * 0.005;
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.15} color="#ffffaa" transparent opacity={0.8} depthWrite={false} />
    </points>
  );
}

// --- 4.5 NEW: 3D TYPING POEM ---
function TypingPoem() {
  const fullText = `On this special day so bright,
You bring the world a lovely light.
With laughter loud and a heart so true,
Life feels more beautiful because of you.

Through every smile and every tear,
You’ve been the friend who’s always near.
A bond like ours is rare to find,
A golden heart, a caring mind.

May your dreams fly high and far,
Shining bright like the brightest star.
May joy and love fill every day,
And happiness forever stay.

Happy Birthday to my best buddy so dear,
I’m grateful to have you every year.
Stay amazing, kind, and true—
The world is lucky to have you. 🎉💖`;

  const [displayedText, setDisplayedText] = useState("");
  const textRef = useRef();

  useEffect(() => {
    let currentIndex = 0;
    const intervalId = setInterval(() => {
      setDisplayedText(fullText.slice(0, currentIndex));
      currentIndex++;
      if (currentIndex > fullText.length) {
        clearInterval(intervalId);
      }
    }, 45); 

    return () => clearInterval(intervalId);
  }, [fullText]);

  useFrame((state) => {
    if (textRef.current) {
      textRef.current.position.y = Math.sin(state.clock.elapsedTime * 1.5) * 0.15 + 1.2;
    }
  });

  return (
    <Text
      ref={textRef}
      position={[0, 1.2, 0]}
      fontSize={0.25}
      color="#ffebb5" 
      textAlign="center"
      maxWidth={7}
      lineHeight={1.4}
      // FONT PROP REMOVED: Triggers 100% reliable fallback font (Roboto).
      anchorX="center"
      anchorY="middle"
    >
      {displayedText}
    </Text>
  );
}

// --- 5. MAIN APP ---
export default function App() {
  const [currentView, setCurrentView] = useState('globe');

  let title = "CLICK EARTH TO LOCATE INDIA";
  if (currentView === 'india') title = "CLICK INDIA TO LOCATE ANDHRA PRADESH";
  if (currentView === 'ap') title = "CLICK ANDHRA PRADESH FOR A SURPRISE";
  if (currentView === 'poem') title = "HAPPY BIRTHDAY!";

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#050505', overflow: 'hidden' }}>
      
      <h1 style={{ position: 'absolute', top: 30, width: '100%', textAlign: 'center', zIndex: 10, pointerEvents: 'none', color: '#ffffff', fontFamily: 'sans-serif', letterSpacing: '2px', fontWeight: '300', fontSize: '18px', textShadow: '0px 2px 4px rgba(0,0,0,0.8)' }}>
        {title}
      </h1>

      <Canvas camera={{ position: [0, 1.5, 9] }} shadows>
        {currentView === 'poem' && <fog attach="fog" args={['#050505', 10, 45]} />}
        
        {currentView === 'globe' && (
          <Suspense fallback={null}>
            <ambientLight intensity={0.5} />
            <DottedGlobe onExplode={() => setCurrentView('india')} />
          </Suspense>
        )}
        
        {currentView === 'india' && (
          <Suspense fallback={null}>
            <ambientLight intensity={0.5} />
            <India3DDotMap onExplode={() => setCurrentView('ap')} />
          </Suspense>
        )}

        {currentView === 'ap' && (
          <Suspense fallback={null}>
            <ambientLight intensity={0.5} />
            <AndhraPradesh3DDotMap onExplode={() => setCurrentView('poem')} />
          </Suspense>
        )}

        {currentView === 'poem' && (
          <Suspense fallback={null}>
            <NatureEnvironment />
            <TypingPoem />
          </Suspense>
        )}
        
        <OrbitControls enableZoom={true} maxZoom={20} minZoom={3} maxPolarAngle={Math.PI / 2 - 0.1} />
      </Canvas>
    </div>
  );
}