let mapImage;
let mondrianCanvas; 
let isReady = false;

// Fixed design space (virtual canvas) for layout
const DESIGN_W = 1920; // design width
const DESIGN_H = 1080; // design height

// sampling parameters to simplify the map image
const GRID_SPACING = 25;
const BLOCK_SIZE = 30;

// ---------------- Block class --------------------
// use a class to store all blocks (small V1 colored + V2 black)
class Block {
  constructor(x, y, w, h, color, ampScale = 1, layer = 'V2', row = null, col = null) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.color = color;
    this.ampScale = ampScale;
    this.layer = layer; // 'V1' or 'V2'
    this.row = row; // grid row (for path)
    this.col = col; // grid col (for path)
  }

  // draw V2 (simple block)
  drawV2(g) {
    feltingRect(g, this.x, this.y, this.w, this.h, this.color, this.ampScale);
  }

  // draw V1 (hand-drawn wobbly style)
  drawV1(g) {
    feltingRectV1(g, this.x, this.y, this.w, this.h, this.color, this.ampScale);
  }
}

// ---------------- RoadGrid class --------------------
// this class keeps the road grid and build a long path for animation.
// DFS + backtracking to try to visit as many road cells as possible
class RoadGrid {
  constructor(isRoadCell, gridCellToBlockIndex, gridRows, gridCols, coloredBlocks) {
    this.isRoadCell = isRoadCell;
    this.gridCellToBlockIndex = gridCellToBlockIndex;
    this.gridRows = gridRows;
    this.gridCols = gridCols;
    this.coloredBlocks = coloredBlocks;

    // directions for DFS: right, down, left, up
    this.directions = [
      { rowChange: 0, colChange: 1 },  // right
      { rowChange: 1, colChange: 0 },  // down
      { rowChange: 0, colChange: -1 }, // left
      { rowChange: -1, colChange: 0 }  // up
    ];
  }

  // check inside grid
  isInside(row, col) {
    return (
      row >= 0 && row < this.gridRows &&
      col >= 0 && col < this.gridCols
    );
  }

  // check if this cell is a road
  isRoad(row, col) {
    return this.isInside(row, col) && this.isRoadCell[row][col];
  }

  // how many road neighbors a cell has
  functionRoadDegree(row, col) {
    let count = 0;
    for (let d of this.directions) {
      const nextRow = row + d.rowChange;
      const nextCol = col + d.colChange;
      if (this.isRoad(nextRow, nextCol)) {
        count++;
      }
    }
    return count;
  }

  // convert grid coord to Block object
  coordToBlock(row, col) {
    const idx = this.gridCellToBlockIndex[row][col];
    if (idx !== null && idx !== undefined) {
      return this.coloredBlocks[idx];
    }
    return null;
  }

  // build a continuous path through the road network
  // This returns an ordered list of Block objects for the animation.
  buildAnimationPath() {
    let revealPathBlocks = [];

    if (!this.isRoadCell || this.gridRows === 0 || this.gridCols === 0) {
      return revealPathBlocks;
    }

    // choose start cell
    let start = null;
    for (let r = 0; r < this.gridRows; r++) {
      for (let c = 0; c < this.gridCols; c++) {
        if (this.isRoadCell[r][c] && this.functionRoadDegree(r, c) === 1) {
          start = { row: r, col: c };
          break;
        }
        if (!start && this.isRoadCell[r][c]) {
          start = { row: r, col: c };
        }
      }
      if (start) break;
    }
    if (!start) return revealPathBlocks;

    // visited flags
    let visited = [];
    for (let r = 0; r < this.gridRows; r++) {
      visited[r] = [];
      for (let c = 0; c < this.gridCols; c++) {
        visited[r][c] = false;
      }
    }

    let bestPathCoords = [];
    let currentPath = [];

    const self = this;

    // DFS + backtracking to try to visit as many road cells as possible
    function dfs(row, col) {
      visited[row][col] = true;
      currentPath.push({ row, col });

      if (currentPath.length > bestPathCoords.length) {
        bestPathCoords = currentPath.slice();
      }

      let neighbors = [];
      for (let d of self.directions) {
        const nextRow = row + d.rowChange;
        const nextCol = col + d.colChange;
        if (
          self.isInside(nextRow, nextCol) &&
          self.isRoadCell[nextRow][nextCol] &&
          !visited[nextRow][nextCol]
        ) {
          neighbors.push({ row: nextRow, col: nextCol });
        }
      }

      // heuristic: go to tighter corridors first
      neighbors.sort(function (a, b) {
        const da = self.functionRoadDegree(a.row, a.col);
        const db = self.functionRoadDegree(b.row, b.col);
        return da - db;
      });

      for (let n of neighbors) {
        dfs(n.row, n.col);
      }

      currentPath.pop();
      visited[row][col] = false;
    }

    dfs(start.row, start.col);

    // convert coords to Block objects
    revealPathBlocks = [];
    for (let k = 0; k < bestPathCoords.length; k++) {
      const { row, col } = bestPathCoords[k];
      const block = self.coordToBlock(row, col);
      if (block) {
        revealPathBlocks.push(block);
      }
    }

    return revealPathBlocks;
  }
}

// --------------------------- animation ------------------------------------------
let isAnimating = false;
let revealedBlockCount = 0;
let totalPathBlocks = 0;
let coloredBlocks = []; // colored blocks (V1) - Block objects
let blackBlocks = []; // black blocks (V2) - Block objects

// ----------------------------- path animation (controlled by audio) ------------------------
let pathPosition = 0; // current position along the path (float index)
let baseSpeed = 0.1; // base speed, will be updated in startAnimation()
let audioBoostSpeed = 0.4; // extra speed based on audio loudness
let globalSpeedMultiplier = 0.22; // global speed control

let revealPath = []; // ordered list of Blocks for the animation
let gridCellToBlockIndex = []; // map from grid cell to coloredBlocks index
let isRoadCell = []; // grid showing where roads are (true/false)
let gridRows = 0;
let gridCols = 0;

// ------------------- audio controls ------------------------------------------
let backgroundMusic; 
let audioAnalyzer; // p5.Amplitude to measure loudness
let currentLoudness = 0; // smoothed loudness value

function preload() {
  mapImage = loadImage('Street.png');
  // load image https://p5js.org/reference/p5/preload/
  backgroundMusic = loadSound('mix2.mp3'); 
}

function setup() {
  // canvas size follows the window; we will draw a fixed 1920x1080 "wall" inside it
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  //Content outside the element box is not shown https://www.w3schools.com/jsref/prop_style_overflow.asp
  document.body.style.overflow = 'hidden';

  // create graphics buffer for art generation
  mondrianCanvas = createGraphics(600, 600);
  mondrianCanvas.pixelDensity(1); // https://p5js.org/reference/p5/pixelDensity/

  // init audio amplitude
  audioAnalyzer = new p5.Amplitude();
  audioAnalyzer.setInput(backgroundMusic);

  generateArt();
  isReady = true;
}

function draw() {
  // Responsive scaling:.
  const s = Math.max(width / DESIGN_W, height / DESIGN_H);
  const offsetX = (width - DESIGN_W * s) / 2;
  const offsetY = (height - DESIGN_H * s) / 2;

  background(255);

  push();
  translate(offsetX, offsetY);
  scale(s);

  // zoom inside the design space (since the original one is too small)
  let zoom = 1.25;
  let zoomAnchorY = DESIGN_H * 0.75;
  push();
  translate(DESIGN_W / 2, zoomAnchorY / 2);
  scale(zoom);
  translate(-DESIGN_W / 2, -zoomAnchorY / 2);

  // draw the static background (wall + frame)
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

  pop(); // end zoom
  pop(); // end responsive scaling
}

// click to start / restart the animation
function mousePressed() {
  startAnimation();
}

// when the window size changes, resize the canvas to match the new window
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// reset and start the reveal
function startAnimation() {
  if (revealPath.length === 0) return;

  isAnimating = true;
  revealedBlockCount = 0;
  totalPathBlocks = revealPath.length;
  pathPosition = 0; // start at the beginning of the path

  if (backgroundMusic) {
    if (backgroundMusic.isPlaying()) {
      backgroundMusic.stop();
    }
    backgroundMusic.play();
  }
  // baseSpeed + globalSpeedMultiplier already tuned
}

function updateAnimation() {
  if (revealPath.length === 0) return;
  // read current audio level from p5.Amplitude (https://p5js.org/reference/p5.sound/p5.Amplitude/)
  let level = 0;
  if (audioAnalyzer) {
    level = audioAnalyzer.getLevel();
  }
  currentLoudness = level; // store it in a global so other functions (like drawSVGBlocks) can also use it

  const silenceThreshold = 0.02; 
  if (currentLoudness < silenceThreshold) {
    return; // stop moving when audio is quiet
  }
  // map the loudness to an extra speed
  let mappedBoost = map(
    currentLoudness, 0, 0.3, 0, audioBoostSpeed, true
  );
  let currentSpeed = (baseSpeed + mappedBoost) * globalSpeedMultiplier; // combine base speed and audio boost, then apply a global multiplier

  pathPosition += currentSpeed; // move the "train" position along the path (float index)
  revealedBlockCount = floor(pathPosition);
  // clamp values and stop the animation
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

  // big Mondrian blocks (audio reactive)
  drawSVGBlocks();

  // V2 black base layer (always fully visible)
  for (let i = 0; i < blackBlocks.length; i++) {
    const block = blackBlocks[i];
    block.drawV2(mondrianCanvas);
  }

  // V1 colored layer (only draw blocks that have been revealed)
  const limit = Math.min(revealedBlockCount, revealPath.length);
  for (let i = 0; i < limit; i++) {
    const block = revealPath[i];
    block.drawV1(mondrianCanvas);
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

// prepare all V2 and V1 blocks (store as Block data, not directly draw)
function generateArt() {
  // clear previous blocks
  coloredBlocks = [];
  blackBlocks = [];
  revealPath = [];
  gridCellToBlockIndex = [];
  isRoadCell = [];

  // https://p5js.org/reference/p5/loadPixels/
  mapImage.loadPixels();

  const scaleX = mondrianCanvas.width / mapImage.width;
  const scaleY = mondrianCanvas.height / mapImage.height;
  const blockSize = BLOCK_SIZE * Math.min(scaleX, scaleY);

  const rows = Math.ceil(mapImage.height / GRID_SPACING);
  const cols = Math.ceil(mapImage.width / GRID_SPACING);
  gridRows = rows;
  gridCols = cols;

  // ---------------------V2-------------------------------------------------------
  // track which cells are roads
  isRoadCell = Array(rows).fill().map(function () {
    return Array(cols).fill(false);
  });

  // V2 sampling - all blocks are black
  for (let y = 0, row = 0; y < mapImage.height; y += GRID_SPACING, row++) {
    for (let x = 0, col = 0; x < mapImage.width; x += GRID_SPACING, col++) {
      const pixelIndex = (y * mapImage.width + x) * 4;
      const r = mapImage.pixels[pixelIndex];
      const g = mapImage.pixels[pixelIndex + 1];
      const b = mapImage.pixels[pixelIndex + 2];

      if (r > 240 && g > 240 && b > 240) {
        isRoadCell[row][col] = true; // mark as road for path

        const bx = x * scaleX;
        const by = y * scaleY;

        blackBlocks.push(
          new Block(bx, by, blockSize, blockSize, BLACK_COLOR, 1.2, 'V2')
        );
      }
    }
  }

  // ---------------------V1-------------------------------------------------------
  const gridV1 = Array(rows).fill().map(function () {
    return Array(cols).fill(null);
  });

  gridCellToBlockIndex = Array(rows).fill().map(function () {
    return Array(cols).fill(null);
  });

  // V1 sampling
  for (let y = 0, row = 0; y < mapImage.height; y += GRID_SPACING, row++) {
    for (let x = 0, col = 0; x < mapImage.width; x += GRID_SPACING, col++) {
      const pixelIndex = (y * mapImage.width + x) * 4;
      const r = mapImage.pixels[pixelIndex];
      const g = mapImage.pixels[pixelIndex + 1];
      const b = mapImage.pixels[pixelIndex + 2];

      if (r > 240 && g > 240 && b > 240) {
        gridV1[row][col] = chooseColorV1(gridV1, row, col); // V1 choose color

        const bx = x * scaleX;
        const by = y * scaleY;

        const block = new Block(
          bx,
          by,
          blockSize,
          blockSize,
          gridV1[row][col],
          1.2,
          'V1',
          row,
          col
        );

        coloredBlocks.push(block);
        gridCellToBlockIndex[row][col] = coloredBlocks.length - 1;
      }
    }
  }

  // build a continuous path through the road network
  const roadGrid = new RoadGrid(
    isRoadCell,
    gridCellToBlockIndex,
    gridRows,
    gridCols,
    coloredBlocks
  );
  // DFS + backtracking to try to visit as many road cells as possible
  revealPath = roadGrid.buildAnimationPath();
  totalPathBlocks = revealPath.length;
}

// ----------------- big Mondrian blocks (audio reactive) ------------------
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

    const wScaled = w * scaleFactor;
    const hScaled = h * scaleFactor;
    const dx = (wScaled - w) / 2;
    const dy = (hScaled - h) / 2;

    feltingRect(
      g,
      Math.round((x - dx) / s),
      Math.round((y - dy) / s),
      Math.round(wScaled / s),
      Math.round(hScaled / s),
      c,
      6 // big blocks -> larger ampScale
    );
  }

  // 1: louder audio = bigger block
  // -1: louder audio = smaller block (inverse reaction)
  // 0：no move
  R(910, 305, 275, 420, '#4267ba', 0);
  R(910, 390, 275, 230, '#ad372b', 0);
  R(960, 450, 160, 100, '#e1c927', 1);
  R(80, 1160, 160, 140, '#e1c927', -1);
  R(230, 960, 150, 130, "#4267ba", 0);
  R(1450, 1450, 165, 165, '#e1c927', 1);
  R(730, 280, 95, 95, '#e1c927', -1);
  R(385, 1300, 195, 310, '#ad372b', 0);
  R(450, 1360, 60, 60, '#d6d7d2', -1);
  R(1005, 1060, 175, 390, "#4267ba", 0);
  R(1025, 1295, 125, 100, '#e1c927', -1);
  R(150, 455, 225, 120, "#4267ba", 0);
  R(280, 160, 205, 85, '#ad372b', 0);
  R(1380, 70, 180, 120, "#4267ba", 0);
  R(1400, 625, 210, 210, '#ad372b', 0);
  R(1270, 865, 130, 190, '#e1c927', 1);
  R(610, 945, 215, 215, '#e1c927',  -1);
  R(385, 740, 220, 90, '#ad372b', 0);
  R(830, 730, 155, 155, '#ad372b', 0);
  R(1470, 700, 80, 60, '#d6d7d2', 1);
  R(280, 1000, 50, 50, '#d6d7d2', -1);
  R(670, 1020, 80, 80, '#d6d7d2', 1);
  R(340, 160, 40, 85, '#d6d7d2', -1);
  R(1295, 915, 75, 75, '#d6d7d2', 1);
}

// (V1) choose color with probability and neighbor checking （like in mondian's work）
function chooseColorV1(grid, row, col) {
  const avoid = [];

  // Check top neighbor
  if (row > 0 && grid[row - 1][col] && grid[row - 1][col] !== mondrianColors.yellow) {
    avoid.push(grid[row - 1][col]);
  }

  // Check left neighbor
  if (col > 0 && grid[row][col - 1] && grid[row][col - 1] !== mondrianColors.yellow) {
    avoid.push(grid[row][col - 1]);
  }
  // each color has a weight
  const weights = [
    { color: mondrianColors.gray, weight: 15 },
    { color: mondrianColors.yellow, weight: 45 },
    { color: mondrianColors.red, weight: 20 },
    { color: mondrianColors.blue, weight: 20 }
  ];
  // remove colors that we want to avoid (for example: same as neighbor)
  const available = weights.filter(function (w) {
    return !avoid.includes(w.color);
  });
  // if no color left (all were avoided), fall back to yellow as default
  if (available.length === 0) return mondrianColors.yellow;

  const total = available.reduce(function (sum, w) {
    return sum + w.weight;
  }, 0);
  // pick a random number from 0 to total
  let rand = random(total);
  // walk through the available list and find which color matches this random number
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
  fill('#F5F4F0'); 
  rect(0, 2, DESIGN_W, 910);

  // floor line
  fill('#6C4D38'); 
  rect(0, 868, DESIGN_W, 8);

  // floor strips
  fill('#A88974'); rect(0, 875, DESIGN_W, 8);
  fill('#DBBDA5'); rect(0, 883, DESIGN_W, 12);
  fill('#CEB1A1'); rect(0, 895, DESIGN_W, 20);
  fill('#DDC3AC'); rect(0, 915, DESIGN_W, 30);

  // static frame layers
  fill('#A88974'); rect(630, 132, 670, 677);
  fill('#E1E0DC'); rect(620, 120, 666, 664);
  fill('#BFA89A'); rect(658, 153, 606, 622);
  fill('#A88974'); rect(658, 153, 604, 612);
}

// ------------------(V2) Hand-drawn style in visuals---------------------------
function feltingRect(g, x, y, w, h, c, ampScale = 1) {
  g.noStroke();
  g.fill(c);
  g.rect(x, y, w, h);
  g.noFill();
  g.stroke(red(c), green(c), blue(c), 180);
  g.strokeWeight(2);
  g.rect(x, y, w, h);
}

// -------------------(V1) Hand-drawn style in visuals-----------------
function feltingRectV1(g, x, y, w, h, c, ampScale = 1) {
  g.noStroke();
  g.fill(c);
  g.rect(x, y, w, h);

  const wobbleAmount = 0.20 * ampScale;
  const noiseFrequency = 0.1;
  const layers = 2; // 2 layers to keep rendering speed

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
      g.vertex(
        constrain(x + w + offset, x + w - wobbleAmount, x + w + wobbleAmount),
        y + i * h
      );
    }

    // down
    for (let i = 1; i >= 0; i -= 0.02) {
      const n = noise((x + i * w) * noiseFrequency, (y + h + l * 40) * noiseFrequency);
      const offset = map(n, 0, 1, -wobbleAmount, wobbleAmount);
      g.vertex(
        x + i * w,
        constrain(y + h + offset, y + h - wobbleAmount, y + h + wobbleAmount)
      );
    }

    // left
    for (let i = 1; i >= 0; i -= 0.02) {
      const n = noise((x + l * 30) * noiseFrequency, (y + i * h) * noiseFrequency);
      const offset = map(n, 0, 1, -wobbleAmount, wobbleAmount);
      g.vertex(
        constrain(x + offset, x - wobbleAmount, x + wobbleAmount),
        y + i * h
      );
    }
    g.endShape(CLOSE);
  }

  g.stroke(red(c), green(c), blue(c), 40);
  g.strokeWeight(3);
  g.noFill();
  g.rect(x, y, w, h);
}