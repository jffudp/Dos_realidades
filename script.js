// ============================================================================
// Dos realidades — Ejercicio 02 (DPPI 2026)
//
// Una misma cámara alimenta a dos sistemas de visión artificial independientes:
//
//   SISTEMA A (visión corporal): MediaPipe Pose Landmarker.
//     Pregunta: ¿dónde está y cómo está configurado el cuerpo?
//     Representación: una "constelación" orgánica dibujada sobre los
//     landmarks y conexiones del cuerpo detectado.
//
//   SISTEMA B (visión de la imagen): diferencia de luminancia entre frames.
//     Pregunta: ¿dónde está ocurriendo movimiento en la escena?
//     Representación: un campo de partículas que nace en las zonas donde
//     cambia el brillo de un frame a otro.
//
// Ninguno de los dos sistemas dibuja el video RGB original: ambos traducen
// la señal de la cámara en un tipo de dato distinto (landmarks vs. variación
// de píxeles) y ese dato es lo único que se representa visualmente.
// ============================================================================

// Nota: el import de MediaPipe se hace de forma dinámica (más abajo, dentro de
// initPose) en lugar de un `import` estático arriba. Así, si el CDN falla o la
// conexión es lenta, el resto del script (cámara, botón, Sistema B) se carga
// igual y el error queda contenido a esa función en vez de romper todo el módulo.

// ---------------------------------------------------------------------------
// Configuración general
// ---------------------------------------------------------------------------

const VISION_BUNDLE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const MOTION_COLS = 48;
const MOTION_ROWS = 36;
const MOTION_THRESHOLD = 9; // diferencia mínima de luminancia (0-255) para considerar "movimiento"
const MAX_PARTICLES = 900;

// Conexiones curadas del esqueleto (se omiten dedos y malla facial fina
// para que la representación se lea como estructura, no como ruido).
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [28, 30], [30, 32],
  [27, 31], [28, 32],
  [0, 11], [0, 12],
];

// Región del cuerpo -> color, para leer la configuración corporal por zonas.
const REGION_COLORS = {
  head: "#ffd166",
  armL: "#ff8a5c",
  armR: "#ff5c8a",
  torso: "#ffe38a",
  legL: "#5ce1ff",
  legR: "#a78bfa",
};

const LANDMARK_REGION = {
  0: "head",
  11: "torso", 12: "torso", 23: "torso", 24: "torso",
  13: "armL", 15: "armL",
  14: "armR", 16: "armR",
  25: "legL", 27: "legL", 29: "legL", 31: "legL",
  26: "legR", 28: "legR", 30: "legR", 32: "legR",
};

// ---------------------------------------------------------------------------
// Referencias DOM
// ---------------------------------------------------------------------------

const video        = document.getElementById("video");
const canvasA      = document.getElementById("canvasA");
const ctxA         = canvasA.getContext("2d");
const canvasB      = document.getElementById("canvasB");
const ctxB         = canvasB.getContext("2d");
const hiddenSample = document.getElementById("hiddenSample");
const ctxHidden    = hiddenSample.getContext("2d", { willReadFrequently: true });

// Botón A: enciende la cámara y arranca el Sistema A
const startBtnA        = document.getElementById("startBtnA");
const cameraBtnWrapperA = document.getElementById("cameraBtnWrapperA");
const statusMsgA       = document.getElementById("statusMsgA");
const idleHintA        = document.getElementById("idleHintA");
const statA            = document.getElementById("statA");

// Botón B: activa el Sistema B (cámara ya encendida por A)
const startBtnB        = document.getElementById("startBtnB");
const cameraBtnWrapperB = document.getElementById("cameraBtnWrapperB");
const statusMsgB       = document.getElementById("statusMsgB");
const statB            = document.getElementById("statB");

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

let poseLandmarker = null;
let cameraReady    = false;  // ¿ya tenemos acceso a la cámara?
let runningA       = false;  // ¿está corriendo el Sistema A?
let runningB       = false;  // ¿está corriendo el Sistema B?
let prevLuma       = null;
let particles      = [];
let lastVideoTime  = -1;
let smoothMotion   = 0;

// ---------------------------------------------------------------------------
// Arranque — dos botones independientes
// ---------------------------------------------------------------------------

startBtnA.addEventListener("click", toggleA);
startBtnB.addEventListener("click", toggleB);

// ─── SISTEMA A: primer clic enciende cámara + IA, siguiente clic apaga/enciende ───
async function toggleA() {
  // Si ya está corriendo → APAGAR
  if (runningA) {
    runningA = false;
    cameraBtnWrapperA.classList.remove("is-live");
    document.getElementById("dotA").style.background = "";
    startBtnA.querySelector(".btn-txt").textContent = "Activar A";
    setStatusA("Sistema A pausado.");
    // Oscurecer el canvas de A
    ctxA.fillStyle = "#07060c";
    ctxA.fillRect(0, 0, canvasA.width, canvasA.height);
    return;
  }

  // Si NO está corriendo → ENCENDER
  startBtnA.disabled = true;

  // Primera vez: hay que encender la cámara
  if (!cameraReady) {
    setStatusA("Solicitando acceso a la cámara…");
    try {
      await initCamera();
      cameraReady = true;
    } catch (err) {
      console.error(err);
      setStatusA("Error de cámara: " + (err?.message || "revisa los permisos."));
      startBtnA.disabled = false;
      return;
    }
    // Habilitar el botón B ahora que la cámara está lista
    startBtnB.disabled = false;
    setStatusB("Cámara lista. Activa B cuando quieras.");
  }

  runningA = true;
  cameraBtnWrapperA.classList.add("is-live");
  startBtnA.querySelector(".btn-txt").textContent = "Apagar A";
  startBtnA.disabled = false;

  // Si el loop no está corriendo (B también está apagado), lo arrancamos
  if (!runningB) requestAnimationFrame(renderLoop);

  // Primera vez: cargar el modelo de IA
  if (!poseLandmarker) {
    setStatusA("Cargando modelo de mano…");
    try {
      await initPose();
      setStatusA("Sistema A activo.");
    } catch (err) {
      console.error(err);
      setStatusA("Error al cargar el modelo de IA.");
      idleHintA.textContent = "modelo no disponible";
    }
  } else {
    setStatusA("Sistema A activo.");
  }
}

// ─── SISTEMA B: toggle simple (cámara ya encendida por A) ───
function toggleB() {
  if (runningB) {
    // APAGAR B
    runningB = false;
    cameraBtnWrapperB.classList.remove("is-live");
    startBtnB.querySelector(".btn-txt").textContent = "Activar B";
    setStatusB("Sistema B pausado.");
    // Oscurecer el canvas de B
    ctxB.fillStyle = "#050505";
    ctxB.fillRect(0, 0, canvasB.width, canvasB.height);
  } else {
    // ENCENDER B
    runningB = true;
    cameraBtnWrapperB.classList.add("is-live");
    startBtnB.querySelector(".btn-txt").textContent = "Apagar B";
    setStatusB("Sistema B activo.");
    // Si el loop no está corriendo (A también está apagado), lo arrancamos
    if (!runningA) requestAnimationFrame(renderLoop);
  }
}

function setStatusA(text) { statusMsgA.textContent = text; }
function setStatusB(text) { statusMsgB.textContent = text; }


async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });

  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  canvasA.width = w;
  canvasA.height = h;
  canvasB.width = w;
  canvasB.height = h;
}

async function initPose() {
 const { HandLandmarker, FilesetResolver } = await import(VISION_BUNDLE_URL);
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  try {
    poseLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,           // detectar hasta 2 manos simultáneamente
    });
  } catch (err) {
    console.warn("Fallo con delegate GPU, reintentando con CPU…", err);
    poseLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 2,           // detectar hasta 2 manos simultáneamente
    });
  }
}

// ---------------------------------------------------------------------------
// Loop principal
// ---------------------------------------------------------------------------

function renderLoop(timestampMs) {
  if (!runningA && !runningB) return;

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    if (runningA) {
      const result = poseLandmarker ? poseLandmarker.detectForVideo(video, timestampMs) : null;
      drawSystemA(result);
    }

    if (runningB) {
      drawSystemB();
    }
  }

  requestAnimationFrame(renderLoop);
}

// ---------------------------------------------------------------------------
// SISTEMA A — Configuración corporal (MediaPipe Pose)
// ---------------------------------------------------------------------------

function drawSystemA(result) {
  const w = canvasA.width;
  const h = canvasA.height;
  const t = performance.now() / 1000;

  // Fondo oscuro
  ctxA.fillStyle = "#07060c";
  ctxA.fillRect(0, 0, w, h);

  // result.landmarks es un array: un elemento por cada mano detectada (0, 1 o 2)
  const allHands = result && result.landmarks ? result.landmarks : [];

  if (allHands.length === 0) {
    idleHintA.style.opacity = "1";
    statA.textContent = "buscando mano...";
    drawIdlePulse(ctxA, w, h, t);
    return;
  }

  idleHintA.style.opacity = "0";
  statA.textContent = `${allHands.length} mano${allHands.length > 1 ? "s" : ""} detectada${allHands.length > 1 ? "s" : ""}`;

  ctxA.globalCompositeOperation = "lighter";

  // Dibujar la telaraña neón para CADA mano detectada
  allHands.forEach((landmarks, handIndex) => {

    // Cada mano tiene un color de neón distinto para distinguirlas visualmente
    // Mano 0 → cambia de color con el tiempo (arcoíris)
    // Mano 1 → mismo efecto pero con un desfase de 180° en el tono
    const hueOffset = handIndex * 180;
    const neonColor = `hsl(${((t * 40) + hueOffset) % 360}, 100%, 60%)`;

    ctxA.strokeStyle = neonColor;
    ctxA.fillStyle   = neonColor;
    ctxA.shadowColor = neonColor;
    ctxA.shadowBlur  = 15;
    ctxA.lineWidth   = 2;
    ctxA.lineCap     = "round";
    ctxA.lineJoin    = "round";

    // Función local para conectar dos puntos de esta mano
    const connect = (i, j) => {
      const a = landmarks[i];
      const b = landmarks[j];
      if (!a || !b) return;
      ctxA.beginPath();
      ctxA.moveTo(a.x * w, a.y * h);
      ctxA.lineTo(b.x * w, b.y * h);
      ctxA.stroke();
    };

    // 1. Esqueleto principal de la mano (5 dedos desde la muñeca)
    const fingers = [
      [0, 1, 2, 3, 4],       // Pulgar
      [0, 5, 6, 7, 8],       // Índice
      [0, 9, 10, 11, 12],    // Medio
      [0, 13, 14, 15, 16],   // Anular
      [0, 17, 18, 19, 20],   // Meñique
    ];
    fingers.forEach(finger => {
      for (let k = 0; k < finger.length - 1; k++) {
        connect(finger[k], finger[k + 1]);
      }
    });

    // 2. Conexiones cruzadas: la "telaraña"
    connect(3, 7);  connect(7, 11);  connect(11, 15); connect(15, 19);
    connect(4, 8);  connect(8, 12);  connect(12, 16); connect(16, 20);

    // 3. Nodos brillantes en cada articulación
    landmarks.forEach((p, idx) => {
      if (!p) return;
      const cx = p.x * w;
      const cy = p.y * h;
      const isTip = [4, 8, 12, 16, 20].includes(idx);
      const size  = isTip ? 6 : 3;

      ctxA.beginPath();
      ctxA.arc(cx, cy, size, 0, Math.PI * 2);
      ctxA.fill();

      // Cuadrado giratorio en las puntas
      if (isTip) {
        ctxA.save();
        ctxA.translate(cx, cy);
        ctxA.rotate(t * 3 + idx);
        ctxA.strokeStyle = "#ffffff";
        ctxA.lineWidth   = 1.5;
        ctxA.shadowBlur  = 20;
        ctxA.strokeRect(-8, -8, 16, 16);
        ctxA.restore();
      }
    });
  });

  // Si hay 2 manos, dibujar una línea que las une por las muñecas (punto 0)
  // para que parezcan que interactúan entre sí
  if (allHands.length === 2) {
    const wrist0 = allHands[0][0];
    const wrist1 = allHands[1][0];
    if (wrist0 && wrist1) {
      ctxA.strokeStyle = "#ffffff44";
      ctxA.lineWidth   = 1;
      ctxA.shadowBlur  = 5;
      ctxA.setLineDash([6, 8]); // línea punteada entre muñecas
      ctxA.beginPath();
      ctxA.moveTo(wrist0.x * w, wrist0.y * h);
      ctxA.lineTo(wrist1.x * w, wrist1.y * h);
      ctxA.stroke();
      ctxA.setLineDash([]); // restaurar línea sólida
    }
  }

  ctxA.globalCompositeOperation = "source-over";
  ctxA.shadowBlur = 0;
}

function drawIdlePulse(ctx, w, h, t) {
  const cx = w / 2, cy = h / 2;
  for (let i = 0; i < 3; i++) {
    const phase = t * 0.9 + i * 0.7;
    const r = 20 + ((phase * 40) % 140);
    const alpha = clamp(1 - r / 160, 0, 0.5);
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255, 209, 102, ${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function averagePoint(landmarks, indices) {
  const pts = indices.map((i) => landmarks[i]).filter(Boolean);
  if (!pts.length) return null;
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ---------------------------------------------------------------------------
// SISTEMA B — Campo de movimiento (diferencia de frames)
// ---------------------------------------------------------------------------

function drawSystemB() {
  const w = canvasB.width;
  const h = canvasB.height;

  // Muestreamos el video en baja resolución solo para obtener datos de brillo.
  ctxHidden.drawImage(video, 0, 0, MOTION_COLS, MOTION_ROWS);
  const frame = ctxHidden.getImageData(0, 0, MOTION_COLS, MOTION_ROWS).data;

  const cellCount = MOTION_COLS * MOTION_ROWS;
  if (!prevLuma) prevLuma = new Float32Array(cellCount);

  const cellW = w / MOTION_COLS;
  const cellH = h / MOTION_ROWS;
  let totalDiff = 0;
  let activeCells = 0;

  for (let i = 0; i < cellCount; i++) {
    const px = i * 4;
    const luma = 0.299 * frame[px] + 0.587 * frame[px + 1] + 0.114 * frame[px + 2];
    const diff = Math.abs(luma - prevLuma[i]);
    prevLuma[i] = luma;

    if (diff > MOTION_THRESHOLD) {
      totalDiff += diff;
      activeCells++;

      const col = i % MOTION_COLS;
      const row = Math.floor(i / MOTION_COLS);
      const spawnCount = Math.min(3, Math.round(diff / 22));

      for (let s = 0; s < spawnCount; s++) {
        spawnParticle(
          (col + 0.5) * cellW + (Math.random() - 0.5) * cellW,
          (row + 0.5) * cellH + (Math.random() - 0.5) * cellH,
          diff,
        );
      }
    }
  }

  smoothMotion = smoothMotion * 0.85 + (activeCells / cellCount) * 0.15;
  statB.textContent = `${Math.round(smoothMotion * 100)}% de la escena en movimiento`;

  // Fondo con desvanecimiento: deja estela, refuerza la idea de campo temporal.
  ctxB.fillStyle = "rgba(5, 4, 10, 0.16)";
  ctxB.fillRect(0, 0, w, h);

  if (particles.length > MAX_PARTICLES) {
    particles.splice(0, particles.length - MAX_PARTICLES);
  }

  particles = particles.filter((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.97;
    p.vy *= 0.97;
    p.life--;

    if (p.life <= 0 || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) {
      return false;
    }

    // Nueva animación: Lluvia / Líneas verticales cayendo
    const alpha = p.life / p.maxLife;
    ctxB.strokeStyle = `hsla(210, 80%, 70%, ${alpha * 0.8})`; // Tono azul/celeste de lluvia
    ctxB.lineWidth = p.size;
    ctxB.lineCap = "round";
    
    // Dibujar una estela (línea vertical) en lugar de un cuadrado
    ctxB.beginPath();
    ctxB.moveTo(p.x, p.y - p.vy * 2); // De donde viene
    ctxB.lineTo(p.x, p.y); // A donde va
    ctxB.stroke();
    return true;
  });

  ctxB.shadowBlur = 0;
}

function spawnParticle(x, y, magnitude) {
  // Nueva animación: Lluvia cayendo
  // Las partículas caen hacia abajo rápidamente, con muy poca variación a los lados
  const speedX = (Math.random() - 0.5) * 0.5; // Muy poco movimiento horizontal
  const speedY = 3 + Math.random() * 4 + Math.min(3.0, magnitude / 10); // Caen rápido hacia abajo
  
  // Lluvia no necesita variación extrema de color, pero guardamos el 'hue' por si acaso
  const hue = 210; // Azul

  const life = 40 + Math.random() * 30; // Tiempo que tardan en caer

  particles.push({
    x, y,
    vx: speedX,
    vy: speedY, // Gravedad positiva (hacia abajo)
    hue,
    size: 1 + Math.min(2, magnitude / 20), // Líneas delgadas
    life,
    maxLife: life,
  });
}
