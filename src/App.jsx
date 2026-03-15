import React, { useRef, useMemo, useState, useEffect } from "react";
import { Canvas as R3FCanvas, useFrame } from "@react-three/fiber";
import { Stars, OrbitControls } from "@react-three/drei";
import { Box, GlobalStyles, ThemeProvider, createTheme } from "@mui/material";
import * as THREE from "three";

// --- 1. MUI THEME SETUP ---
const theme = createTheme({
  typography: { fontFamily: '"Playfair Display", "Georgia", serif' },
});

// --- 2. 3D "SEED" COMPONENT (SNOW EFFECT) ---
function SeedGlobe({ phase, setPhase }) {
  const groupRef = useRef();
  const materialRef = useRef();
  const velocityRef = useRef(0.015); 
  const hasTriggeredExplosion = useRef(false); 
  const particlesCount = 50000; 
  const globeRadius = 2;

  const { positions } = useMemo(() => {
    const posArray = new Float32Array(particlesCount * 3);
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < particlesCount; i++) {
      const y = 1 - (i / (particlesCount - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = phi * i;
      posArray[i * 3] = Math.cos(theta) * radius * globeRadius;
      posArray[i * 3 + 1] = y * globeRadius;
      posArray[i * 3 + 2] = Math.sin(theta) * radius * globeRadius;
    }
    return { positions: posArray };
  }, []);

  const shaderArgs = useMemo(() => ({
    uniforms: {
      uExplodeTime: { value: 0 }, uTime: { value: 0 }, 
      opacity: { value: 1 }, uBrightness: { value: 0.3 }, 
      uColor: { value: new THREE.Color("#FFF59D") },
    },
    vertexShader: `
      uniform float uExplodeTime; uniform float uTime;
      varying float vFacing; varying float vRandom;
      void main() {
        vec3 dir = normalize(position);
        float randomVal = fract(sin(dot(position.xyz, vec3(12.9898,78.233,54.53))) * 43758.5453);
        vRandom = randomVal;
        float speed = 1.0 + randomVal * 2.5;
        vec3 newPos = position + dir * uExplodeTime * speed;
        if (uExplodeTime > 0.0) {
          float flutter = uExplodeTime * 0.3; 
          newPos.x += sin(uTime * 1.5 + randomVal * 20.0) * flutter;
          newPos.y += cos(uTime * 1.2 + randomVal * 15.0) * flutter;
          newPos.z += sin(uTime * 1.8 + randomVal * 25.0) * flutter;
        }
        vec4 worldPos = modelMatrix * vec4(newPos, 1.0);
        vec3 worldNormal = normalize(mat3(modelMatrix) * dir);
        vFacing = dot(worldNormal, normalize(cameraPosition - worldPos.xyz));
        vec4 mvPosition = viewMatrix * worldPos;
        gl_PointSize = (3.0 + randomVal * 4.0) * (10.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float opacity; uniform float uBrightness; uniform vec3 uColor; uniform float uTime;
      varying float vFacing; varying float vRandom;
      void main() {
        float r = length(gl_PointCoord - vec2(0.5));
        float strength = pow(1.0 - smoothstep(0.0, 0.5, r), 1.5); 
        if(strength <= 0.01) discard; 
        float depthFade = max(0.3, smoothstep(-0.2, 0.5, vFacing));
        float twinkle = 0.5 + 0.5 * sin(uTime * 2.0 + vRandom * 50.0);
        vec3 finalColor = mix(uColor * uBrightness, vec3(1.0), 0.2);
        gl_FragColor = vec4(finalColor, opacity * strength * depthFade * twinkle);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, 
  }), []);

  useFrame((state, delta) => {
    if (!materialRef.current || !groupRef.current) return;
    materialRef.current.uniforms.uTime.value += delta;

    if (phase === "charging") {
      materialRef.current.uniforms.uBrightness.value += 0.02; 
      groupRef.current.rotation.y += 0.005; groupRef.current.rotation.x += 0.002;
      if (materialRef.current.uniforms.uBrightness.value >= 4.0 && !hasTriggeredExplosion.current) {
        hasTriggeredExplosion.current = true;
        setPhase("exploding"); 
      }
    }

    if (phase === "exploding") {
      materialRef.current.uniforms.uExplodeTime.value += velocityRef.current;
      velocityRef.current *= 0.99; 
      materialRef.current.uniforms.opacity.value = Math.max(0, materialRef.current.uniforms.opacity.value - 0.0015);
      groupRef.current.rotation.y += 0.0005;
    }
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={particlesCount} array={positions} itemSize={3} />
        </bufferGeometry>
        <shaderMaterial ref={materialRef} args={[shaderArgs]} />
      </points>
      {phase === "idle" && (
        <mesh onClick={() => setPhase("charging")} onPointerOver={() => document.body.style.cursor="pointer"} onPointerOut={() => document.body.style.cursor="auto"}>
          <sphereGeometry args={[globeRadius + 0.1, 32, 32]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
    </group>
  );
}

// --- 3. 2D CANVAS: HIGH CLARITY STATE MACHINE ---
function StoryOverlay({ show }) {
  const canvasRef = useRef(null);
  const showRef = useRef(show);

  useEffect(() => { showRef.current = show; }, [show]);

  useEffect(() => {
    let animationFrameId;
    
    // Preload both user images
    const loadedImg1 = new Image(); loadedImg1.src = "img_001.png";
    const loadedImg2 = new Image(); loadedImg2.src = "img_002.png"; // Butterfly Image

    document.fonts.ready.then(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      
      let width = window.innerWidth;
      let height = window.innerHeight;
      canvas.width = width; canvas.height = height;

      // --- STATE MACHINE VARIABLES ---
      let animState = 'HIDDEN'; 
      let progress1 = 0; 
      let eraseX = 0, eraseX2 = 0;
      let stateTimer = 0;
      let particles = [];
      let lastTime = performance.now();
      
      // Dynamic Step Sizes - High density for perfect clarity
      const textStep = Math.ceil(width / 800) + 1; 
      const imgStep = width < 768 ? 1 : 2; 
      const pSizeText = 2.5;
      const pSizeImg = imgStep * 1.4;

      const text1 = "Someone planted a seed in my heart…";

      const extractTextPixels = (text) => {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `300 ${Math.min(width * 0.045, 48)}px "Playfair Display", serif`;
        ctx.fillText(text, width/2, height/2);
        
        const imgData = ctx.getImageData(0, 0, width, height).data;
        const pts = [];
        for (let y = 0; y < height; y += textStep) {
          for (let x = 0; x < width; x += textStep) {
            if (imgData[(y * width + x) * 4 + 3] > 128) {
              pts.push({ 
                x, y, ox: x, oy: y, 
                vx: (Math.random()-0.5)*2+1.0, vy: (Math.random()-0.5)*2-1.0, 
                life: 1.0, active: false, falling: false,
                cr: 255, cg: 245, cb: 157, tr: 255, tg: 245, tb: 157
              });
            }
          }
        }
        ctx.clearRect(0, 0, width, height); 
        return pts;
      };

      const generateTicketTargets = () => {
        const offCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        offCtx.canvas.width = width; offCtx.canvas.height = height;
        const tW = Math.min(450, width * 0.8), tH = tW * 0.5, cx = width/2, cy = height/2;
        
        offCtx.fillStyle = "#FFF"; offCtx.beginPath(); offCtx.roundRect(cx - tW/2, cy - tH/2, tW, tH, 15); offCtx.fill();
        offCtx.globalCompositeOperation = "destination-out";
        offCtx.beginPath(); offCtx.arc(cx - tW/2, cy, tH * 0.2, 0, Math.PI * 2); offCtx.fill();
        offCtx.beginPath(); offCtx.arc(cx + tW/2, cy, tH * 0.2, 0, Math.PI * 2); offCtx.fill();
        offCtx.globalCompositeOperation = "source-over";
        offCtx.strokeStyle = "#FFF"; offCtx.lineWidth = 2; offCtx.setLineDash([8, 8]);
        offCtx.beginPath(); offCtx.roundRect(cx - tW/2 + 15, cy - tH/2 + 15, tW - 30, tH - 30, 8); offCtx.stroke();
        offCtx.globalCompositeOperation = "destination-out";
        offCtx.font = `bold ${tW * 0.13}px "Playfair Display", sans-serif`;
        offCtx.textAlign = "center"; offCtx.textBaseline = "middle"; offCtx.fillText("ADMIT ONE", cx, cy);
        
        const tImg = offCtx.getImageData(0, 0, width, height).data;
        const targets = [];
        for (let y = 0; y < height; y += textStep) {
          for (let x = 0; x < width; x += textStep) {
            if (tImg[(y * width + x) * 4 + 3] > 128) targets.push({ x: x+(Math.random()-0.5)*2, y: y+(Math.random()-0.5)*2 });
          }
        }
        return targets.sort(() => Math.random() - 0.5);
      };

      const generateHeartTargets = (count) => {
        const targets = [];
        const scale = Math.min(width, height) * 0.015; 
        for(let i=0; i<count; i++) {
            const t = Math.random() * Math.PI * 2;
            const dx = 16 * Math.pow(Math.sin(t), 3) + (Math.random()-0.5)*0.5;
            const dy = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t) + (Math.random()-0.5)*0.5;
            targets.push({ x: width/2 + dx * scale, y: height/2 - dy * scale - 20 });
        }
        return targets;
      };

      const generateImageTargets = (imgObj, threshold = 15) => {
        const offCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        offCtx.canvas.width = width; offCtx.canvas.height = height;
        
        const maxW = width * 0.9; const maxH = height * 0.85;
        let imgW = imgObj.width || 300; let imgH = imgObj.height || 300;
        const scale = Math.min(maxW/imgW, maxH/imgH);
        imgW *= scale; imgH *= scale;
        
        if (imgObj.complete && imgObj.naturalHeight !== 0) {
            offCtx.drawImage(imgObj, width/2 - imgW/2, height/2 - imgH/2, imgW, imgH);
        }

        const imgData = offCtx.getImageData(0, 0, width, height).data;
        const targets = [];
        
        for (let y = 0; y < height; y += imgStep) {
          for (let x = 0; x < width; x += imgStep) {
            const idx = (y * width + x) * 4;
            const r = imgData[idx], g = imgData[idx+1], b = imgData[idx+2], a = imgData[idx+3];

            const brightness = (r + g + b) / 3;
            if (a > 50 && brightness > threshold) {
               targets.push({ 
                 x: x + (Math.random()-0.5)*0.5, y: y + (Math.random()-0.5)*0.5, 
                 r, g, b 
               });
            }
          }
        }
        return targets.sort(() => Math.random() - 0.5);
      };

      // INIT
      particles = extractTextPixels(text1);
      ctx.font = `300 ${Math.min(width * 0.045, 48)}px "Playfair Display", serif`;
      const t1Bounds = { startX: width/2 - ctx.measureText(text1).width/2 };

      // EVENT LISTENER
      canvas.addEventListener('click', () => {
        if (animState === 'SHOW_T1' && progress1 >= 0.8) {
          animState = 'ERASE_T1'; eraseX = t1Bounds.startX - 50; canvas.style.cursor = 'auto';
        } 
        else if (animState === 'IDLE_TICKET') {
          animState = 'BLAST_HEART'; canvas.style.cursor = 'auto';
          const hTargets = generateHeartTargets(particles.length);
          particles.forEach((p, i) => { 
            const angle = Math.atan2(p.y - height/2, p.x - width/2);
            const force = 15 + Math.random() * 20;
            p.vx = Math.cos(angle) * force; p.vy = Math.sin(angle) * force;
            p.tx = hTargets[i].x; p.ty = hTargets[i].y; 
            p.tr = 255; p.tg = 0; p.tb = 85; 
            // FASTER morph speed
            p.morphSpeed = 0.06 + Math.random() * 0.06;
          });
        }
        else if (animState === 'IDLE_IMAGE_1') {
          animState = 'ERASE_IMAGE_1'; eraseX2 = 0; canvas.style.cursor = 'auto';
        }
      });

      // --- MAIN ANIMATION LOOP ---
      const render = (time) => {
        const delta = time - lastTime; lastTime = time;
        ctx.clearRect(0, 0, width, height);

        if (showRef.current && animState === 'HIDDEN') animState = 'SHOW_T1';

        // 1. SHOW TEXT
        if (animState === 'SHOW_T1') {
          progress1 = Math.min(progress1 + delta * 0.0003, 1);
          ctx.globalAlpha = progress1; ctx.fillStyle = "white";
          ctx.shadowColor = "rgba(255, 255, 255, 0.5)"; ctx.shadowBlur = 15;
          ctx.font = `300 ${Math.min(width * 0.045, 48)}px "Playfair Display", serif`;
          ctx.fillText(text1, width/2, height/2);
          ctx.shadowBlur = 0;
          if(progress1 >= 0.8) canvas.style.cursor = 'pointer';
        } 
        
        // 2. ERASE TEXT
        else if (animState === 'ERASE_T1') {
          eraseX += delta * 0.7; // FASTER erase sweep
          ctx.save(); ctx.beginPath(); ctx.rect(eraseX, 0, width - eraseX, height); ctx.clip();
          ctx.fillStyle = "white"; ctx.shadowColor = "rgba(255,255,255,0.5)"; ctx.shadowBlur = 15;
          ctx.font = `300 ${Math.min(width * 0.045, 48)}px "Playfair Display", serif`;
          ctx.fillText(text1, width/2, height/2); ctx.restore();

          for (let p of particles) {
            if (!p.active && p.ox < eraseX + Math.random() * 20) p.active = true;
            if (p.active) {
              p.vy += 0.015; p.x += p.vx + Math.sin(time * 0.002 + p.oy) * 0.5; p.y += p.vy;
              p.vx *= 0.98; p.vy *= 0.98; p.life = Math.max(0.1, p.life - 0.003);
              ctx.globalAlpha = p.life;
              ctx.fillStyle = `rgb(${p.cr|0},${p.cg|0},${p.cb|0})`; 
              ctx.fillRect(p.x, p.y, pSizeText, pSizeText); 
            }
          }
          if (eraseX > width + 50) animState = 'MORPH_TICKET';
        }

        // 3. MORPH TO TICKET
        else if (animState === 'MORPH_TICKET') {
          if (!particles[0].tx) {
            const targets = generateTicketTargets();
            if (particles.length < targets.length) {
               const needed = targets.length - particles.length;
               for(let i=0; i<needed; i++) particles.push({...particles[Math.floor(Math.random()*particles.length)], active: true});
            }
            particles.forEach((p, i) => { 
                p.tx = targets[i%targets.length].x; p.ty = targets[i%targets.length].y; 
                p.tr = 255; p.tg = 105; p.tb = 180; 
                // FASTER morph speed
                p.morphSpeed = 0.05 + Math.random()*0.05; 
            });
          }

          let settled = 0;
          for (let p of particles) {
            p.vx += (p.tx - p.x) * p.morphSpeed * 0.1; p.vy += (p.ty - p.y) * p.morphSpeed * 0.1;
            // TIGHTER friction (0.8 instead of 0.85) = snappier stop, no wobble
            p.vx *= 0.8; p.vy *= 0.8; 
            p.x += p.vx; p.y += p.vy; p.life = Math.min(1, p.life + 0.02);
            
            // FASTER color shift (0.1 instead of 0.05)
            p.cr += (p.tr - p.cr) * 0.1; p.cg += (p.tg - p.cg) * 0.1; p.cb += (p.tb - p.cb) * 0.1;
            
            if (Math.abs(p.tx - p.x) < 3 && Math.abs(p.ty - p.y) < 3) settled++;
            
            ctx.globalAlpha = p.life; ctx.fillStyle = `rgb(${p.cr|0},${p.cg|0},${p.cb|0})`; 
            ctx.fillRect(p.x, p.y, pSizeText, pSizeText);
          }
          if (settled > particles.length * 0.9) { animState = 'IDLE_TICKET'; canvas.style.cursor = 'pointer'; }
        }

        // 4. IDLE TICKET
        else if (animState === 'IDLE_TICKET') {
          for (let p of particles) {
            const fx = Math.sin(time * 0.001 + p.ty) * 2, fy = Math.cos(time * 0.0012 + p.tx) * 2;
            ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 0.003 + p.ox); 
            ctx.fillStyle = `rgb(${p.cr|0},${p.cg|0},${p.cb|0})`; 
            ctx.fillRect(p.tx + fx, p.ty + fy, pSizeText, pSizeText);
          }
        }

        // 5. BLAST TICKET TO HEART
        else if (animState === 'BLAST_HEART') {
          let settled = 0;
          for (let p of particles) {
            p.vx += (p.tx - p.x) * p.morphSpeed * 0.05; p.vy += (p.ty - p.y) * p.morphSpeed * 0.05;
            p.vx *= 0.82; p.vy *= 0.82; // Smoother snap
            p.x += p.vx; p.y += p.vy;
            p.cr += (p.tr - p.cr) * 0.1; p.cg += (p.tg - p.cg) * 0.1; p.cb += (p.tb - p.cb) * 0.1;
            
            if (Math.abs(p.tx - p.x) < 3 && Math.abs(p.ty - p.y) < 3) settled++;
            ctx.globalAlpha = p.life; ctx.fillStyle = `rgb(${p.cr|0},${p.cg|0},${p.cb|0})`; 
            ctx.fillRect(p.x, p.y, pSizeText, pSizeText);
          }
          if (settled > particles.length * 0.8) { animState = 'BEAT_HEART'; stateTimer = 0; }
        }

        // 6. HEART BEATS
        else if (animState === 'BEAT_HEART') {
          stateTimer += delta;
          const beatScale = 1.0 + Math.sin(time * 0.008) * 0.06;
          for (let p of particles) {
            const hx = width/2 + (p.tx - width/2) * beatScale; const hy = height/2 + (p.ty - height/2) * beatScale;
            ctx.globalAlpha = p.life; ctx.fillStyle = `rgb(${p.cr|0},${p.cg|0},${p.cb|0})`; 
            ctx.fillRect(hx, hy, pSizeText, pSizeText);
          }
          if (stateTimer > 2000) { animState = 'MORPH_IMAGE_1'; } 
        }

        // 7. MASSIVE MORPH TO HIGH-CLARITY IMAGE 1 (img_001.png)
        else if (animState === 'MORPH_IMAGE_1') {
          if (!particles[0].isImage1) {
            const imgTargets = generateImageTargets(loadedImg1, 15);
            
            if (particles.length < imgTargets.length) {
               const needed = imgTargets.length - particles.length;
               for(let i=0; i<needed; i++) {
                   particles.push({
                       x: width/2 + (Math.random()-0.5)*50,
                       y: height/2 + (Math.random()-0.5)*50,
                       vx: (Math.random()-0.5)*15, vy: (Math.random()-0.5)*15,
                       cr: 255, cg: 0, cb: 85, 
                       active: true, life: 1.0, ox: 0, oy: 0, falling: false
                   });
               }
            }
            particles.forEach((p, i) => { 
                const t = imgTargets[i % imgTargets.length];
                p.tx = t.x; p.ty = t.y; 
                p.tr = t.r; p.tg = t.g; p.tb = t.b; 
                // FASTER image formation speed
                p.morphSpeed = 0.04 + Math.random() * 0.05;
                p.isImage1 = true;
            });
          }

          let settled = 0;
          for (let p of particles) {
            p.vx += (p.tx - p.x) * p.morphSpeed * 0.1; p.vy += (p.ty - p.y) * p.morphSpeed * 0.1;
            // Tighter drag = snappier layout
            p.vx *= 0.8; p.vy *= 0.8; 
            p.x += p.vx; p.y += p.vy;
            p.cr += (p.tr - p.cr) * 0.1; p.cg += (p.tg - p.cg) * 0.1; p.cb += (p.tb - p.cb) * 0.1;
            
            if (Math.abs(p.tx - p.x) < 3 && Math.abs(p.ty - p.y) < 3) settled++;
            ctx.globalAlpha = p.life; ctx.fillStyle = `rgb(${p.cr|0},${p.cg|0},${p.cb|0})`; 
            ctx.fillRect(p.x, p.y, pSizeImg, pSizeImg);
          }
          if (settled > particles.length * 0.9) { animState = 'IDLE_IMAGE_1'; canvas.style.cursor = 'pointer'; }
        }

        // 8. IDLE IMAGE 1 (LOCKED & CLEAR)
        else if (animState === 'IDLE_IMAGE_1') {
          for (let p of particles) {
            ctx.globalAlpha = 0.9 + 0.1 * Math.sin(time * 0.005 + p.ox); 
            ctx.fillStyle = `rgb(${p.cr|0},${p.cg|0},${p.cb|0})`; 
            ctx.fillRect(p.tx, p.ty, pSizeImg, pSizeImg);
          }
        }

        // 9. ERASE HIGH-CLARITY IMAGE 1 INTO FALLING DUST
        else if (animState === 'ERASE_IMAGE_1') {
          eraseX2 += delta * 0.85; // FASTER sweep transition

          for (let p of particles) {
            if (!p.falling && p.tx < eraseX2 + Math.random() * 30) {
               p.falling = true;
               p.vx = (Math.random() - 0.5) * 3 + 1.0; p.vy = (Math.random() - 0.5) * 2 - 1.0;
            }

            if (p.falling && p.life > 0) {
               p.vy += 0.02; p.x += p.vx + Math.sin(time*0.002 + p.ty)*0.5; p.y += p.vy;
               p.vx *= 0.98; p.vy *= 0.98; p.life -= 0.005; 
            } else if (!p.falling) {
               p.x = p.tx; p.y = p.ty; 
            }

            if (p.life > 0) {
               ctx.globalAlpha = Math.max(0, p.life); 
               ctx.fillStyle = `rgb(${p.cr|0},${p.cg|0},${p.cb|0})`; 
               ctx.fillRect(p.x, p.y, pSizeImg, pSizeImg);
            }
          }
          if (eraseX2 > width + 200) { animState = 'MORPH_IMAGE_2'; }
        }

        // 10. REVERSE GRAVITY -> MORPH TO BUTTERFLY (img_002.png)
        else if (animState === 'MORPH_IMAGE_2') {
          if (!particles[0].isImage2) {
            const butterflyTargets = generateImageTargets(loadedImg2, 45); 
            
            if (particles.length < butterflyTargets.length) {
               const needed = butterflyTargets.length - particles.length;
               for(let i=0; i<needed; i++) {
                   const src = particles[Math.floor(Math.random()*particles.length)];
                   particles.push({...src, falling: true}); 
               }
            }
            particles.forEach((p, i) => { 
                const t = butterflyTargets[i % butterflyTargets.length];
                p.tx = t.x; p.ty = t.y; p.tr = t.r; p.tg = t.g; p.tb = t.b; 
                // FASTER butterfly morph speed
                p.morphSpeed = 0.04 + Math.random() * 0.04;
                p.isImage2 = true; p.falling = false; 
            });
          }

          let settled = 0;
          for (let p of particles) {
            const swirl = Math.sin(p.y * 0.05 + time * 0.002) * 2;
            p.vx += (p.tx - p.x) * p.morphSpeed * 0.1 + (swirl * 0.01); 
            p.vy += (p.ty - p.y) * p.morphSpeed * 0.1;
            p.vx *= 0.8; p.vy *= 0.8; // Snappy stopping 
            p.x += p.vx; p.y += p.vy;
            
            p.life = Math.min(1.0, p.life + 0.02); 
            p.cr += (p.tr - p.cr) * 0.1; p.cg += (p.tg - p.cg) * 0.1; p.cb += (p.tb - p.cb) * 0.1;
            
            if (Math.abs(p.tx - p.x) < 3 && Math.abs(p.ty - p.y) < 3) settled++;
            ctx.globalAlpha = p.life; ctx.fillStyle = `rgb(${p.cr|0},${p.cg|0},${p.cb|0})`; 
            ctx.fillRect(p.x, p.y, pSizeImg, pSizeImg);
          }
          if (settled > particles.length * 0.9) { animState = 'IDLE_IMAGE_2'; }
        }

        // 11. IDLE BUTTERFLY (LOCKED & CLEAR)
        else if (animState === 'IDLE_IMAGE_2') {
          for (let p of particles) {
            ctx.globalAlpha = 0.9 + 0.1 * Math.sin(time * 0.005 + p.ox); 
            ctx.fillStyle = `rgb(${p.cr|0},${p.cg|0},${p.cb|0})`; 
            ctx.fillRect(p.tx, p.ty, pSizeImg, pSizeImg);
          }
        }

        ctx.globalAlpha = 1.0;
        animationFrameId = requestAnimationFrame(render);
      };

      animationFrameId = requestAnimationFrame(render);
    });

    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: show ? "auto" : "none", zIndex: 10 }}
    />
  );
}

// --- 4. MAIN APP COMPONENT ---
export default function App() {
  const [phase, setPhase] = useState("idle"); 
  const [showStory, setShowStory] = useState(false);

  useEffect(() => {
    if (phase === "exploding") {
      const timer = setTimeout(() => setShowStory(true), 3000); 
      return () => clearTimeout(timer);
    }
  }, [phase]);

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyles styles={{
          "@import": "url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,300;0,400;1,400&display=swap')",
          body: { margin: 0, padding: 0, overflow: "hidden", backgroundColor: "#020208" },
      }}/>
      <Box sx={{ width: "100vw", height: "100vh", position: "relative" }}>
        
        {/* 3D Scene Layer */}
        <R3FCanvas camera={{ position: [0, 0, 7], fov: 50 }}>
          <Stars radius={50} depth={50} count={3000} factor={2} fade speed={1.5} />
          <OrbitControls enableZoom={true} enablePan={false} autoRotate={phase === "idle"} autoRotateSpeed={0.5} />
          <SeedGlobe phase={phase} setPhase={setPhase} />
        </R3FCanvas>

        {/* 2D Overlay Layer */}
        <StoryOverlay show={showStory} />

      </Box>
    </ThemeProvider>
  );
}