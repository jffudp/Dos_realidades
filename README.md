# Dos realidades

Ejercicio 02 del curso (DPPI 2026), sobre visión artificial y representación. La idea era tomar una sola cámara y usarla para armar dos maneras completamente distintas de "ver" lo mismo.

**Autor:** jeffer.M.D  
**Ejercicio:** Ejercicio 02 — Dos realidades · DPPI 2026  

## De qué se trata

Hay dos sistemas corriendo al mismo tiempo con la misma cámara, diagramados en una estética terminal/ciberpunk con efecto de "pantalla rota" en los bordes, simbolizando cómo los modelos digitales intentan escapar de la pantalla hacia la realidad física. Ninguno de los dos muestra el video directo: cada uno extrae un dato específico y lo representa visualmente de forma independiente.

**Sistema A — Telaraña Neón (Visión Manual).** Utiliza MediaPipe `HandLandmarker` para rastrear hasta 2 manos simultáneamente en tiempo real (21 puntos clave por mano). Los puntos se conectan a través de una estructura geométrica tipo "telaraña láser" con conexiones cruzadas entre nudillos y puntas de los dedos. En los extremos de los dedos orbitan cuadrados giratorios luminosos. Cada mano adopta un color neón en ciclo cromático con desfase visual entre ambas, y al detectar dos manos a la vez se dibuja un enlace punteado entre las muñecas, representando la interacción entre ambas realidades.

**Sistema B — Lluvia Digital (Diferencia de Movimiento).** No reconoce anatomías ni patrones predefinidos: analiza la diferencia de luminancia entre fotogramas consecutivos (*frame difference*). En las zonas donde se detecta cambio de luz y movimiento, se desprenden partículas en caída vertical continua en tonos celestes y azules neón simulando una lluvia digital con física de gravedad.

Cada módulo cuenta con su propio botón toggle independiente para encender y pausar la visualización según se desee.

## Cómo probarlo

El `index.html` no se puede abrir directo con doble clic debido a las restricciones de seguridad de los módulos ES y la cámara web. Para ejecutarlo localmente:

```bash
python -m http.server 8000
```

Luego, abre tu navegador en `http://localhost:8000`, concede los permisos de cámara y activa el **Sistema A** o el **Sistema B**.

## Reflexión

Reflexión

Lo virtual suele entenderse como una ilusión separada del mundo físico, pero como planteaba Pierre Lévy, lo virtual no se opone a lo real, sino a lo actual: es una dimensión latente donde nuevas formas de presencia y corporalidad cobran existencia. Al situar nuestras manos frente al sensor, la máquina no las reproduce de forma pasiva; las reinterpreta y desmaterializa en una trama viva de vectores y luz.

Por su parte, Jean Baudrillard advertía en sus estudios sobre la simulación que cuando la interfaz intermedia nuestra experiencia, las fronteras entre lo tangible y lo simulado colapsan en una nueva hiperrealidad. El marco fracturado de las pantallas en este proyecto encarna precisamente esa fricción: el deseo del cuerpo sintético por desbordar el vidrio y proyectarse hacia el espacio físico.

Entre la telaraña algorítmica de la mano y la lluvia de datos en movimiento, el dispositivo deja de ser un simple espejo para convertirse en un umbral. Nos revela que la realidad virtual no es un escape de la materia, sino una extensión de nuestra capacidad para habitar simultáneamente múltiples formas de existencia.

## Tecnologías

MediaPipe HandLandmarker (cargado vía CDN), JavaScript Vanilla (ES Modules) y Canvas 2D sin frameworks ni librerías pesadas.

---
jeffer.M.D · Ejercicio 02 — Dos realidades · DPPI 2026 · Escuela de Diseño UDP
