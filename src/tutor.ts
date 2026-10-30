// What the hero says, and when (thread «Обучение от лица героя»). The warm-up: Бастион shows a newcomer the ropes on three
// dummies, one beat after another, each up while it applies. The hints: one line the first time something happens in any
// run (the first «ТОЧНО!», the first fire, the first camp…), once per browser, never in the way of the game.
// Бастион says all of it, as the one who showed the player round; no numbers and no game words in his mouth.

import { HEROES } from './data';
import { MOB_TOP } from './draw/figures';
import type { Camera } from './camera';
import type { Game, HeroState } from './game';
import { Coach, type Box, type Line } from './coach';
import { srcOf } from './i18n';

/** Where the player is: in a room, on the map, in a window between rooms, or in a menu over all that. */
export type Where = 'room' | 'map' | 'event' | 'camp' | 'forge' | 'whet' | 'loot' | 'end' | 'menu';

const BASTION = HEROES.find(h => h.key === 'bastion')!;
export const BASTION_I = HEROES.indexOf(BASTION);

/** The warm-up's lines, in the order they come. */
export const WARM_LINES = {
  offer: 'Опа, новенький! Пошли сперва на манекенах разомнёмся, покажу, что тут к чему. Быстро, без соплей: пузо уже разогрето.',
  look: 'Ты пока осмотрись здесь, а я пузо разомну. Вот этими кнопками комнату крутят и приближают, если чего не разглядел. Крути смело, манекенов не укачает.',
  rune: 'Видишь светящийся кружок на полу? Ткни в него, я туда встану. Оттуда и будем лупить.',
  go: 'Стою. Красивый. Жми «В бой!», манекены сами себя не отлупят.',
  pull: 'Хватай меня за пузо и тяни назад, как рогатку. Отпустишь, и полетит диск. Чем сильнее тянешь, тем больнее прилетит.',
  hit: 'Видал, как его крутануло? Вот это я понимаю, любовь с первого броска.',
  miss: 'Мимо. Ничего, у меня с девчонками тоже не с первого раза.',
  queue: 'Глянь наверх: это очередь манекенов, кто левее, тот ходит первым. Значок моего цвета значит, что метят в меня. Ткни в рожу, там написано, что он задумал.',
  end: 'Диск кончился, жми «Конец хода». Куда лёг диск, туда я и перебегу. Так что кидай с умом: где диск, там и пузо.',
  ouch: 'Ай! Пружиной по пузу! Вот эта полоса внизу и есть моё здоровье. Кончится, и я лягу. Красиво, но надолго. Не доводи.',
  crystal: 'Видишь толчок с фиолетовой хренью? Это кристалл. Попади в него, и мне капнут искры. Чуток не хватает до коронного номера.',
  ability: 'Искры полные! Жми вот сюда, и каждый мой удар по манекену прикроет меня щитом. Бей чаще, щит толще.',
  wall: 'Манекенша за колонной спряталась, стесняется. Кидай в стенку: диск отскочит, как я от тёщи. Стены тут бесплатные, пользуйся.',
  nodie: 'Чуть не помер. Ладно, на разминке не умирают. А вот внизу запросто, учти.',
  done: 'Всё, размялись. Дальше по-взрослому, там и прибить могут. Пузо вперёд!',
};

/** The hints, each said once, the first time it comes up; the order is which goes first when two come up at once. */
export const HINT_LINES = {
  crit: 'Видал? «Точно!» Это когда диск влетел гаду ровно в лоб и ни обо что по пути не стукнулся. Бьёт куда больнее, чем вскользь.',
  pit: 'Диск в яму, и с концами. А тебе ещё и по пузу прилетает, за глупость. Ямы обходи.',
  spikes: 'Ай! Диск лёг на гадость, а скакать туда тебе. Шипы, лава, всё это больно, между прочим.',
  ore: 'Руда! Вон наверху копится. Кузнец за неё сделает диски злее. В кампании она общая на всю банду, а в сети у каждого своя.',
  herbs: 'Помяли тебя. Видишь грибы? Попади в них, и подлечишься. Какие грибы, не спрашивай.',
  clink: '«Звон»! Ваши диски чокнулись друг о друга. Теперь оба следующим ударом вломят от души.',
  rage: 'Гады звереют, если долго возиться. С каждым ходом кусают больнее, так что кончай их быстрее.',
  party: 'Вас тут целая банда. Отстрелялся один, и к броску сам встаёт следующий, а можно ткнуть рожу наверху. «Конец хода» жмёшь один раз на всех.',
  fallen: 'Одного нашего уложили. Дожмёте комнату, и в следующем бою встанет, хоть и еле живой. Не реви, кидай за остальных.',
  fire: 'Горишь! В ход гадов ещё и прижжёт. Надеюсь, трусы огнеупорные.',
  chill: 'Бр-р-р, озноб. Руки трясутся, следующий бросок выйдет слабее.',
  daze: 'В ушах звенит... Прицела не видать, кидай на глазок.',
  pin: 'Примёрз! Кидать можешь, а к диску не побежишь. Стоишь как памятник.',
  map: 'Это карта этажа. Ткни, куда идём. На самом верху сидит босс: к нему и топаем, по дороге подбирая всё, что плохо лежит.',
  elite: 'Этот здоровее обычных, да ещё с охраной. Завалишь, и гном прибежит, наточит диск задаром.',
  whet: 'Гном точит бесплатно, но один раз. Выбирай, что подкрутить, пока он добрый.',
  forge: 'Кузнец! Руду ему, а нам диски злее. Второй диск в руку самое жирное, если руды хватит.',
  camp: 'Привал. Каждый делает что-то одно: дрыхнет, бинтует друга или ковыряет руду. Я бы дрыхнул.',
  event: 'Тут вечно какая-то дичь. Зелёное к добру, красное к беде, а где шанс, там монетку бросаем.',
  cave: 'Потолок на соплях. Где пыль, после хода рухнет камень, где красное, плита. Не вставай туда последним диском. Жила под пылью даёт вдвое. Потом жми «Уходим с рудой», пока тут всё не легло.',
  boss: 'Хозяин этажа. Здоровый... почти как я. Завалишь, и подлечитесь, и трофеи поделите.',
  loot: 'Трофеи! Бери одну штуку, будет твоя до конца забега. Остальное пусть тут гниёт.',
  smoke: 'Дым-машина. Ни хрена не видно дальше носа, кидай на память.',
  strobe: 'Стробоскоп мигает, прицела не видать. Кидай на глазок, как в молодости на дискотеке.',
};
export type HintId = keyof typeof HINT_LINES;

// ------------------------------------------------------------ what this browser has heard

interface Heard {
  /** Hints off in the settings. */
  off?: boolean;
  /** The warm-up was offered (taken or turned down): it isn't offered again. */
  warm?: boolean;
  /** Hints said already. */
  seen: string[];
}
const KEY = 'discodungeon.tips';

function load(): Heard {
  try {
    const h = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { off: !!h.off, warm: !!h.warm, seen: Array.isArray(h.seen) ? h.seen : [] };
  } catch {
    return { seen: [] };
  }
}
export const heard: Heard = load();
export function saveHeard() {
  try { localStorage.setItem(KEY, JSON.stringify(heard)); } catch { /* private mode: lasts for this visit */ }
}
/** «Показывать подсказки» turned back on: the warm-up is offered again and every hint comes back. */
export function hearAgain() {
  heard.warm = false;
  heard.seen = [];
  saveHeard();
}

// ------------------------------------------------------------ the tutor

interface Beat {
  /** What it says, made up when it goes up. */
  text: () => string;
  kind: 'tap' | 'do';
  /** The line may go up now. */
  ready: () => boolean;
  /** Its moment is over: it comes down (or never goes up) and the next beat's turn comes. */
  gone: () => boolean;
  point?: Line['point'];
  pull?: Line['pull'];
  /** Pressed on, if it is a line to tap. */
  heard?: boolean;
  /** It has been up. */
  said?: boolean;
}

/** How often the tutor looks at the game, in milliseconds: its lines come no faster than a glance. */
const LOOK = 100;
/** A hint goes down on its own after this long, if it isn't tapped away. */
const HINT_UP = 15000;
/** Laid out on screen; offsetParent won't do, it is null for a fixed button too (the turn button on a phone). */
const onScreen = (el: HTMLElement) => !el.hidden && el.getClientRects().length > 0;

export class Tutor {
  coach = new Coach();
  /** Where the player is now; main.ts says. */
  where: () => Where = () => 'room';
  /** This screen's own hero: alone the first of the party, online the player's. */
  me: () => HeroState | null = () => null;
  /** The warm-up under way: its beats and which one is up to go next. */
  private beats: Beat[] | null = null;
  private at = 0;
  /** The warm-up is won: the farewell line is up, and its button leads into the real run. */
  private onDone: (() => void) | null = null;
  /** A hint up now, when it went up and where. */
  private hint: { id: string; t: number; where: Where } | null = null;
  /** The warm-up beat's line up now. */
  private shown: Line | null = null;
  private lookedAt = -Infinity;
  /** The offer of the warm-up is up, waiting for the player's answer. */
  private offered = false;

  constructor(private g: Game, private cam: Camera) {
    this.coach.onTap = () => this.tapped();
    this.coach.top = () => {
      let y = 70;
      for (const id of ['#hudTop', '#queue', '#bossBar', '.ore-chip']) {
        const el = document.querySelector<HTMLElement>(id);
        if (el && onScreen(el)) y = Math.max(y, el.getBoundingClientRect().bottom);
      }
      return y + 18;
    };
  }

  /** The warm-up is offered on the first «В путь» of a campaign, unless the hints are off or it has been offered before. */
  get offers() { return !heard.off && !heard.warm; }

  /**
   * The offer over the warm-up room: «Показывай» starts the beats, «Сам разберусь» goes straight to the run. Either way it
   * isn't offered again.
   */
  offer(skip: () => void) {
    heard.warm = true;
    saveHeard();
    this.stop();
    this.offered = true;
    this.coach.say({
      text: WARM_LINES.offer, by: BASTION, kind: 'do', dim: true,
      btns: [{ text: 'Показывай', on: () => this.warmup() }, { text: 'Сам разберусь', on: () => { this.stop(); skip(); } }],
    });
  }

  /** The warm-up's beats start, from putting the hero on the rune. */
  private warmup() {
    this.offered = false;
    this.coach.hush();
    const g = this.g, h = () => g.party[0], S = () => g.S;
    const live = () => g.liveMobs().length > 0;
    const full = S().mobs.reduce((n, m) => n + m.hp, 0), dealt = () => full > S().mobs.reduce((n, m) => n + Math.max(0, m.hp), 0);
    // the first throw has come to rest: the hero has no disc left and nothing on the table moves
    const thrown = () => S().phase === 'throw' && S().turn === 1 && h().hand === 0 && !g.moving();
    const lady = () => S().mobs.find(m => m.k === 'dummy_lady' && m.hp > 0);
    const crystal = () => S().nodes.find(n => n.k === 'spk' && n.left > 0);
    // not on the turn of the trick, whose disc goes at whoever is in sight; the line is let go once the disc flies
    const wall: Beat = {
      text: () => WARM_LINES.wall, kind: 'tap', gone: () => !lady() || (!!wall.said && (h().hand === 0 || S().phase !== 'throw')),
      ready: () => { const l = lady(), p = g.spot(h()); return S().phase === 'throw' && h().hand > 0 && !h().boost && !g.moving() && !!l && !!p && !g.clearShot(p, l); },
      point: () => { const l = lady(); return l ? this.worldBox(l, 0, 26, MOB_TOP[l.k]) : null; },
    };
    this.beats = [
      // a look round the room first, at the camera buttons; it goes once read, or once the hero is put down anyway
      { text: () => WARM_LINES.look, kind: 'tap', ready: () => S().phase === 'place', gone: () => h().pad !== null || S().phase !== 'place', point: () => this.domBox('camctl') },
      { text: () => WARM_LINES.rune, kind: 'do', ready: () => S().phase === 'place', gone: () => h().pad !== null || S().phase !== 'place', point: () => this.floorBox(S().pads[0], 18) },
      { text: () => WARM_LINES.go, kind: 'do', ready: () => S().phase === 'place' && h().pad !== null, gone: () => S().phase !== 'place', point: () => this.domBox('turnBtn') },
      {
        text: () => WARM_LINES.pull, kind: 'do', ready: () => S().phase === 'throw' && S().turn === 1, gone: () => h().hand === 0 || S().turn > 1,
        pull: () => {
          const p = g.spot(h()), m = S().mobs.find(o => o.k === 'dummy' && o.hp > 0) ?? g.liveMobs()[0];
          return p && m ? { foot: this.screen(p.x, p.y, 0), to: this.screen(m.x, m.y, 10) } : null;
        },
      },
      // how the first throw went is known once it has come to rest
      { text: () => (dealt() ? WARM_LINES.hit : WARM_LINES.miss), kind: 'tap', ready: thrown, gone: () => S().turn > 1 || S().phase !== 'throw' },
      { text: () => WARM_LINES.queue, kind: 'tap', ready: thrown, gone: () => S().turn > 1 || S().phase !== 'throw', point: () => this.domBox(null, '#queue li') },
      { text: () => WARM_LINES.end, kind: 'do', ready: thrown, gone: () => S().turn > 1 || S().phase !== 'throw' || g.ended(h()), point: () => this.domBox('turnBtn') },
      // the boxer's spring lands: if it never does by the next turn (the boxer down, or out of its sight), the line is let go
      { text: () => WARM_LINES.ouch, kind: 'tap', ready: () => h().hp < h().max, gone: () => S().turn > 2 || (S().turn === 2 && S().phase === 'throw' && h().hp >= h().max), point: () => this.domBox('fHpWrap') },
      {
        text: () => WARM_LINES.crystal, kind: 'do', ready: () => S().phase === 'throw' && S().turn > 1 && h().hand > 0 && !g.moving(),
        gone: () => h().sparks >= g.abCost(h()) || !crystal() || !live(), point: () => { const n = crystal(); return n ? this.worldBox(n, 0, 30, 30) : null; },
      },
      { text: () => WARM_LINES.ability, kind: 'do', ready: () => g.canUseAbility(h()) && !g.moving(), gone: () => h().boost || h().sparks < g.abCost(h()) || !live(), point: () => this.domBox('abBtn') },
      wall,
    ];
    this.at = 0;
    this.onDone = null;
    this.look(true);
  }

  /** The warm-up room is cleared: Бастион sends the player on, and its button starts the real run. */
  won(go: () => void) {
    this.beats = null;
    this.onDone = go;
    this.coach.say({ text: WARM_LINES.done, by: BASTION, kind: 'do', btns: [{ text: 'В путь', on: () => { this.stop(); go(); } }] });
  }

  /** The warm-up is over or left: its lines come down. */
  stop() {
    this.beats = null;
    this.onDone = null;
    this.offered = false;
    this.hint = null;
    this.coach.hush();
  }

  /** Whether the warm-up's beats are running. */
  get warming() { return this.beats !== null || this.onDone !== null || this.offered; }

  private tapped() {
    if (this.hint) { this.hint = null; this.coach.hush(); return; }
    const b = this.beats?.[this.at];
    if (b && this.coach.line === this.shown) { b.heard = true; this.coach.hush(); this.look(true); }
    else this.coach.hush();
  }

  /** Called every frame; looks at the game every so often and puts up, keeps or takes down the line. */
  look(now = false) {
    const t = performance.now();
    if (!now && t - this.lookedAt < LOOK) return;
    this.lookedAt = t;
    const where = this.where();
    this.coach.hide(where === 'menu');
    if (where === 'menu') return;
    // a room other than the warm-up's (the run has begun, or a game online): the warm-up is over
    if (this.warming && !this.g.S.spec.tut) this.stop();
    if (this.beats) this.warmBeat();
    else if (!this.warming) this.hints(where, t);
    if (this.coach.up) this.coach.chalk();
  }

  // ------------------------------------------------------------ the warm-up

  private warmBeat() {
    const g = this.g, beats = this.beats!;
    // the hero was spared a fall: that comes first, whatever beat is up
    if (g.spared) {
      g.spared = false;
      this.coach.say({ text: WARM_LINES.nodie, by: BASTION, kind: 'tap', point: () => this.domBox('fHpWrap') });
      return;
    }
    if (this.coach.line?.text === WARM_LINES.nodie) return;
    let moved = false;
    while (this.at < beats.length && (beats[this.at].heard || beats[this.at].gone())) { this.at++; moved = true; }
    if (moved && this.coach.line) this.coach.hush();
    const b = beats[this.at];
    if (!b || (this.coach.line && this.coach.line === this.shown) || !b.ready()) return;
    this.shown = { text: b.text(), by: BASTION, kind: b.kind, point: b.point, pull: b.pull };
    b.said = true;
    this.coach.say(this.shown);
  }

  // ------------------------------------------------------------ the hints

  private hints(where: Where, t: number) {
    if (this.hint) {
      // a hint goes down after a while, or once the player has gone elsewhere
      if (t - this.hint.t > HINT_UP || this.hint.where !== where) { this.hint = null; this.coach.hush(); }
      else return;
    }
    if (heard.off || this.coach.up) return;
    const g = this.g, S = g.S;
    if (S.spec.tut) return;
    for (const [id, when] of this.whens(where)) {
      if (heard.seen.includes(id)) continue;
      const point = when();
      if (point === false) continue;
      heard.seen.push(id);
      saveHeard();
      this.hint = { id, t, where };
      this.coach.say({ text: HINT_LINES[id], by: BASTION, kind: 'tap', point: point === true ? undefined : point, at: where === 'map' ? 'mid' : 'top' });
      return;
    }
  }

  /**
   * When each hint comes up: false while it doesn't, true when it does, or what its chalk arrows point at when it does. In a fight
   * the hints about the room wait for the fight to start, those about the hero for the player's own hero.
   */
  private whens(where: Where): [HintId, () => false | true | (() => Box | null)][] {
    // the hero on screen: online the player's own, in the campaign whichever of the party is picked
    const g = this.g, S = g.S, me = g.online ? this.me() : g.hero, room = where === 'room' && S.phase !== 'over';
    const fight = room && S.phase !== 'place', said = (re: RegExp) => room && S.floats.some(f => re.test(srcOf(f.txt)));
    const at = (id: string) => () => this.domBox(id);
    const mine = (k: 'fire' | 'chill' | 'daze' | 'pin') => fight && !!me && me.hp > 0 && (me[k] ?? 0) > 0;
    return [
      ['map', () => where === 'map'],
      ['event', () => where === 'event'],
      ['camp', () => where === 'camp'],
      ['forge', () => where === 'forge'],
      ['whet', () => where === 'whet'],
      ['loot', () => where === 'loot'],
      ['boss', () => room && S.spec.type === 'boss'],
      ['elite', () => room && S.spec.type === 'elite'],
      ['cave', () => room && S.spec.type === 'treasure'],
      ['smoke', () => room && !!S.spec.smoke],
      ['strobe', () => room && !!S.spec.strobe],
      ['party', () => (fight && S.phase === 'throw' && !g.online && g.party.length > 1 ? at('allies') : false)],
      ['crit', () => said(/^ТОЧНО!$/)],
      ['pit', () => said(/^провал$/)],
      ['spikes', () => said(/^(шипы|лава|осколки)!$/)],
      ['ore', () => (said(/^\+(\d+|\{0\}) руда$/) ? () => this.domBox(null, '.ore-chip') : false)],
      ['clink', () => said(/^ЗВОН/)],
      ['fire', () => (mine('fire') ? at('fStatus') : false)],
      ['chill', () => (mine('chill') ? at('fStatus') : false)],
      ['daze', () => (mine('daze') ? at('fStatus') : false)],
      ['pin', () => (mine('pin') ? at('fStatus') : false)],
      ['fallen', () => fight && g.alive().length > 0 && g.party.some(h => h.hp <= 0)],
      ['rage', () => (fight && S.phase === 'throw' && g.rage() > 0 ? at('hRage') : false)],
      ['herbs', () => {
        const herb = S.nodes.find(n => n.k === 'herb' && n.left > 0);
        if (!fight || S.phase !== 'throw' || !me || me.hp <= 0 || me.hp > me.max * 0.6 || !herb) return false;
        return () => this.worldBox(herb, 0, 30, 20);
      }],
    ];
  }

  // ------------------------------------------------------------ where things are on screen

  private screen(x: number, y: number, z: number): [number, number] {
    const [sx, sy] = this.cam.isoToScreen(...this.cam.iso(x, y, z));
    return [sx, sy];
  }

  /** A box on screen round a thing standing in the room: `w` wide, `top` tall, both in room units. */
  private worldBox(p: { x: number; y: number }, z: number, w: number, top: number): Box {
    const foot = this.screen(p.x, p.y, z), head = this.screen(p.x, p.y, z + top), k = this.cam.zoom;
    const ww = Math.max(26, w * k), y0 = Math.min(foot[1], head[1]) - 4, y1 = Math.max(foot[1], head[1]) + w * k * 0.25;
    return { x: foot[0] - ww / 2, y: y0, w: ww, h: Math.max(18, y1 - y0) };
  }

  /** A box round something flat on the floor (a rune), as wide as it is in the world and half as deep, the way it lies on screen. */
  private floorBox(p: { x: number; y: number }, w: number): Box {
    const c = this.screen(p.x, p.y, 0), ww = w * this.cam.zoom;
    return { x: c[0] - ww / 2, y: c[1] - ww / 4, w: ww, h: ww / 2 };
  }

  /** A box round a piece of the HUD, by id or round everything a selector picks; null while none of it is on screen. */
  private domBox(id: string | null, sel?: string): Box | null {
    const els = id ? [document.getElementById(id)] : [...document.querySelectorAll<HTMLElement>(sel!)];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of els) {
      if (!el || !onScreen(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    return x1 > x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
}

