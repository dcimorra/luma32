// What a game runs on, by extension: the only files of a game folder or a package that are
// ever served, kept offline or stored (protect.mjs, offline.mjs, packages.mjs). A game's
// notes, references and reports (.md, .html…) are none of these.
export const CODE = new Set(['.js', '.mjs']);
export const DATA = new Set(['.json']);
export const PLAIN = new Set(['.png', '.jpg', '.webp', '.gif', '.svg', '.woff2', '.mp3', '.ogg', '.wav', '.css']);
export const SERVED = new Set([...CODE, ...DATA, ...PLAIN]);
