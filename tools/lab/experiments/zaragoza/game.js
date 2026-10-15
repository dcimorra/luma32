// An experiment: Zaragoza from OpenStreetMap on its own cartridge (../../zaragoza.js): the
// whole city inside its ring roads, its streets a graph with diagonals, signals and
// traffic, its blocks raised by their storeys and its landmarks drawn. Starts by the
// Pilar. Served as /games/lab-zaragoza/, beside the lab (/games/lab/), whose maps and
// strings it uses. Map data © OpenStreetMap contributors (ODbL).
import lab from '../lab/game.js';

export default {
  ...lab,
  id: 'lab-zaragoza',
  strings: ['../lab/locales/es/common.json', 'locales/es/common.json'],
  async newGame(api) {
    await lab.dev.jumps.find((j) => j.label === 'zaragoza').run(api);
    api.persist();
  },
};
