// Runs one cartridge: its title screen, then the story, until the player quits
// back to the title or ejects it from there.
import { TitleScreen } from './console.js';
import { World } from './world.js';
import { SaveSlot, slotsOf } from './save.js';
import { setTheme, setPortraits } from './ui.js';
import { paintShell } from './shell.js';
import { defineSongs, defineEffects, setOrchestra, music, ambience } from './audio.js';
import { t } from './i18n.js';

export async function runCartridge(engine, game) {
  setTheme(game.theme?.ui || {});
  setPortraits(game.portraits);
  paintShell(game.theme?.shell);
  // the extra buttons it asks for; any it reads later comes out on its own (input.js)
  engine.input.useButtons(game.buttons);
  setOrchestra(game.orchestra);
  defineSongs(game.songs || {});
  defineEffects(game.effects || {});
  await game.setup?.();

  for (;;) {
    const { id, slot } = await engine.replaceAll(new TitleScreen(game, slotsOf(game)));
    if (id === 'eject') { music(null); ambience(null); return; }
    // the slot chosen on the title is where every save of this play goes
    game.saveSlot = slot;
    const save = id === 'continue' ? slot.load(game) : SaveSlot.fresh(game);
    await play(engine, game, save, id === 'continue');
    music(null);
    ambience(null);
    engine.fx.fade = 0;
  }
}

function play(engine, game, save, resume) {
  return new Promise((resolve) => {
    const world = new World(engine, game, save);
    game.quit = () => { game.quit = null; engine.fadeOut(20).then(() => { engine.replaceAll({ pointer: true, draw() {}, update() {} }); engine.fx.fade = 0; resolve(); }); };
    engine.replaceAll(world);
    if (resume) {
      world.load(save.map, save.x, save.y, save.dir);
      if (typeof save.heading === 'number') world.player.heading = save.heading;
      world.run(async (api) => {
        engine.fx.fade = 1;
        if (world.map.name) api.banner(world.map.name);
        await api.fadeIn(400);
        // back after a while: one line on where the story was
        if (save.objective && game.recap !== false) await api.say(null, 'console.resume.recap', { vars: { objective: api.text(save.objective) }, style: 'box' });
        if (game.resume) await game.resume(api);
        else if (world.map.enter) await world.map.enter(api);
      });
    } else {
      world.run((api) => game.newGame(api));
    }
  });
}
