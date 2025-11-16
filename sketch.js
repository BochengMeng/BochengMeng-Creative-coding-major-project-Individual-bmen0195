let mapImage;
let mondrianCanvas; 
let isReady = false;

const baseWidth = 1920; // base canvas width
const baseHeight = 1080; // base canvas height

// sampling parameters to simplify the map image
const GRID_SPACING = 25;
const BLOCK_SIZE = 30;

// --------------------------- animation ------------------------------------------
let isAnimating = false;
let revealedBlockCount = 0;
let totalPathBlocks = 0;
let coloredBlocks = []; // colored blocks (V1)
let blackBlocks = []; // black blocks (V2)

// ----------------------------- path animation (controlled by audio) ------------------------
let pathPosition = 0; // current position along the path (float index)
let baseSpeed = 0.1; // base speed, will be updated in startAnimation()
let audioBoostSpeed = 0.4; // extra speed based on audio loudness
let globalSpeedMultiplier = 0.22; // global speed control

let revealPath = []; // ordered list of blocks for the animation
let gridCellToBlockIndex = []; // map from grid cell to coloredBlocks index
let isRoadCell = []; // grid showing where roads are (true/false)
let gridRows = 0;
let gridCols = 0;

// ------------------- audio controls ------------------------------------------
let backgroundMusic; 
let audioAnalyzer; // p5.Amplitude to measure loudness
let currentLoudness = 0;  // smoothed loudness value


function preload() {
  mapImage = loadImage('Street.png');
  // load image https://p5js.org/reference/p5/preload/
  backgroundMusic = loadSound('mix2.mp3'); 
}

function setup() {
  createCanvas(baseWidth, baseHeight); // create main canvas
  pixelDensity(1);
  //Content outside the element box is not shown https://www.w3schools.com/jsref/prop_style_overflow.asp
  document.body.style.overflow = 'hidden';
  // create graphics buffer for art generation
  mondrianCanvas = createGraphics(600, 600);
  mondrianCanvas.pixelDensity(1); // https://p5js.org/reference/p5/loadPixels/ // Get the pixel density.

  // init audio amplitude
  audioAnalyzer = new p5.Amplitude();
  audioAnalyzer.setInput(backgroundMusic);

  generateArt();
  isReady = true;
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
  if (isReady) {
    // update animation state
    if (isAnimating) {
      updateAnimation();
    }
    // redraw mondrianCanvas based on current revealedBlockCount
    renderArt();
    image(mondrianCanvas, 656, 152, 600, 600);
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
  if (revealPath.length === 0) return;

  // reset animation state
  isAnimating = true;
  revealedBlockCount = 0;
  totalPathBlocks = revealPath.length;
  pathPosition = 0; // start at the beginning of the path

  // control the audio
  if (backgroundMusic) {
    // if the sound is already playing, stop it first
    if (backgroundMusic.isPlaying()) {
      backgroundMusic.stop();
    }
    // play from the start
    backgroundMusic.play();
  }
  
  // baseSpeed is already set to 0.1, and globalSpeedMultiplier to 0.28
  // These values are manually tuned to match the audio
}

function updateAnimation() {
  // if there is no path, do nothing
  if (revealPath.length === 0) return;

  // get current loudness level from the audio
  let level = 0;
  if (audioAnalyzer) {
    level = audioAnalyzer.getLevel();
  }

  currentLoudness = level;

  // if the audio loudness is below this threshold, the animation should completely stop (no movement).
  const silenceThreshold = 0.02; 
  if (currentLoudness < silenceThreshold) {
    return;
  }

  // map the loudness to an extra speed (boost)
  let mappedBoost = map(
    currentLoudness, 0, 0.3, 0, audioBoostSpeed, true
  );
  let currentSpeed = (baseSpeed + mappedBoost) * globalSpeedMultiplier;

  // move forward along the path using the current speed
  pathPosition += currentSpeed;
  revealedBlockCount = floor(pathPosition);

  // check if we reached the end of the path
  if (revealedBlockCount >= totalPathBlocks - 1) {
    revealedBlockCount = totalPathBlocks - 1;
    pathPosition = totalPathBlocks - 1;
    isAnimating = false;
  }
}


// draw two layers（V2 base, V1 on top, partially revealed）
function renderArt() {
  mondrianCanvas.push();
  mondrianCanvas.clear();
  mondrianCanvas.background('#EBEAE6');
  mondrianCanvas.noStroke();
  // First draw the large square layer
  drawSVGBlocks();
  // V2 black base layer (always fully visible)
  for (let i = 0; i < blackBlocks.length; i++) {
  const block = blackBlocks[i];
  feltifyRect(mondrianCanvas, block.x, block.y, block.w, block.h, block.color, 1.2);
}
  // V1 colored layer (only draw blocks that have been revealed)
  const limit = Math.min(revealedBlockCount, revealPath.length);
  for (let i = 0; i < limit; i++) {
    const block = revealPath[i];
    feltifyRectV1(mondrianCanvas, block.x, block.y, block.w, block.h, block.color, 1.2); // feltifyRectV1
  }
  mondrianCanvas.pop();
}

// V2 - simplified to just black
const BLACK_COLOR = '#000000ff';

// V1 colored lines
let mondrianColors = {
  gray: '#d6d7d2',
  yellow: '#e1c927',
  red: '#ad372b',
  blue: '#314294',
  bg: '#EBEAE6'
};

// new generateArt，prepare all V2 and V1 blocks (store as data, not directly draw)
function generateArt() {
  // clear previous blocks
  coloredBlocks = [];
  blackBlocks = [];
  revealPath = [];
  gridCellToBlockIndex = [];
  isRoadCell = [];
  // https://p5js.org/reference/p5/loadPixels/
  mapImage.loadPixels();
  // scale & blocksize
  const scaleX = mondrianCanvas.width / mapImage.width;
  const scaleY = mondrianCanvas.height / mapImage.height;
  const blockSize = BLOCK_SIZE * Math.min(scaleX, scaleY);
  // create grid for storing colors
  const rows = Math.ceil(mapImage.height / GRID_SPACING);
  const cols = Math.ceil(mapImage.width / GRID_SPACING);
  gridRows = rows;
  gridCols = cols;

  // ---------------------V2-------------------------------------------------------
  // track which cells are roads
  isRoadCell = Array(rows).fill().map(function () {
  return Array(cols).fill(false);
});
  // V2 sampling - simplified since all blocks are black
  for (let y = 0, row = 0; y < mapImage.height; y += GRID_SPACING, row++) {
    for (let x = 0, col = 0; x < mapImage.width; x += GRID_SPACING, col++) {
      // Get pixel color
      const pixelIndex = (y * mapImage.width + x) * 4;
      const r = mapImage.pixels[pixelIndex];
      const g = mapImage.pixels[pixelIndex + 1];
      const b = mapImage.pixels[pixelIndex + 2];
      // Check if it's a road pixel (white color)
      if (r > 240 && g > 240 && b > 240) {
        isRoadCell[row][col] = true; // mark as road for path building
        blackBlocks.push({
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
  gridCellToBlockIndex = Array(rows).fill().map(function () {
  return Array(cols).fill(null);
});

  // V1 sampling
  for (let y = 0, row = 0; y < mapImage.height; y += GRID_SPACING, row++) {
    for (let x = 0, col = 0; x < mapImage.width; x += GRID_SPACING, col++) {
      // Get pixel color
      const pixelIndex = (y * mapImage.width + x) * 4;
      const r = mapImage.pixels[pixelIndex];
      const g = mapImage.pixels[pixelIndex + 1];
      const b = mapImage.pixels[pixelIndex + 2];
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
        coloredBlocks.push(block);
        gridCellToBlockIndex[row][col] = coloredBlocks.length - 1; // save index for path building
      }
    }
  }
  // build a continuous path through the road network
  buildAnimationPath();
  totalPathBlocks = revealPath.length;
}

// Idea: use DFS + backtracking to try to visit as many road cells as possible since the audio is long
function buildAnimationPath() {
  revealPath = [];
  if (!isRoadCell || gridRows === 0 || gridCols === 0) return;
  const directions = [
    { rowChange: 0, colChange: 1 }, // right
    { rowChange: 1, colChange: 0 }, // down
    { rowChange: 0, colChange: -1 }, // left
    { rowChange: -1, colChange: 0 }  // up
  ];

  // Count how many road neighbors a cell has (ignoring visited)
  function roadDegree(row, col) {
    let count = 0;
    for (let d of directions) {
      const nextRow = row + d.rowChange;
      const nextCol = col + d.colChange;
      if (
        nextRow >= 0 && nextRow < gridRows &&
        nextCol >= 0 && nextCol < gridCols &&
        isRoadCell[nextRow][nextCol]
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
      if (isRoadCell[r][c] && roadDegree(r, c) === 1) {
        start = { row: r, col: c };
        break;
      }
      if (!start && isRoadCell[r][c]) {
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
      const nextRow = row + d.rowChange;
      const nextCol = col + d.colChange;
      if (
        nextRow >= 0 && nextRow < gridRows &&
        nextCol >= 0 && nextCol < gridCols &&
        isRoadCell[nextRow][nextCol] &&
        !visited[nextRow][nextCol]
      ) {
        neighbors.push({ row: nextRow, col: nextCol });
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
  // turn grid coordinates into actual coloredBlocks for drawing
  revealPath = [];
  for (let k = 0; k < bestPathCoords.length; k++) {
    const { row, col } = bestPathCoords[k];
    const idx = gridCellToBlockIndex[row][col];
    if (idx !== null && idx !== undefined) {
      revealPath.push(coloredBlocks[idx]);
    }
  }
  totalPathBlocks = revealPath.length;
}

// Mondrian-style big blocks with audio-reactive scaling
function drawSVGBlocks() {
  const g = mondrianCanvas;
  g.noStroke();

  // layout is in a 1600 x 1600 design space
  const s = 1600 / 600; 


  // Map the current audio level (currentLoudness) to 0–1
  const ampNorm = constrain(map(currentLoudness, 0, 0.3, 0, 1, true), 0, 1);
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
  if (row > 0 && grid[row - 1][col] && grid[row - 1][col] !== mondrianColors.yellow) {
    avoid.push(grid[row - 1][col]);
  }
  // Check left neighbor
  if (col > 0 && grid[row][col - 1] && grid[row][col - 1] !== mondrianColors.yellow) {
    avoid.push(grid[row][col - 1]);
  }
  // color weights
  const weights = [
    { color: mondrianColors.gray, weight: 15 },
    { color: mondrianColors.yellow, weight: 45 },
    { color: mondrianColors.red, weight: 20 },
    { color: mondrianColors.blue, weight: 20 }
  ];
  // filter out avoided colors
  const available = weights.filter(function (w) {
    return !avoid.includes(w.color);
  });
  // default to yellow if no colors available（since the original work has lots of yellow）
  if (available.length === 0) return mondrianColors.yellow;
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
  const wobbleAmount = 0.20 * ampScale;
  const noiseFrequency = 0.1;
  const layers = 2; // change to 2 to refine the rendering speed
  for (let l = 0; l < layers; l++) {
    g.noFill();
    g.stroke(red(c), green(c), blue(c), map(l, 0, layers - 1, 100, 50));
    g.strokeWeight(map(l, 0, layers - 1, 2.2, 1));
    g.beginShape();
    // up
    for (let i = 0; i <= 1; i += 0.02) {
      const n = noise((x + i * w) * noiseFrequency, (y + l * 50) * noiseFrequency);
      const offset = map(n, 0, 1, -wobbleAmount, wobbleAmount);
      g.vertex(x + i * w, constrain(y + offset, y - wobbleAmount, y + wobbleAmount));
    }
    // right
    for (let i = 0; i <= 1; i += 0.02) {
      const n = noise((x + w + l * 20) * noiseFrequency, (y + i * h) * noiseFrequency);
      const offset = map(n, 0, 1, -wobbleAmount, wobbleAmount);
      g.vertex(constrain(x + w + offset, x + w - wobbleAmount, x + w + wobbleAmount), y + i * h);
    }
    // down
    for (let i = 1; i >= 0; i -= 0.02) {
      const n = noise((x + i * w) * noiseFrequency, (y + h + l * 40) * noiseFrequency);
      const offset = map(n, 0, 1, -wobbleAmount, wobbleAmount);
      g.vertex(x + i * w, constrain(y + h + offset, y + h - wobbleAmount, y + h + wobbleAmount));
    }
    // left
    for (let i = 1; i >= 0; i -= 0.02) {
      const n = noise((x + l * 30) * noiseFrequency, (y + i * h) * noiseFrequency);
      const offset = map(n, 0, 1, -wobbleAmount, wobbleAmount);
      g.vertex(constrain(x + offset, x - wobbleAmount, x + wobbleAmount), y + i * h);
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