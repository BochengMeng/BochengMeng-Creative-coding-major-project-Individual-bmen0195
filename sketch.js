let sourceImage;
let artCanvas; 
let ready = false;

const baseWidth = 1920; // base canvas width
const baseHeight = 1080; // base canvas height

// sampling parameters to simplify the map image
const SAMPLE_STEP = 25;
const UNIT_SIZE = 30;

// --------------------------- animation ------------------------------------------
let isAnimating = false;
let animationProgress = 0;
let totalBlocks = 0;
let v1Blocks = []; // colored blocks (V1)
let v2Blocks = []; // black blocks (V2)

// ----------------------------- path animation (controlled by audio) ------------------------
let Train = 0; // current position along the path (float index)
let basePathSpeed = 0.1; // base speed, will be updated in startAnimation()
let boostPathSpeed = 0.4; // extra speed based on audio loudness
let speedScale = 0.28; // global speed control

let animationPath = []; // ordered list of blocks for the animation
let cellToIndex = []; // map from grid cell to v1Blocks index
let roadGrid = []; // grid showing where roads are (true/false)
let gridRows = 0;
let gridCols = 0;

// ------------------- audio controls ------------------------------------------
let soundTrack; 
let amplitude; // p5.Amplitude to measure loudness
let lastLevel = 0;  // smoothed loudness value


function preload() {
  sourceImage = loadImage('Street.png');
  // load image https://p5js.org/reference/p5/preload/
  soundTrack = loadSound('mix2.mp3'); 
}

function setup() {
  createCanvas(baseWidth, baseHeight); // create main canvas
  pixelDensity(1);
  //Content outside the element box is not shown https://www.w3schools.com/jsref/prop_style_overflow.asp
  document.body.style.overflow = 'hidden';
  // create graphics buffer for art generation
  artCanvas = createGraphics(600, 600);
  artCanvas.pixelDensity(1); // https://p5js.org/reference/p5/loadPixels/ // Get the pixel density.

  // init audio amplitude
  amplitude = new p5.Amplitude();
  amplitude.setInput(soundTrack);

  generateArt();
  ready = true;
  scaleToWindow(); // scale to window size
}

function draw() {
  //resizing and fitting
  background(255);
  let zoom = 1.25;
  let zoomAnchorY = height * 0.75;
  push();
  translate(width / 2, zoomAnchorY / 2);
  scale(zoom);
  translate(-width / 2, -zoomAnchorY / 2);
  // draw the static background
  drawBackground();
  if (ready) {
    // update animation state
    if (isAnimating) {
      updateAnimation();
    }
    // redraw artCanvas based on current animationProgress
    renderArt();
    image(artCanvas, 656, 152, 600, 600);
  }
  pop();
}

// click to start / restart the animation
function mousePressed() {
  startAnimation();
}

// reset and start the reveal
function startAnimation() {
  // if there is no path, do nothing
  if (animationPath.length === 0) return;

  // reset animation state
  isAnimating = true;
  animationProgress = 0;
  totalBlocks = animationPath.length;
  Train = 0; // start at the beginning of the path

  // control the audio
  if (soundTrack) {
    // if the sound is already playing, stop it first
    if (soundTrack.isPlaying()) {
      soundTrack.stop();
    }
    // play from the start
    soundTrack.play();
  }

  // set a base speed so the animation roughly matches the audio length
  if (soundTrack && soundTrack.isLoaded() && totalBlocks > 0) {
    const duration = soundTrack.duration(); // total audio length in seconds

    // try to get the current frame rate
    let fps = frameRate();
    if (!isFinite(fps) || fps <= 0) {
      fps = 60; // fallback if frameRate is not ready
    }

    const framesTotal = duration * fps;

    // target speed: if we only use this speed,
    // the path will finish around the end of the audio
    const targetBaseSpeed = totalBlocks / framesTotal;

    // use 70% of that speed to leave room for audio-based boost
    basePathSpeed = targetBaseSpeed * 0.7;

    // keep the base speed in a safe range
    basePathSpeed = constrain(basePathSpeed, 0.02, 1.5);
  }
}

function updateAnimation() {
  // if there is no path, do nothing
  if (animationPath.length === 0) return;

  // get current loudness level from the audio
  let level = 0;
  if (amplitude) {
    level = amplitude.getLevel();
  }

  lastLevel = level;

  // if the audio loudness is below this threshold, the animation should completely stop (no movement).
  const silenceThreshold = 0.02; 
  if (lastLevel < silenceThreshold) {
    return;
  }

  // map the loudness to an extra speed (boost)
  let mappedBoost = map(
    lastLevel, 0, 0.3, 0, boostPathSpeed, true
  );
  let currentSpeed = (basePathSpeed + mappedBoost) * speedScale;

  // move forward along the path using the current speed
  Train += currentSpeed;
  animationProgress = floor(Train);

  // check if we reached the end of the path
  if (animationProgress >= totalBlocks - 1) {
    animationProgress = totalBlocks - 1;
    Train = totalBlocks - 1;
    isAnimating = false;
  }
}


// draw two layers（V2 base, V1 on top, partially revealed）
function renderArt() {
  artCanvas.push();
  artCanvas.clear();
  artCanvas.background('#EBEAE6');
  artCanvas.noStroke();
  // First draw the large square layer
  drawSVGBlocks();
  // V2 black base layer (always fully visible)
  for (let i = 0; i < v2Blocks.length; i++) {
  const block = v2Blocks[i];
  feltifyRect(artCanvas, block.x, block.y, block.w, block.h, block.color, 1.2);
}
  // V1 colored layer (only draw blocks that have been revealed)
  const limit = Math.min(animationProgress, animationPath.length);
  for (let i = 0; i < limit; i++) {
    const block = animationPath[i];
    feltifyRectV1(artCanvas, block.x, block.y, block.w, block.h, block.color, 1.2); // feltifyRectV1
  }
  artCanvas.pop();
}

// V2 - simplified to just black
const BLACK_COLOR = '#000000ff';

// V1 colored lines
let colorsV1 = {
  gray: '#d6d7d2',
  yellow: '#e1c927',
  red: '#ad372b',
  blue: '#314294',
  bg: '#EBEAE6'
};

// new generateArt，prepare all V2 and V1 blocks (store as data, not directly draw)
function generateArt() {
  // clear previous blocks
  v1Blocks = [];
  v2Blocks = [];
  animationPath = [];
  cellToIndex = [];
  roadGrid = [];
  // https://p5js.org/reference/p5/loadPixels/
  sourceImage.loadPixels();
  // scale & blocksize
  const scaleX = artCanvas.width / sourceImage.width;
  const scaleY = artCanvas.height / sourceImage.height;
  const blockSize = UNIT_SIZE * Math.min(scaleX, scaleY);
  // create grid for storing colors
  const rows = Math.ceil(sourceImage.height / SAMPLE_STEP);
  const cols = Math.ceil(sourceImage.width / SAMPLE_STEP);
  gridRows = rows;
  gridCols = cols;

  // ---------------------V2-------------------------------------------------------
  // track which cells are roads
  roadGrid = Array(rows).fill().map(function () {
  return Array(cols).fill(false);
});
  // V2 sampling - simplified since all blocks are black
  for (let y = 0, row = 0; y < sourceImage.height; y += SAMPLE_STEP, row++) {
    for (let x = 0, col = 0; x < sourceImage.width; x += SAMPLE_STEP, col++) {
      // Get pixel color
      const idx = (y * sourceImage.width + x) * 4;
      const r = sourceImage.pixels[idx];
      const g = sourceImage.pixels[idx + 1];
      const b = sourceImage.pixels[idx + 2];
      // Check if it's a road pixel (white color)
      if (r > 240 && g > 240 && b > 240) {
        roadGrid[row][col] = true; // mark as road for path building
        v2Blocks.push({
          x: x * scaleX,
          y: y * scaleY,
          w: blockSize,
          h: blockSize,
          color: BLACK_COLOR // Always black for V2
        });
      }
    }
  }

  // ---------------------V1-------------------------------------------------------
  // V1 grid
  const gridV1 = Array(rows).fill().map(function () {
  return Array(cols).fill(null);
});
  cellToIndex = Array(rows).fill().map(function () {
  return Array(cols).fill(null);
});

  // V1 sampling
  for (let y = 0, row = 0; y < sourceImage.height; y += SAMPLE_STEP, row++) {
    for (let x = 0, col = 0; x < sourceImage.width; x += SAMPLE_STEP, col++) {
      // Get pixel color
      const idx = (y * sourceImage.width + x) * 4;
      const r = sourceImage.pixels[idx];
      const g = sourceImage.pixels[idx + 1];
      const b = sourceImage.pixels[idx + 2];
      // Check if it's a road pixel (white color)
      if (r > 240 && g > 240 && b > 240) {
        gridV1[row][col] = chooseColorV1(gridV1, row, col); // V1 chooseColorV1
        const block = {
          x: x * scaleX,
          y: y * scaleY,
          w: blockSize,
          h: blockSize,
          color: gridV1[row][col],
          row: row,
          col: col
        };
        v1Blocks.push(block);
        cellToIndex[row][col] = v1Blocks.length - 1; // save index for path building
      }
    }
  }
  // build a continuous path through the road network
  buildAnimationPath();
  totalBlocks = animationPath.length;
}

// Idea: use DFS + backtracking to try to visit as many road cells as possible since the audio is long
function buildAnimationPath() {
  animationPath = [];
  if (!roadGrid || gridRows === 0 || gridCols === 0) return;
  const directions = [
    { dr: 0, dc: 1 }, // right
    { dr: 1, dc: 0 }, // down
    { dr: 0, dc: -1 }, // left
    { dr: -1, dc: 0 }  // up
  ];

  // Count how many road neighbors a cell has (ignoring visited)
  function roadDegree(row, col) {
    let count = 0;
    for (let d of directions) {
      const nr = row + d.dr;
      const nc = col + d.dc;
      if (
        nr >= 0 && nr < gridRows &&
        nc >= 0 && nc < gridCols &&
        roadGrid[nr][nc]
      ) {
        count++;
      }
    }
    return count;
  }

  // try a cell with only 1 road neighbor first (an "end" of a corridor),
  // fall back to any road cell if none
  let start = null;
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      if (roadGrid[r][c] && roadDegree(r, c) === 1) {
        start = { row: r, col: c };
        break;
      }
      if (!start && roadGrid[r][c]) {
        start = { row: r, col: c };
      }
    }
    if (start) break;
  }
  if (!start) return;

// 2D array for visited flags
let visited = [];
for (let r = 0; r < gridRows; r++) {
  visited[r] = [];
  for (let c = 0; c < gridCols; c++) {
    visited[r][c] = false; // not visited at the start
  }
}
// store the best (longest) path we have found so far
let bestPathCoords = [];
// store the current path during DFS
let currentPath = [];
  // depth-first search with backtracking
  function dfs(row, col) {
    visited[row][col] = true;
    currentPath.push({ row, col });
    // save the best (longest) path seen so far
    if (currentPath.length > bestPathCoords.length) {
      bestPathCoords = currentPath.slice();
    }
    // collect unvisited neighbor road cells
    let neighbors = [];
    for (let d of directions) {
      const nr = row + d.dr;
      const nc = col + d.dc;
      if (
        nr >= 0 && nr < gridRows &&
        nc >= 0 && nc < gridCols &&
        roadGrid[nr][nc] &&
        !visited[nr][nc]
      ) {
        neighbors.push({ row: nr, col: nc });
      }
    }

    // heuristic: visit tighter corridors first
    // (cells with fewer unvisited neighbors)
neighbors.sort(function (a, b) {
  const da = roadDegree(a.row, a.col);
  const db = roadDegree(b.row, b.col);
  return da - db;
});

for (let n of neighbors) {
  dfs(n.row, n.col);
}
    // backtrack so other branches can reuse this cell in other attempts
    currentPath.pop();
    visited[row][col] = false;
  }
  // run the DFS from the chosen start cell
  dfs(start.row, start.col);
  // turn grid coordinates into actual v1Blocks for drawing
  animationPath = [];
  for (let k = 0; k < bestPathCoords.length; k++) {
    const { row, col } = bestPathCoords[k];
    const idx = cellToIndex[row][col];
    if (idx !== null && idx !== undefined) {
      animationPath.push(v1Blocks[idx]);
    }
  }
  totalBlocks = animationPath.length;
}

// Mondrian-style big blocks with audio-reactive scaling
function drawSVGBlocks() {
  const g = artCanvas;
  g.noStroke();

  // layout is in a 1600 x 1600 design space
  const s = 1600 / 600; 


  // Map the current audio level (lastLevel) to 0–1
  const ampNorm = constrain(map(lastLevel, 0, 0.3, 0, 1, true), 0, 1);
  const center = (ampNorm - 0.5) * 2.0;

  const MAX_SCALE_RATIO = 0.2; // how much blocks can grow or shrink

  function R(x, y, w, h, c, dir = 1) {
    const delta = center * MAX_SCALE_RATIO * dir;
    const scaleFactor = 1 + delta;

    // Scale around the center: update size and shift position by half the change
    const wScaled = w * scaleFactor;
    const hScaled = h * scaleFactor;
    const dx = (wScaled - w) / 2;
    const dy = (hScaled - h) / 2;

    feltifyRect(
      g,
      Math.round((x - dx) / s),
      Math.round((y - dy) / s),
      Math.round(wScaled / s),
      Math.round(hScaled / s),
      c,
      6 // these blocks are much bigger than the grid cells, so keep ampScale at 6
    );
  }

  // 1: louder audio = bigger block
  // -1: louder audio = smaller block (inverse reaction)
  // 0：no move
  R(910, 305, 275, 420, '#4267ba', 0); R(910, 390, 275, 230, '#ad372b', 0); R(960, 450, 160, 100, '#e1c927', 1); R(80, 1160, 160, 140, '#e1c927', -1);
  R(230, 960, 150, 130, "#4267ba", 0); R(1450, 1450, 165, 165, '#e1c927', 1); R(730, 280, 95, 95, '#e1c927', -1); R(385, 1300, 195, 310, '#ad372b', 0);
  R(450, 1360, 60, 60, '#d6d7d2', -1); R(1005, 1060, 175, 390, "#4267ba", 0); R(1025, 1295, 125, 100, '#e1c927', -1); R(150, 455, 225, 120, "#4267ba", 0);
  R(280, 160, 205, 85, '#ad372b', 0); R(1380, 70, 180, 120, "#4267ba", 0); R(1400, 625, 210, 210, '#ad372b', 0); R(1270, 865, 130, 190, '#e1c927', 1);
  R(610, 945, 215, 215, '#e1c927',  -1); R(385, 740, 220, 90, '#ad372b', 0); R(830, 730, 155, 155, '#ad372b', 0); R(1470, 700, 80, 60, '#d6d7d2', 1);
  R(280, 1000, 50, 50, '#d6d7d2', -1); R(670, 1020, 80, 80, '#d6d7d2', 1); R(340, 160, 40, 85, '#d6d7d2', -1); R(1295, 915, 75, 75, '#d6d7d2', 1);
}


// (V1) choose color with probability and neighbor checking （like in mondian's work）
function chooseColorV1(grid, row, col) {
  const avoid = [];
  // Check top neighbor（&& is like and in python）
  if (row > 0 && grid[row - 1][col] && grid[row - 1][col] !== colorsV1.yellow) {
    avoid.push(grid[row - 1][col]);
  }
  // Check left neighbor
  if (col > 0 && grid[row][col - 1] && grid[row][col - 1] !== colorsV1.yellow) {
    avoid.push(grid[row][col - 1]);
  }
  // color weights
  const weights = [
    { color: colorsV1.gray, weight: 15 },
    { color: colorsV1.yellow, weight: 45 },
    { color: colorsV1.red, weight: 20 },
    { color: colorsV1.blue, weight: 20 }
  ];
  // filter out avoided colors
  const available = weights.filter(function (w) {
    return !avoid.includes(w.color);
  });
  // default to yellow if no colors available（since the original work has lots of yellow）
  if (available.length === 0) return colorsV1.yellow;
  // calculate total weight
  const total = available.reduce(function (sum, w) {
    return sum + w.weight;
  }, 0);
  // weighted random selection
  let rand = random(total);
  for (let i = 0; i < available.length; i++) {
    if (rand < available[i].weight) {
      return available[i].color;
    }
    rand -= available[i].weight;
  }
  return available[0].color;
}

// Background space drawing function - simplified without shadows
function drawBackground() {
  noStroke();
  // wall
  fill('#F5F4F0'); rect(0, 2, 1920, 910);
  // floor line
  fill('#6C4D38'); rect(0, 868, 1920, 8);
  // floor strips
  fill('#A88974'); rect(0, 875, 1920, 8);
  fill('#DBBDA5'); rect(0, 883, 1920, 12);
  fill('#CEB1A1'); rect(0, 895, 1920, 20);
  fill('#DDC3AC'); rect(0, 915, 1920, 30);
  // static frame layers
  fill('#A88974'); rect(630, 132, 670, 677);
  fill('#E1E0DC'); rect(620, 120, 666, 664);
  fill('#BFA89A'); rect(658, 153, 606, 622);
  fill('#A88974'); rect(658, 153, 604, 612);
}

// ------------------(V2) Hand-drawn style in visuals---------------------------
function feltifyRect(g, x, y, w, h, c, ampScale = 1) {
  g.noStroke();
  g.fill(c);
  g.rect(x, y, w, h);
  g.noFill();
  g.stroke(red(c), green(c), blue(c), 180);
  g.strokeWeight(2);
  g.rect(x, y, w, h);
}

// -------------------(V1) Hand-drawn style in visuals-----------------
function feltifyRectV1(g, x, y, w, h, c, ampScale = 1) {
  // Draw the main color block
  g.noStroke();
  g.fill(c);
  g.rect(x, y, w, h);
  // slight shaking
  const amp = 0.20 * ampScale;
  const freq = 0.1;
  const layers = 2; // change to 2 to refine the rendering speed
  for (let l = 0; l < layers; l++) {
    g.noFill();
    g.stroke(red(c), green(c), blue(c), map(l, 0, layers - 1, 100, 50));
    g.strokeWeight(map(l, 0, layers - 1, 2.2, 1));
    g.beginShape();
    // up
    for (let i = 0; i <= 1; i += 0.02) {
      const n = noise((x + i * w) * freq, (y + l * 50) * freq);
      const offset = map(n, 0, 1, -amp, amp);
      g.vertex(x + i * w, constrain(y + offset, y - amp, y + amp));
    }
    // right
    for (let i = 0; i <= 1; i += 0.02) {
      const n = noise((x + w + l * 20) * freq, (y + i * h) * freq);
      const offset = map(n, 0, 1, -amp, amp);
      g.vertex(constrain(x + w + offset, x + w - amp, x + w + amp), y + i * h);
    }
    // down
    for (let i = 1; i >= 0; i -= 0.02) {
      const n = noise((x + i * w) * freq, (y + h + l * 40) * freq);
      const offset = map(n, 0, 1, -amp, amp);
      g.vertex(x + i * w, constrain(y + h + offset, y + h - amp, y + h + amp));
    }
    // left
    for (let i = 1; i >= 0; i -= 0.02) {
      const n = noise((x + l * 30) * freq, (y + i * h) * freq);
      const offset = map(n, 0, 1, -amp, amp);
      g.vertex(constrain(x + offset, x - amp, x + amp), y + i * h);
    }
    g.endShape(CLOSE);
  }
  // soft glow outline
  g.stroke(red(c), green(c), blue(c), 40);
  g.strokeWeight(3);
  g.noFill();
  g.rect(x, y, w, h);
}

function scaleToWindow() {
  let scaleX = windowWidth / baseWidth;
  let scaleY = windowHeight / baseHeight;
  let scale = Math.max(scaleX, scaleY);
  let canvasElement = document.querySelector('canvas');
  canvasElement.style.position = "absolute";
  canvasElement.style.left = "50%";
  canvasElement.style.top = "50%";
  canvasElement.style.transformOrigin = "center center";
  canvasElement.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function windowResized() {
  scaleToWindow();
}