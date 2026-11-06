// Kit: battles with time gauges (each one acts when their bar fills; the clock waits while
// the player chooses). Code to copy beside game.js and make the game's own: the screen, the
// formulas, the menu, what foes do. It is not a library the engine knows, and nothing in
// the console asks a game to use it: a game with another kind of battle writes its own.
//
//   import { Battle, encounter } from './battle.js';
//   const r = await api.play(new Battle(api, {
//     party: [{ id: 'ana', name: 'speakers.ana', hp: 30, maxHp: 30, mp: 8, maxMp: 8, atk: 6, def: 3, mag: 5, spd: 5,
//               skills: [{ name: 'skill.fire', cost: 3, power: 10, magic: true }, { name: 'skill.cure', cost: 2, power: 12, heal: true }] }],
//     foes: [{ name: 'foe.slime', hp: 14, atk: 4, def: 1, spd: 3, draw(ctx, x, y, f, self) {} }],
//     bg(ctx, frame) {},            // the backdrop (default: the game's own colour)
//     items: { list: (api) => [{ id, name, count }], use(api, id, target) { … } },   // optional
//     canFlee: true,
//   }));
//   // r = { result: 'won' | 'lost' | 'fled', party }   (the party's hp and mp as they ended)
//
// Text: every name is a key of the cartridge's catalogue, and so are the menu and the
// lines: battle.attack battle.skill battle.item battle.flee battle.won battle.lost
// battle.fled battle.cant_flee battle.no_mp (labels: { … } changes any of them).
import { SCREEN_W, SCREEN_H } from '../../engine/gfx.js';
import { drawText, measure } from '../../engine/font.js';
import { frame, bar, getTheme } from '../../engine/ui.js';
import { sfx } from '../../engine/audio.js';

const LABELS = {
  attack: 'battle.attack', skill: 'battle.skill', item: 'battle.item', flee: 'battle.flee',
  won: 'battle.won', lost: 'battle.lost', fled: 'battle.fled', cantFlee: 'battle.cant_flee', noMp: 'battle.no_mp',
};
const FULL = 100;

export class Battle {
  constructor(api, { party, foes, bg = null, items = null, canFlee = true, labels = {}, speed = 0.5, colors = {} }) {
    this.api = api;
    this.party = party.map((m) => ({ ...m, side: 'party', gauge: Math.random() * 40, hp: m.hp ?? m.maxHp, mp: m.mp ?? m.maxMp ?? 0 }));
    this.foes = foes.map((f, i) => ({ maxHp: f.hp, ...f, side: 'foe', i, gauge: Math.random() * 30 }));
    Object.assign(this, { bg, items, canFlee, speed });
    this.labels = { ...LABELS, ...labels };
    // the windows' own colours (theme.ui) unless the battle is given others
    const th = getTheme();
    this.c = { text: th.text, shadow: th.shadow, dim: th.dim || th.light, hp: '#58c060', gauge: th.accent, hurt: '#e04848', heal: '#38a860', ...colors };
    this.t = 0;
    this.queue = [];        // party members whose bar is full, waiting for the player
    this.menu = null;       // { who, level: 'root' | 'skill' | 'item' | 'target', sel, … }
    this.busy = null;       // an action being shown: { t, run }
    this.line = null;       // { text, t }
    this.pops = [];         // numbers that float up
    this.end = null;
    this.aboveFade = true;
    this.pointer = false;
  }

  text(k, vars) { return this.api.text(k, vars); }
  alive(list) { return list.filter((x) => x.hp > 0); }

  update(e) {
    this.t++;
    const inp = e.input;
    for (const p of this.pops) p.t++;
    this.pops = this.pops.filter((p) => p.t < 40);
    if (this.line && ++this.line.t > 70 && !this.busy) this.line = null;
    if (this.end) {
      if (++this.end.t > 30 && (inp.pressed('a') || this.end.t > 150)) this.done({ result: this.end.result, party: this.party });
      return;
    }
    if (this.busy) {
      if (++this.busy.t === 18) this.busy.run();
      if (this.busy.t >= 40) { this.busy = null; this.check(); }
      return;
    }
    if (this.menu) { this.choose(inp); return; }
    // the clock runs while nobody is choosing
    for (const x of [...this.alive(this.party), ...this.alive(this.foes)]) {
      if (x.gauge >= FULL) continue;
      x.gauge = Math.min(FULL, x.gauge + (x.spd || 3) * this.speed);
      if (x.gauge >= FULL && x.side === 'party') this.queue.push(x);
    }
    const foe = this.alive(this.foes).find((f) => f.gauge >= FULL);
    if (foe) { this.foeActs(foe); return; }
    const next = this.queue.find((m) => m.hp > 0);
    this.queue = this.queue.filter((m) => m !== next && m.hp > 0);
    if (next) { this.menu = { who: next, level: 'root', sel: 0 }; sfx('cursor'); }
  }

  // ---------- the player's choice ----------

  rootItems() {
    const r = [{ id: 'attack', label: this.labels.attack }];
    if (this.menu.who.skills?.length) r.push({ id: 'skill', label: this.labels.skill });
    if (this.items) r.push({ id: 'item', label: this.labels.item });
    if (this.canFlee) r.push({ id: 'flee', label: this.labels.flee });
    return r;
  }

  options() {
    const m = this.menu;
    if (m.level === 'root') return this.rootItems().map((o) => ({ ...o, label: this.text(o.label) }));
    if (m.level === 'skill') return m.who.skills.map((s) => ({ id: s, label: this.text(s.name), value: s.cost ? String(s.cost) : '', off: (s.cost || 0) > m.who.mp }));
    if (m.level === 'item') return this.items.list(this.api).filter((it) => it.count > 0).map((it) => ({ id: it, label: this.text(it.name), value: `×${it.count}` }));
    return m.targets.map((x) => ({ id: x, label: this.text(x.name) }));
  }

  choose(inp) {
    const m = this.menu;
    const opts = this.options();
    const n = opts.length;
    if (!n) { m.level = 'root'; m.sel = 0; return; }
    if (inp.pressed('up')) { m.sel = (m.sel + n - 1) % n; sfx('cursor'); }
    if (inp.pressed('down')) { m.sel = (m.sel + 1) % n; sfx('cursor'); }
    if (inp.pressed('b') && m.level !== 'root') { sfx('cancel'); Object.assign(m, m.back || { level: 'root', sel: 0 }); m.back = null; return; }
    if (!inp.pressed('a')) return;
    const o = opts[m.sel];
    if (o.off) { sfx('error'); this.say(this.labels.noMp); return; }
    sfx('confirm');
    if (m.level === 'root') {
      if (o.id === 'attack') return this.target({ kind: 'attack' }, this.alive(this.foes));
      if (o.id === 'skill') { m.level = 'skill'; m.sel = 0; return; }
      if (o.id === 'item') { m.level = 'item'; m.sel = 0; return; }
      if (o.id === 'flee') return this.flee();
    }
    if (m.level === 'skill') {
      const s = o.id;
      return this.target({ kind: 'skill', skill: s }, s.heal ? this.alive(this.party) : this.alive(this.foes), { level: 'skill', sel: m.sel });
    }
    if (m.level === 'item') return this.target({ kind: 'item', item: o.id }, this.alive(this.party), { level: 'item', sel: m.sel });
    if (m.level === 'target') { const who = m.who; const act = m.act; this.menu = null; this.act(who, act, o.id); }
  }

  target(act, targets, back = { level: 'root', sel: 0 }) {
    Object.assign(this.menu, { level: 'target', sel: 0, act, targets, back });
  }

  flee() {
    const who = this.menu.who;
    this.menu = null;
    who.gauge = 0;
    const theirs = Math.max(...this.alive(this.foes).map((f) => f.spd || 3));
    if (Math.random() < 0.5 + ((who.spd || 3) - theirs) * 0.1) { sfx('hop'); this.finish('fled'); return; }
    this.say(this.labels.cantFlee);
  }

  // ---------- actions ----------

  act(who, act, target) {
    who.gauge = 0;
    const name = act.kind === 'skill' ? act.skill.name : act.kind === 'item' ? act.item.name : null;
    if (name) this.say(name);
    this.busy = { t: 0, who, run: () => {
      if (act.kind === 'attack') this.hit(who, target, who.atk, false);
      if (act.kind === 'skill') {
        who.mp -= act.skill.cost || 0;
        if (act.skill.heal) this.heal(target, act.skill.power + (who.mag || 0));
        else this.hit(who, target, act.skill.power + (who.mag || 0), !!act.skill.magic);
      }
      if (act.kind === 'item') this.items.use(this.api, act.item.id, target, this);
    } };
  }

  foeActs(f) {
    f.gauge = 0;
    if (f.act) { f.act(this, f); return; }
    const targets = this.alive(this.party);
    const t = targets[Math.floor(Math.random() * targets.length)];
    this.busy = { t: 0, who: f, run: () => this.hit(f, t, f.atk, false) };
  }

  // What a hit takes off: the game's to change. Magic ignores half the defence.
  hit(from, to, power, magic) {
    const def = (to.def || 0) * (magic ? 0.5 : 1);
    const n = Math.max(1, Math.round(power * (0.9 + Math.random() * 0.2) * 2 - def));
    to.hp = Math.max(0, to.hp - n);
    to.flash = 12;
    this.pop(to, String(n), this.c.hurt);
    sfx('thud');
    if (to.side === 'party') this.api.engine?.shake?.(8, 2);
  }

  heal(to, n) {
    to.hp = Math.min(to.maxHp, to.hp + n);
    this.pop(to, String(n), this.c.heal);
    sfx('item');
  }

  say(key, vars) { this.line = { text: this.text(key, vars), t: 0 }; }
  pop(x, text, color) { const at = this.spot(x); this.pops.push({ x: at.x, y: at.y - 24, text, color, t: 0 }); }

  check() {
    if (!this.alive(this.foes).length) this.finish('won');
    else if (!this.alive(this.party).length) this.finish('lost');
  }

  finish(result) {
    this.menu = null;
    this.end = { result, t: 0 };
    this.say(result === 'won' ? this.labels.won : result === 'lost' ? this.labels.lost : this.labels.fled);
  }

  // ---------- the screen ----------

  // where each one stands: foes on the left, the party on the right
  spot(x) {
    if (x.side === 'foe') {
      const n = this.foes.length;
      return { x: 40 + (x.i % 2) * 28, y: 30 + Math.round((x.i + 0.5) * (70 / n)) };
    }
    const i = this.party.indexOf(x);
    return { x: 180 + i * 6, y: 34 + i * 22 };
  }

  draw(ctx, e) {
    if (this.bg) this.bg(ctx, this.t, e);
    else { ctx.fillStyle = '#202838'; ctx.fillRect(0, 0, SCREEN_W, SCREEN_H); }
    for (const f of this.foes) {
      if (f.hp <= 0) continue;
      const at = this.spot(f);
      if (f.flash > 0) f.flash--;
      const hide = f.flash > 0 && f.flash % 4 < 2;
      if (!hide) (f.draw || blob)(ctx, at.x, at.y, this.t, f);
    }
    for (const m of this.party) {
      const at = this.spot(m);
      if (m.flash > 0) m.flash--;
      if (m.flash > 0 && m.flash % 4 < 2) continue;
      const step = this.busy?.who === m && this.busy.t < 30 ? -10 : 0;
      (m.draw || figure)(ctx, at.x + step, at.y, this.t, m);
    }
    // the cursor over the target
    if (this.menu?.level === 'target') {
      const tg = this.menu.targets[this.menu.sel];
      const at = this.spot(tg);
      if (Math.floor(this.t / 8) % 2) drawText(ctx, '▼', at.x - 3, at.y - 22, this.c.gauge);
    }
    if (this.line) {
      frame(ctx, 20, 3, SCREEN_W - 40, 18);
      drawText(ctx, this.line.text, Math.round(SCREEN_W / 2 - measure(this.line.text) / 2), 7, this.c.text, this.c.shadow);
    }
    for (const p of this.pops) drawText(ctx, p.text, Math.round(p.x - measure(p.text) / 2), Math.round(Math.max(24, p.y - p.t * 0.4)), p.color, '#101010');
    this.drawPanel(ctx);
  }

  drawPanel(ctx) {
    const y0 = SCREEN_H - 50;
    frame(ctx, 2, y0, SCREEN_W - 4, 48);
    this.party.forEach((m, i) => {
      const y = y0 + 6 + i * 13;
      const on = this.menu?.who === m;
      drawText(ctx, this.text(m.name), 96, y, m.hp <= 0 ? this.c.hurt : on ? this.c.gauge : this.c.text, this.c.shadow);
      drawText(ctx, `${m.hp}`, 150, y, this.c.text, this.c.shadow);
      bar(ctx, 172, y + 3, 30, 4, m.hp, m.maxHp, { fill: this.c.hp });
      bar(ctx, 206, y + 3, 28, 4, m.gauge, FULL, { fill: this.c.gauge });
    });
    if (!this.menu) return;
    const opts = this.options();
    const first = Math.max(0, Math.min(this.menu.sel - 1, opts.length - 3));
    opts.slice(first, first + 3).forEach((o, k) => {
      const i = first + k;
      const y = y0 + 6 + k * 13;
      if (i === this.menu.sel) drawText(ctx, '▶', 8, y, this.c.gauge, this.c.shadow);
      drawText(ctx, o.label, 18, y, o.off ? this.c.dim : this.c.text, this.c.shadow);
      if (o.value) drawText(ctx, o.value, 86 - measure(o.value), y, this.c.text, this.c.shadow);
    });
  }
}

// Stand-ins until the game draws its own.
function blob(ctx, x, y, t, f) {
  const b = Math.floor(t / 14) % 2;
  ctx.fillStyle = f.color || '#70b050';
  ctx.fillRect(x - 10, y - 12 + b, 20, 14 - b);
  ctx.fillRect(x - 7, y - 15 + b, 14, 3);
  ctx.fillStyle = '#101010';
  ctx.fillRect(x - 5, y - 8 + b, 3, 3); ctx.fillRect(x + 3, y - 8 + b, 3, 3);
}
function figure(ctx, x, y, t, m) {
  ctx.fillStyle = m.hp <= 0 ? '#505060' : m.color || '#d0a070';
  if (m.hp <= 0) { ctx.fillRect(x - 8, y - 4, 16, 5); return; }
  ctx.fillRect(x - 4, y - 16, 8, 7);
  ctx.fillStyle = m.coat || '#4060b0';
  ctx.fillRect(x - 5, y - 9, 10, 9);
}

// A random battle on a step, for the `onStep` hook of a map or a tile: `rate` is the
// chance a step starts one (0.06 is about one every 16 steps), `pick(api)` returns the
// Battle's options (or null for none here), `then(api, r)` handles the result. The way in
// is the game's: `transition` is any fade kind, its own included (game.transitions).
export function encounter({ rate = 0.06, pick, then, transition = 'mosaic', music = null }) {
  return (api) => {
    if (Math.random() >= rate) return undefined;
    const opts = pick(api);
    if (!opts) return undefined;
    return async (a) => {
      a.sfx('start');
      await a.fadeOut(500, '#ffffff', { kind: transition, at: 'player' });
      if (music) a.music(music);
      const r = await a.play(new Battle(a, opts));
      await then?.(a, r);
      if (r.result !== 'lost') await a.fadeIn(300);
    };
  };
}
