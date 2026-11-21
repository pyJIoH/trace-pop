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

  const SAY = {};
  for (const [id, name] of Object.entries(LETTER_NAMES)) SAY['letter-' + id.toLowerCase()] = name + '!';
  NUMBER_NAMES.forEach((name, i) => { SAY['num-' + i] = name + '!'; });
  Object.assign(SAY, {
    letters: 'Letters!',
    numbers: 'Numbers!',
    'praise-1': 'Great job!',
    'praise-2': 'You did it!',
    'praise-3': 'Awesome!',
    'praise-4': 'Well done!',
    'praise-5': 'Super!',
    'hint-start': 'Draw it with your finger!',
    'all-letters': 'You traced all the letters!',
    'all-numbers': 'You traced all the numbers!',
  });

  const PRAISE = ['praise-1', 'praise-2', 'praise-3', 'praise-4', 'praise-5'];

  TP.speech = {
    SAY,
    PRAISE,
    /** The key of a glyph's name: 'A' → 'letter-a', '3' → 'num-3'. */
    keyFor: (glyph) => (glyph.kind === 'letter' ? 'letter-' + glyph.id.toLowerCase() : 'num-' + glyph.id),
    url: (key) => `audio/say/${key}.mp3`,
  };
})();
