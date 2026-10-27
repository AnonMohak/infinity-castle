// Infinity Castle — the director. It follows the depth of the fall through the chapters and runs each one:
// the speed of the fall, the run of camera shots, when the castle refolds, whether debris falls with you.
import { SHOTS, chapterAt } from './chapters.js';

export class Director {
  constructor() {
    this.at = null;
    this.key = '';
    this.k = -1;          // which shot of the chapter's list
    this.shot = 0;        // index into SHOTS
    this.end = 0;         // when the shot changes
    this.tumbleAt = -1;
    this.nextStrike = Infinity;
  }

  // call every frame while falling; returns the chapter state
  update(depth, t) {
    const at = chapterAt(depth);
    const key = `${at.loop}:${at.i}`;
    if (key !== this.key) {
      this.key = key;
      this.k = -1;
      this.end = 0;
      this.nextStrike = at.ch.strike ? t + at.ch.strike * 0.6 : Infinity;
    }
    this.at = at;
    if (t > this.end) this.nextShot(t);
    return at;
  }

  nextShot(t) {
    const ch = this.at.ch, list = ch.shots;
    this.k = (this.k + 1) % list.length;
    this.shot = list[this.k];
    const s = SHOTS[this.shot];
    this.end = t + s.dur * ch.cut * (0.85 + Math.random() * 0.3);
    if (s.tumble) this.tumbleAt = t + 1.5;
  }

  get shotSpec() { return SHOTS[this.shot]; }

  // the speed the fall settles to here
  speed() {
    const { ch, u } = this.at;
    return ch.ease ? ch.ease + (ch.speed - ch.ease) * Math.min(1, u * 1.4) : ch.speed;
  }

  // is it time for the castle to refold (the refold chapter does it on its own, every few seconds)?
  strikeDue(t) {
    if (t < this.nextStrike) return false;
    this.nextStrike = t + this.at.ch.strike * (0.75 + Math.random() * 0.5);
    return true;
  }

  get debris() { return !!this.at?.ch.debris; }
}
