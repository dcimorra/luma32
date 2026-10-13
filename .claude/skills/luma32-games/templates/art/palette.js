// The palette of this world. Every colour the cartridge paints comes from here.
//
// Colour rules (write your own for each game):
// - A warm afternoon: greens lean yellow, shadows lean blue-violet, never grey.
// - Outlines are `ink`, a dark brown: never pure black.
// - Every material has a base, a highlight (Hi) and a shadow (Lo).
// - Saturated colours are few and mean something: `accent` marks what matters
//   (the title, a door that opens); the rest of the world stays muted.
export const C = {
  ink: '#2a1e18',
  grass: '#5a9a4a', grassHi: '#74b65e', grassLo: '#447a38',
  sand: '#d8c890', sandHi: '#e8dcaa', sandLo: '#b8a670',
  water: '#3a70c0', waterHi: '#80b0f0', waterLo: '#28508a',
  stone: '#9a948a', stoneHi: '#b8b2a6', stoneLo: '#76706a',
  wood: '#8a5a32', woodHi: '#a8743e', woodLo: '#5e3c22',
  leaf: '#2e6a32', leafHi: '#4a8a3e', leafLo: '#1e4a2a',
  night: '#101828', paper: '#f8f0dc', accent: '#ffcc40',
};
