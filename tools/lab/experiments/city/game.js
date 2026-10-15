// An experiment: the lab's grid city on its own cartridge (../../city.js): streets with
// traffic and signals, people on the pavement, the player's own car, a police chase from
// the dev menu, shooting, the minimap and a mission. Served as /games/lab-city/, beside
// the lab (/games/lab/), whose maps and strings it uses.
import lab from '../lab/game.js';

export default {
  ...lab,
  id: 'lab-city',
  strings: ['../lab/locales/es/common.json', 'locales/es/common.json'],
  async newGame(api) {
    await lab.dev.jumps.find((j) => j.label === 'city').run(api);
    api.persist();
  },
};
