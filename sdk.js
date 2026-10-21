/* PLAIR SDK — рекорды и вызовы «побей мой рекорд» для игр в ленте plair.pro.
 *
 *   <script src="https://plair.pro/sdk.js"></script>
 *   ...
 *   PLAIR.score(87);                         // партия закончилась: счёт игрока
 *   PLAIR.score(42.5, { lowerIsBetter: true }); // для игр на время: меньше — лучше
 *
 * Необязательно:
 *   PLAIR.onChallenge(function (c) { ... }); // игрока позвал друг: c.score, c.name
 *
 * Вне ленты (игра открыта сама по себе) SDK молчит и ничего не ломает.
 * Счёт уходит только в окно ленты; никаких данных игрока SDK не собирает.
 */
(function () {
  'use strict';
  if (window.PLAIR && window.PLAIR.version) return;

  var inFeed = false;
  try { inFeed = window.parent && window.parent !== window; } catch (e) { inFeed = false; }

  var challenge = null, waiting = [];

  function send(type, data) {
    if (!inFeed) return;
    var msg = { plair: 1, type: type };
    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) msg[k] = data[k];
    try { window.parent.postMessage(msg, '*'); } catch (e) { /* лента закрыта — не страшно */ }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.plair !== 1 || e.source !== window.parent) return;
    if (d.type === 'challenge' && d.challenge) {
      challenge = { score: Number(d.challenge.score), name: d.challenge.name || null,
                    lowerIsBetter: !!d.challenge.lowerIsBetter };
      PLAIR.challenge = challenge;
      waiting.splice(0).forEach(function (fn) { try { fn(challenge); } catch (err) {} });
    }
  });

  var PLAIR = window.PLAIR = {
    version: 1,
    inFeed: inFeed,
    challenge: null,
    /* Счёт законченной партии. Лента сама хранит лучший результат игрока. */
    score: function (value, opts) {
      var n = Number(value);
      if (!isFinite(n)) return;
      send('score', { value: n, lower: !!(opts && opts.lowerIsBetter) });
    },
    /* Если игрока позвал друг — вызов придёт сюда (и сразу, если уже пришёл). */
    onChallenge: function (fn) {
      if (typeof fn !== 'function') return;
      if (challenge) { try { fn(challenge); } catch (e) {} } else waiting.push(fn);
    }
  };

  send('hello', { version: 1 });
})();
