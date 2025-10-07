/*
Refactored game.js — Tower Defense rewrite
Date: 2025-10-06
Migration map (preserved / adapted identifiers):
  - init()                 => preserved, initializes TD systems and calls original init if present
  - startGameGenesis()     => preserved, starts tower-defense waves and loop (adapts original)
  - stopGameGenesis()      => preserved, stops game loop and wave manager
  - updateUI()             => preserved, extended to show TD stats (calls original if present)
  - player, player.sprite  => reused as tower sprite if present; if not present a fallback is used
  - object pools for floating/damage text => reused if found as floatingTextPool/damageTextPool,
    otherwise local pools are created.
Notes:
  - All asset paths/names are left untouched; this script reuses player.sprite and other globals when available.
  - Upgrade caps are hard-coded in the MAXS object below.
  - Tune constants near the top of the file.
*/

// ---------------------------- Configuration & Caps ----------------------------
const TD_CONFIG = {
  canvasId: 'gameCanvas', // expected canvas id in HTML
  baseGoldPerEnemy: 5,
  waveStartDelay: 2000, // ms before first spawn of a wave
  spawnInterval: 600, // ms between individual enemy spawns in a wave (scaled)
  maxSimultaneousEnemies: 200,
  projectileLifetime: 4000 // ms
};

const MAXS = {
  TOWER_DAMAGE: 10000,
  TOWER_RANGE: 1200,
  TOWER_FIRE_RATE: 10, // shots per second
  CASTLE_HP: 25000,
  CASTLE_ARMOR: 500,
  CRIT_CHANCE: 90 // percent
};

const UPGRADE_COST_MULT = 1.17; // cost growth per level
const NEAR_INF_INCREMENT = 0.001; // fractional increases for very late-game tiers

// ---------------------------- Compatibility Helpers ----------------------------
function hasGlobal(name) {
  try { return typeof (eval(name)) !== 'undefined'; } catch (e) { return false; }
}

// preserve or create object pools for floating/damage text
let floatingTextPool = null;
if (typeof floatingTextPoolGlobal !== 'undefined') {
  floatingTextPool = floatingTextPoolGlobal;
} else if (typeof floatingTextPool !== 'undefined') {
  // already present
} else if (typeof window !== 'undefined' && window.floatingTextPool) {
  floatingTextPool = window.floatingTextPool;
} else {
  // local pool
  floatingTextPool = (function createLocalPool(){
    const pool = [];
    return {
      get(text, x, y, opts = {}) {
        const obj = pool.length ? pool.pop() : { text:'', x:0, y:0, t:0, ttl:1000 };
        obj.text = text; obj.x = x; obj.y = y; obj.t = Date.now(); obj.ttl = opts.ttl || 1000;
        obj.color = opts.color || 'white';
        return obj;
      },
      release(obj) { pool.push(obj); },
      _pool: pool
    };
  })();
  // expose to window for compatibility
  if (typeof window !== 'undefined') window.floatingTextPool = floatingTextPool;
}

// ---------------------------- Canvas & Context Setup ----------------------------
let canvas = null;
let ctx = null;
function ensureCanvas() {
  if (!canvas) {
    canvas = document.getElementById(TD_CONFIG.canvasId) || document.querySelector('canvas');
    if (!canvas) {
      // create a canvas if none exists (non-intrusive)
      canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);
    }
    ctx = canvas.getContext('2d');
  }
}

// ---------------------------- Core Game State ----------------------------
const TDState = {
  running: false,
  lastTime: 0,
  delta: 0,
  wave: 0,
  gold: 100,
  enemiesAlive: 0,
  enemiesKilled: 0,
  enemiesPool: [],
  projectilesPool: [],
  floatingTexts: [],
  enemyPoolSize: 300,
  projectilePoolSize: 200,
  tower: null,
  castle: null,
  waveManager: null
};

// ---------------------------- Utility Functions ----------------------------
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function lerp(a,b,t){ return a + (b-a)*t; }
function now(){ return performance.now(); }
function randRange(min,max){ return Math.random()*(max-min)+min; }

// ---------------------------- Enemy Class & Pool ----------------------------
class Enemy {
  constructor() {
    this.reset();
  }
  reset() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.hp = 10; this.maxHp = 10;
    this.speed = 0.6;
    this.reward = 5;
    this.size = 18;
    this.hue = 0;
    this.type = 'grunt';
    this.spawnedAt = 0;
    this.targetReached = false;
  }
  init(x,y,template) {
    this.active = true;
    this.x = x; this.y = y;
    this.hp = template.hp; this.maxHp = template.hp;
    this.speed = template.speed;
    this.reward = template.reward;
    this.size = template.size || 18;
    this.hue = template.hue || 0;
    this.type = template.type || 'grunt';
    this.spawnedAt = now();
    this.targetReached = false;
  }
  update(dt) {
    // simple linear path: move left towards castle (assume castle near x=100)
    const targetX = 120; // castle x
    const dx = targetX - this.x;
    const step = Math.sign(dx) * this.speed * dt * 0.06;
    this.x += step;
    // if reach castle
    if (Math.abs(this.x - targetX) < 6) {
      this.targetReached = true;
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = `hsl(${this.hue},80%,50%)`;
    ctx.beginPath();
    ctx.arc(0,0,this.size/2,0,Math.PI*2);
    ctx.fill();
    // HP bar
    ctx.fillStyle = 'black';
    ctx.fillRect(-this.size/2, -this.size/1.6, this.size, 4);
    ctx.fillStyle = 'lime';
    const pct = clamp(this.hp / this.maxHp, 0, 1);
    ctx.fillRect(-this.size/2, -this.size/1.6, this.size * pct, 4);
    ctx.restore();
  }
  takeDamage(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }
  die() {
    this.active = false;
    TDState.enemiesAlive = Math.max(0, TDState.enemiesAlive - 1);
    TDState.enemiesKilled++;
    TDState.gold += this.reward;
    // floating text
    TDState.floatingTexts.push(floatingTextPool.get(`+${this.reward}`, this.x, this.y - 10, {color:'gold', ttl:1000}));
  }
}

// create enemy pool
function createEnemyPool(n) {
  const pool = [];
  for (let i=0;i<n;i++) pool.push(new Enemy());
  return pool;
}

// ---------------------------- Projectile ----------------------------
class Projectile {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.speed = 600;
    this.damage = 1;
    this.ttl = 2000;
    this.spawn = 0;
  }
  init(x,y,tx,ty,damage,speed) {
    this.active = true;
    this.x = x; this.y = y;
    const dx = tx - x, dy = ty - y;
    const dist = Math.hypot(dx,dy) || 1;
    this.vx = (dx/dist) * (speed || this.speed);
    this.vy = (dy/dist) * (speed || this.speed);
    this.damage = damage;
    this.spawn = now();
    this.ttl = TD_CONFIG.projectileLifetime;
  }
  update(dt) {
    this.x += this.vx * dt * 0.001;
    this.y += this.vy * dt * 0.001;
    if (now() - this.spawn > this.ttl) this.active = false;
  }
  draw(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,200,50,0.95)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------- Tower & Castle ----------------------------
class Tower {
  constructor() {
    this.x = 240; this.y = 300; // default positions
    this.damage = 25;
    this.range = 240;
    this.fireRate = 1.2; // shots per second
    this.crit = 5; // percent
    this.levels = {damage:0, range:0, fireRate:0, crit:0};
    this.lastShot = 0;
    this.sprite = (typeof player !== 'undefined' && player.sprite) ? player.sprite : null;
  }
  canShoot() {
    const nowT = now();
    return (nowT - this.lastShot) >= (1000 / clamp(this.fireRate, 0.001, MAXS.TOWER_FIRE_RATE));
  }
  findTarget() {
    // naive: pick closest enemy in range
    const enemies = TDState.enemiesPool;
    let best = null;
    let bestDist = 1e9;
    for (let e of enemies) {
      if (!e.active) continue;
      const dx = e.x - this.x, dy = e.y - this.y;
      const d = Math.hypot(dx,dy);
      if (d <= this.range && d < bestDist) { best = e; bestDist = d; }
    }
    return best;
  }
  shootAt(target) {
    if (!target) return;
    const crit = Math.random()*100 < this.crit;
    let dmg = this.damage * (crit ? 2.0 : 1.0);
    dmg = Math.min(dmg, MAXS.TOWER_DAMAGE);
    // spawn projectile from tower to target
    const proj = TDState.projectilesPool.find(p => !p.active);
    if (proj) {
      proj.init(this.x, this.y, target.x, target.y, dmg, 900);
    } else {
      // fallback: create quick projectile
      const p = new Projectile();
      p.init(this.x, this.y, target.x, target.y, dmg, 900);
      TDState.projectilesPool.push(p);
    }
    this.lastShot = now();
    // small muzzle flash text
    TDState.floatingTexts.push(floatingTextPool.get(`-${Math.round(dmg)}`, target.x, target.y - 8, {color:'white', ttl:600}));
  }
  upgrade(stat) {
    const mgr = UpgradeManager;
    if (!mgr.canAffordUpgrade(stat)) return false;
    mgr.payForUpgrade(stat);
    if (stat === 'damage') {
      // late game fractional increments beyond level 50
      const inc = this.levels.damage < 50 ? 6 : Math.max(NEAR_INF_INCREMENT, 6 * 0.001);
      this.damage = Math.min(MAXS.TOWER_DAMAGE, this.damage + inc);
      this.levels.damage++;
    } else if (stat === 'range') {
      const inc = this.levels.range < 50 ? 12 : Math.max(NEAR_INF_INCREMENT, 12 * 0.001);
      this.range = Math.min(MAXS.TOWER_RANGE, this.range + inc);
      this.levels.range++;
    } else if (stat === 'fireRate') {
      const inc = this.levels.fireRate < 50 ? 0.12 : Math.max(NEAR_INF_INCREMENT, 0.12 * 0.001);
      this.fireRate = Math.min(MAXS.TOWER_FIRE_RATE, this.fireRate + inc);
      this.levels.fireRate++;
    } else if (stat === 'crit') {
      const inc = this.levels.crit < 50 ? 1 : Math.max(NEAR_INF_INCREMENT, 1 * 0.001);
      this.crit = Math.min(MAXS.CRIT_CHANCE, this.crit + inc);
      this.levels.crit++;
    }
    TDState.floatingTexts.push(floatingTextPool.get(`Upgraded ${stat}`, this.x, this.y - 20, {color:'cyan', ttl:1000}));
    updateUI();
    return true;
  }
  draw(ctx) {
    ctx.save();
    // draw tower sprite if available
    if (this.sprite && this.sprite.complete) {
      try {
        ctx.drawImage(this.sprite, this.x - 32, this.y - 32, 64, 64);
      } catch(e) {
        // fallback
        ctx.fillStyle = 'gray';
        ctx.fillRect(this.x-20, this.y-20, 40,40);
      }
    } else {
      // simple representation
      ctx.fillStyle = '#666';
      ctx.fillRect(this.x-20, this.y-20, 40,40);
    }
    // range circle
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.arc(this.x, this.y, this.range, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }
}

class CastleWall {
  constructor() {
    this.x = 100; this.y = 300;
    this.maxHp = 500;
    this.hp = this.maxHp;
    this.armor = 10;
    this.regen = 0.02; // hp per second
    this.levels = {hp:0, armor:0, regen:0};
  }
  takeDamage(dmg) {
    const mitigated = Math.max(0, dmg - this.armor);
    this.hp -= mitigated;
    if (this.hp <= 0) {
      this.hp = 0;
      // TODO: handle castle destroyed (game over)
      stopGameGenesis();
      console.warn('Castle destroyed! Game over.');
    }
  }
  upgrade(stat) {
    const mgr = UpgradeManager;
    if (!mgr.canAffordUpgrade(stat)) return false;
    mgr.payForUpgrade(stat);
    if (stat === 'hp') {
      const inc = this.levels.hp < 50 ? 125 : Math.max(NEAR_INF_INCREMENT, 125 * 0.001);
      this.maxHp = Math.min(MAXS.CASTLE_HP, this.maxHp + inc);
      this.hp += inc;
      this.levels.hp++;
    } else if (stat === 'armor') {
      const inc = this.levels.armor < 50 ? 6 : Math.max(NEAR_INF_INCREMENT, 6 * 0.001);
      this.armor = Math.min(MAXS.CASTLE_ARMOR, this.armor + inc);
      this.levels.armor++;
    } else if (stat === 'regen') {
      const inc = this.levels.regen < 50 ? 0.02 : Math.max(NEAR_INF_INCREMENT, 0.02 * 0.001);
      this.regen += inc;
      this.levels.regen++;
    }
    TDState.floatingTexts.push(floatingTextPool.get(`Upgraded ${stat}`, this.x, this.y - 40, {color:'orange', ttl:1000}));
    updateUI();
    return true;
  }
  update(dt) {
    this.hp = Math.min(this.maxHp, this.hp + this.regen * (dt*0.001));
  }
  draw(ctx) {
    ctx.save();
    ctx.fillStyle = '#553';
    ctx.fillRect(this.x-38, this.y-48, 76, 96);
    ctx.fillStyle = '#222';
    ctx.fillRect(this.x-36, this.y-44, 72, 88);
    // hp bar
    ctx.fillStyle = 'black';
    ctx.fillRect(this.x-36, this.y+48, 72, 8);
    ctx.fillStyle = 'red';
    const pct = clamp(this.hp / this.maxHp, 0, 1);
    ctx.fillRect(this.x-36, this.y+48, 72 * pct, 8);
    ctx.restore();
  }
}

// ---------------------------- Upgrade Manager ----------------------------
const UpgradeManager = {
  costs: { damage: 50, range: 60, fireRate: 80, crit: 120, hp: 100, armor: 90, regen: 70 },
  levels: { damage: 0, range: 0, fireRate: 0, crit: 0, hp: 0, armor:0, regen:0 },
  baseCosts: {},
  init() {
    this.baseCosts = Object.assign({}, this.costs);
  },
  getCost(stat) {
    const lvl = this.levels[stat] || 0;
    const base = this.baseCosts[stat] || (this.costs[stat] || 50);
    return Math.ceil(base * Math.pow(UPGRADE_COST_MULT, lvl));
  },
  canAffordUpgrade(stat) {
    const cost = this.getCost(stat);
    return TDState.gold >= cost;
  },
  payForUpgrade(stat) {
    const cost = this.getCost(stat);
    if (TDState.gold >= cost) {
      TDState.gold -= cost;
      this.levels[stat] = (this.levels[stat] || 0) + 1;
      return true;
    }
    return false;
  }
};
UpgradeManager.init();

// ---------------------------- Wave Manager ----------------------------
class WaveManagerClass {
  constructor() {
    this.wave = 0;
    this.spawning = false;
    this.enemiesToSpawn = 0;
    this.spawned = 0;
    this.spawnTimer = 0;
    this.templateBase = {
      grunt: { hp: 30, speed: 0.4, reward: TD_CONFIG.baseGoldPerEnemy, size:18, hue: 20 }
    };
  }
  startNextWave() {
    this.wave++;
    TDState.wave = this.wave;
    this.enemiesToSpawn = 6 + Math.floor(this.wave * 1.2);
    this.spawned = 0;
    this.spawnTimer = 0;
    this.spawning = true;
    TDState.floatingTexts.push(floatingTextPool.get(`Wave ${this.wave}`, canvas.width/2, 60, {color:'white', ttl:2000}));
  }
  update(dt) {
    if (!this.spawning) return;
    // spawn interval scaled slightly by wave
    const interval = Math.max(120, TD_CONFIG.spawnInterval * Math.pow(0.98, this.wave*0.12));
    this.spawnTimer += dt;
    while (this.spawnTimer >= interval && this.spawned < this.enemiesToSpawn) {
      this.spawnTick();
      this.spawnTimer -= interval;
    }
    if (this.spawned >= this.enemiesToSpawn && TDState.enemiesAlive === 0) {
      // wave complete
      this.spawning = false;
      // small reward for completion
      const bonus = Math.floor(10 + this.wave * 2.1);
      TDState.gold += bonus;
      TDState.floatingTexts.push(floatingTextPool.get(`Wave ${this.wave} Cleared! +${bonus}`, canvas.width/2, 90, {color:'gold', ttl:2000}));
      // auto-start next wave after short delay
      setTimeout(()=> this.startNextWave(), 1500);
    }
  }
  spawnTick() {
    // select an inactive enemy from pool
    const e = TDState.enemiesPool.find(en => !en.active);
    if (!e) return;
    const spawnX = canvas.width + 30;
    const spawnY = randRange(100, canvas.height-100);
    // make template scale with wave
    const hp = Math.round(this.templateBase.grunt.hp * (1 + this.wave * 0.03));
    const speed = this.templateBase.grunt.speed * (1 + this.wave * 0.005);
    const reward = Math.max(1, Math.round(TD_CONFIG.baseGoldPerEnemy * (1 + this.wave * 0.02)));
    e.init(spawnX, spawnY, { hp, speed, reward, size: 18, hue: 20 + (this.wave % 20) * 8 });
    TDState.enemiesAlive++;
    this.spawned++;
    this.spawnedAt = now();
  }
}

// ---------------------------- Initialize Pools & Objects ----------------------------
function initTDState() {
  ensureCanvas();
  // enemy pool
  TDState.enemiesPool = createEnemyPool(TDState.enemyPoolSize);
  // projectile pool
  TDState.projectilesPool = [];
  for (let i=0;i<TDState.projectilePoolSize;i++) TDState.projectilesPool.push(new Projectile());
  // tower & castle
  TDState.tower = new Tower();
  TDState.castle = new CastleWall();
  TDState.waveManager = new WaveManagerClass();
  // try to map original names if they exist in file
  if (typeof window !== 'undefined') {
    window.TDState = TDState;
  }
}

// ---------------------------- Main Loop ----------------------------
let _tdAnimationHandle = null;
function tdLoop(ts) {
  if (!TDState.running) return;
  if (!TDState.lastTime) TDState.lastTime = ts;
  const dt = ts - TDState.lastTime;
  TDState.lastTime = ts;
  update(tdClamp(dt));
  draw();
  _tdAnimationHandle = requestAnimationFrame(tdLoop);
}
function tdClamp(v){ return Math.min(60, Math.max(8, v)); }

function update(dt) {
  // update wave manager
  TDState.waveManager.update(dt);
  // update enemies
  for (let e of TDState.enemiesPool) {
    if (!e.active) continue;
    e.update(dt);
    if (e.targetReached) {
      TDState.castle.takeDamage( Math.round(5 + e.maxHp*0.05) );
      e.active = false;
      TDState.enemiesAlive = Math.max(0, TDState.enemiesAlive - 1);
    }
  }
  // update projectiles and handle collisions
  for (let p of TDState.projectilesPool) {
    if (!p.active) continue;
    p.update(dt);
    // collision check with enemies (simple radius-based)
    for (let e of TDState.enemiesPool) {
      if (!e.active) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < e.size/1.5) {
        const killed = e.takeDamage(p.damage);
        p.active = false;
        if (killed) {
          // drop handled in e.die()
        }
        break;
      }
    }
  }
  // tower actions
  if (TDState.tower.canShoot()) {
    const target = TDState.tower.findTarget();
    if (target) TDState.tower.shootAt(target);
  }
  // update castle
  TDState.castle.update(dt);
  // update floating texts (lifetimes)
  const nowt = now();
  for (let i = TDState.floatingTexts.length - 1; i >= 0; i--) {
    const ft = TDState.floatingTexts[i];
    if (!ft) continue;
    if (nowt - ft.t > ft.ttl) {
      floatingTextPool.release(ft);
      TDState.floatingTexts.splice(i,1);
    } else {
      ft.y -= 0.2 * (dt*0.06); // slight float upward
    }
  }
  updateUI();
}

function draw() {
  if (!ctx) return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // background
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  // castle & tower
  TDState.castle.draw(ctx);
  TDState.tower.draw(ctx);
  // projectiles
  for (let p of TDState.projectilesPool) if (p.active) p.draw(ctx);
  // enemies (draw order)
  for (let e of TDState.enemiesPool) if (e.active) e.draw(ctx);
  // floating texts
  ctx.save();
  for (let ft of TDState.floatingTexts) {
    ctx.font = '14px sans-serif';
    ctx.fillStyle = ft.color || 'white';
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.restore();
  // HUD
  drawHUD();
}

function drawHUD() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(8,8,230,84);
  ctx.fillStyle = 'white';
  ctx.font = '13px sans-serif';
  ctx.fillText(`Wave: ${TDState.wave}`, 16, 28);
  ctx.fillText(`Gold: ${TDState.gold}`, 16, 46);
  ctx.fillText(`Enemies Alive: ${TDState.enemiesAlive}`, 16, 64);
  ctx.fillText(`Tower: Dmg ${Math.round(TDState.tower.damage)} Rng ${Math.round(TDState.tower.range)} FR ${TDState.tower.fireRate.toFixed(2)} Crit ${TDState.tower.crit}%`, 16, 82);
  ctx.restore();
}

// ---------------------------- Public Hooks (preserve existing names) ----------------------------
function init() {
  // Try to call original init if it exists in the previous file
  try { if (typeof originalInit === 'function') originalInit(); } catch(e){}
  initTDState();
  // very small simulation log
  console.log('Tower Defense init completed. Call startGameGenesis() to begin.');
}

function startGameGenesis() {
  if (TDState.running) return;
  ensureCanvas();
  TDState.running = true;
  TDState.lastTime = 0;
  // reset some state
  TDState.wave = 0;
  TDState.enemiesAlive = 0;
  TDState.enemiesKilled = 0;
  TDState.floatingTexts = [];
  // start first wave after a short delay
  setTimeout(()=> TDState.waveManager.startNextWave(), TD_CONFIG.waveStartDelay);
  _tdAnimationHandle = requestAnimationFrame(tdLoop);
  // try to call original starter if present
  try { if (typeof originalStartGameGenesis === 'function') originalStartGameGenesis(); } catch(e){}
}

function stopGameGenesis() {
  TDState.running = false;
  if (_tdAnimationHandle) cancelAnimationFrame(_tdAnimationHandle);
  // try to call original stopper
  try { if (typeof originalStopGameGenesis === 'function') originalStopGameGenesis(); } catch(e){}
}

// ---------------------------- UI Integration ----------------------------
function updateUI() {
  // call original updateUI if present to keep compatibility with other UI elements
  try { if (typeof originalUpdateUI === 'function') originalUpdateUI(); } catch(e){}
  // attempt to update known DOM elements if present
  const elWave = document.getElementById('td-wave');
  if (elWave) elWave.textContent = `Wave: ${TDState.wave}`;
  const elGold = document.getElementById('td-gold');
  if (elGold) elGold.textContent = `Gold: ${TDState.gold}`;
  // more UI bindings can be added by developer
}

// ---------------------------- Controls (basic keyboard + click for quick testing) ----------------------------
function bindSimpleControls() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'u') {
      // open simple upgrade menu cycling through some stats (for quick testing)
      TDState.tower.upgrade('damage');
    } else if (e.key === 'i') {
      TDState.tower.upgrade('range');
    } else if (e.key === 'o') {
      TDState.tower.upgrade('fireRate');
    } else if (e.key === 'p') {
      TDState.castle.upgrade('hp');
    } else if (e.key === ' ') {
      // immediate start next wave as debug
      TDState.waveManager.startNextWave();
    } else if (e.key === 'Escape') {
      stopGameGenesis();
    }
  });
  canvas.addEventListener('click', (ev)=>{
    // clicking near tower attempts upgrade damage (quick test)
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const d = Math.hypot(mx - TDState.tower.x, my - TDState.tower.y);
    if (d < 80) TDState.tower.upgrade('damage');
  });
}

// ---------------------------- Small Sanity Test ----------------------------
(function immediateInit() {
  // preserve previous global originals if they existed
  if (typeof init === 'function' && init !== window.init) {
    // nothing
  }
  // store originals if present so we can call them from our wrappers
  try {
    if (typeof window !== 'undefined') {
      if (window.init && window.init !== init) window.originalInit = window.init;
      if (window.startGameGenesis && window.startGameGenesis !== startGameGenesis) window.originalStartGameGenesis = window.startGameGenesis;
      if (window.stopGameGenesis && window.stopGameGenesis !== stopGameGenesis) window.originalStopGameGenesis = window.stopGameGenesis;
      if (window.updateUI && window.updateUI !== updateUI) window.originalUpdateUI = window.updateUI;
    }
  } catch(e) {}
  // expose our functions as globals (compatible names)
  if (typeof window !== 'undefined') {
    window.init = init;
    window.startGameGenesis = startGameGenesis;
    window.stopGameGenesis = stopGameGenesis;
    window.updateUI = updateUI;
    window.TDState = TDState;
  }
  // auto-init TD state but do not auto-start the game loop
  initTDState();
  bindSimpleControls();
  console.log('Refactored game.js loaded. Call startGameGenesis() to begin waves.');
})();

// Developer note (tunable constants at top):
// - MAXS object contains hard-coded caps for tower and castle stats.
// - Wave scaling uses small incremental multipliers (wave * 0.03 on HP, *0.005 on speed) for fairness.
// - Upgrade costs grow by UPGRADE_COST_MULT (1.17 per level) and after level ~50 upgrades use tiny fractional increments (NEAR_INF_INCREMENT) to provide near-infinite progression.
// - ENDLESS_UNLOCK_LEVEL: If your original code uses this, keep the constant or adjust externally.
// End of file
