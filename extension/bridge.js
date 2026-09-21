// bridge.js — IGProspect
// Ponte de PRESENÇA entre a extensão e o painel: só avisa a página do painel
// que a extensão está instalada. Não lê, não envia e não apaga leads, e não
// muda a equipe da extensão.
//
// Antes, esta ponte entregava a fila local inteira (chrome.storage.local.igp_l)
// ao painel, que gravava tudo na equipe ABERTA ali — leads baixados de uma
// equipe iam parar em qualquer outra equipe aberta ou recém-criada no mesmo
// navegador. A extensão grava direto no Supabase (background.js → RPCs
// extension_*), e a equipe dela só muda dentro da própria extensão
// (Configurações → Equipe, doLinkOrg em content.js).

(function () {
  'use strict';

  // Só avisa páginas em que o manifest injeta este script
  // (content_scripts.matches). file:// não tem origin — o navegador manda "null".
  const ALLOWED_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*netlify\.app$|^https:\/\/otaviodasc-max\.github\.io$/i;
  const origin = window.location.origin;
  if (origin !== 'null' && !ALLOWED_ORIGIN_RE.test(origin || '')) return;

  window.postMessage({ source: 'igp-extension', type: 'hello' }, origin === 'null' ? '*' : origin);
})();
