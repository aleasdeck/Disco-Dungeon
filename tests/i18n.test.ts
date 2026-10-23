import { describe, expect, it } from 'vitest';
import { checkLine, problems } from '../scripts/i18n.mjs';
import { M, Mjoin, hashOf as gameHash, srcOf, t } from '../src/i18n';
import { hashOf } from '../scripts/i18n.mjs';

describe('the languages', () => {
  // a line added in Russian needs its translation in every language before it goes out: node scripts/i18n.mjs todo <lang>
  it('every line of the game is translated into every language, with its values and markup kept', () => {
    expect(problems()).toEqual([]);
  });

  it('the script keys a line the way the game looks it up', () => {
    for (const s of ['Руда', '+{0} руды', '«{0}»', 'Ход {0} {0|ход|хода|ходов}']) expect(hashOf(s)).toBe(gameHash(s));
  });

  it('puts the values in, picks the word for a number and for a flag', () => {
    expect(t('{0} {0|ход|хода|ходов}', 1)).toBe('1 ход');
    expect(t('{0} {0|ход|хода|ходов}', 3)).toBe('3 хода');
    expect(t('{0} {0|ход|хода|ходов}', 11)).toBe('11 ходов');
    expect(t('{0} {1?ударила|ударил}', 'Вешалка', true)).toBe('Вешалка ударила');
    expect(t('{0} {1?ударила|ударил}', 'Бастион', false)).toBe('Бастион ударил');
    expect(t('{0:u}, {1:l}', 'дрищ', 'ТОЛСТЯК')).toBe('Дрищ, толстяк');
    expect(t('Бутылка показала на {acc}.', { acc: 'Бастиона' })).toBe('Бутылка показала на Бастиона.');
    expect(t('Ещё не выбрали: {0}.', ['ты', 'Вася'])).toBe('Ещё не выбрали: ты, Вася.');
  });

  it('keeps a line with its values for later and shows it whole, a line in a line too', () => {
    const kept = M('{0}: −1 «{1}»', 'Бастион', 'Урон');
    expect(t(kept)).toBe('Бастион: −1 «Урон»');
    expect(srcOf(kept)).toBe('{0}: −1 «{1}»');
    expect(t(M('Пари проиграно: {0}.', [kept, M('{0}: уровней нет, −{1} к макс. HP', 'Дрищ', 3)]))).toBe('Пари проиграно: Бастион: −1 «Урон», Дрищ: уровней нет, −3 к макс. HP.');
    expect(t(Mjoin(M('Ходов: {0}.', 4), '', 'Герои восстановили половину здоровья.'))).toBe('Ходов: 4. Герои восстановили половину здоровья.');
    expect(M('Без значений')).toBe('Без значений');
  });

  it('finds what is wrong with a translation', () => {
    expect(checkLine('en', '+{0} руды', '+{0} ore')).toEqual([]);
    expect(checkLine('en', '+{0} руды', '+ ore')).toEqual(['{0} is missing']);
    expect(checkLine('en', '{0} {0|ход|хода|ходов}', '{0} {0|turn|turns|x}')).toEqual(['{0|…} has 3 forms, en takes 2']);
    expect(checkLine('ja', '<b>Урон.</b> Бьёт', 'ダメージ。')).toEqual(['the markup differs']);
    expect(checkLine('de', 'Ход {0}', 'Zug {1}')).toEqual(['{1} is not a value of the line', '{0} is missing']);
  });
});
