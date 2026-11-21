/* Trace Pop — everything the voice says: key → the text given to the voice.
   Each key is one file, audio/say/<key>.mp3, made by tools/make-audio.mjs.
   A single letter is read unpredictably, so letter names are spelled the way they sound. */
(function () {
  'use strict';
  const TP = (window.TP = window.TP || {});

  const LETTER_NAMES = {
    A: 'Ay', B: 'Bee', C: 'See', D: 'Dee', E: 'Ee', F: 'Eff', G: 'Jee', H: 'Aitch', I: 'Eye',
    J: 'Jay', K: 'Kay', L: 'El', M: 'Em', N: 'En', O: 'Oh', P: 'Pee', Q: 'Cue', R: 'Ar', S: 'Ess',
    T: 'Tee', U: 'You', V: 'Vee', W: 'Double-you', X: 'Ex', Y: 'Why', Z: 'Zee',
  };
  const NUMBER_NAMES = [
    'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
    'Twenty', 'Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four', 'Twenty-five', 'Twenty-six', 'Twenty-seven',
    'Twenty-eight', 'Twenty-nine', 'Thirty',
  ];

  const SHAPE_NAMES = {
    circle: 'Circle', oval: 'Oval', square: 'Square', rectangle: 'Rectangle', triangle: 'Triangle',
    diamond: 'Diamond', semicircle: 'Semicircle', star: 'Star', heart: 'Heart', cross: 'Cross',
  };
  const PICTURE_NAMES = {
    sun: 'Sun', moon: 'Moon', cloud: 'Cloud', house: 'House', tree: 'Tree', flower: 'Flower',
    apple: 'Apple', fish: 'Fish', boat: 'Boat', balloon: 'Balloon', umbrella: 'Umbrella', car: 'Car',
  };

  const SAY = {};
  for (const [id, name] of Object.entries(LETTER_NAMES)) SAY['letter-' + id.toLowerCase()] = name + '!';
  NUMBER_NAMES.forEach((name, i) => { SAY['num-' + i] = name + '!'; });
  for (const [id, name] of Object.entries(SHAPE_NAMES)) SAY['shape-' + id] = name + '!';
  for (const [id, name] of Object.entries(PICTURE_NAMES)) SAY['pic-' + id] = name + '!';
  Object.assign(SAY, {
    letters: 'Letters!',
    numbers: 'Numbers!',
    shapes: 'Shapes!',
    pictures: 'Pictures!',
    'praise-1': 'Great job!',
    'praise-2': 'You did it!',
    'praise-3': 'Awesome!',
    'praise-4': 'Well done!',
    'praise-5': 'Super!',
    'hint-start': 'Draw it with your finger!',
    'all-letters': 'You traced all the letters!',
    'all-numbers': 'You traced all the numbers!',
    'all-shapes': 'You traced all the shapes!',
    'all-pictures': 'You traced all the pictures!',
  });

  const PRAISE = ['praise-1', 'praise-2', 'praise-3', 'praise-4', 'praise-5'];

  // What is said for a whole set: on its tile, and when the last one of the set is drawn.
  const SETS = {
    letter: { tile: 'letters', all: 'all-letters', prefix: 'letter-' },
    number: { tile: 'numbers', all: 'all-numbers', prefix: 'num-' },
    shape: { tile: 'shapes', all: 'all-shapes', prefix: 'shape-' },
    picture: { tile: 'pictures', all: 'all-pictures', prefix: 'pic-' },
  };

  TP.speech = {
    SAY,
    PRAISE,
    SETS,
    /** Every phrase that is not the name of a glyph (for the tools that check the list). */
    OTHER: ['hint-start', ...PRAISE, ...Object.values(SETS).flatMap((s) => [s.tile, s.all])],
    /** The key of a glyph's name: 'A' → 'letter-a', '3' → 'num-3', 'sun' → 'pic-sun'. */
    keyFor: (glyph) => SETS[glyph.kind].prefix + glyph.id.toLowerCase(),
    url: (key) => `audio/say/${key}.mp3`,
  };
})();
