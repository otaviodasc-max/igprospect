// injected.js — roda no MUNDO PRINCIPAL da página (instagram.com), não no
// mundo isolado da extensão (ver "world":"MAIN" no manifest, obrigatório
// aqui). Só um script no mesmo realm do bundle do Instagram consegue
// sobrescrever getUserMedia de um jeito que o código deles enxergue de
// verdade — content.js troca mensagens com este arquivo via
// window.postMessage, a única ponte entre os dois mundos.
//
// O QUE FAZ: o Instagram não aceita áudio como anexo solto (só imagem/vídeo)
// — a única forma de um áudio virar mensagem de voz é gravando na hora pelo
// microfone. Então, quando o usuário arrasta um áudio já pronto (aba Áudios)
// pra dentro de uma conversa do Direct, em vez de tentar "anexar arquivo" a
// extensão finge ser o microfone: troca a resposta de getUserMedia por um
// stream de áudio gerado a partir do arquivo importado, e content.js
// "segura" o botão de gravar pelo tempo da faixa (ver pressAndHold). Pro
// Instagram é uma gravação normal — quem "fala" é o áudio pronto.
(function () {
  'use strict';
  if (window.__igpAudioInjected) return;
  window.__igpAudioInjected = true;

  const realGetUserMedia = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    : null;

  let pending = null; // { audioEl, ctx }

  function cleanupPending() {
    if (pending) {
      try { pending.audioEl.pause(); } catch (_) {}
      try { pending.ctx && pending.ctx.close(); } catch (_) {}
    }
    pending = null;
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__igp !== true) return;
    const msg = ev.data;

    if (msg.type === 'IGP_PREP_AUDIO') {
      cleanupPending();
      const audioEl = new Audio();
      audioEl.addEventListener('loadedmetadata', () => {
        window.postMessage({ __igp: true, type: 'IGP_AUDIO_READY', id: msg.id, duration: audioEl.duration || 0 }, '*');
      }, { once: true });
      audioEl.addEventListener('error', () => {
        window.postMessage({ __igp: true, type: 'IGP_AUDIO_ERROR', id: msg.id }, '*');
      }, { once: true });
      audioEl.src = msg.dataUrl;
      pending = { audioEl };
    }

    if (msg.type === 'IGP_CANCEL_AUDIO') cleanupPending();

    // Handshake — content.js usa isso pra saber se este script (mundo
    // principal da página) está mesmo rodando antes de tentar qualquer
    // envio, em vez de descobrir só depois de segurar o botão por dezenas
    // de segundos sem resposta.
    if (msg.type === 'IGP_PING') {
      window.postMessage({ __igp: true, type: 'IGP_PONG' }, '*');
    }
  });

  if (navigator.mediaDevices && realGetUserMedia) {
    navigator.mediaDevices.getUserMedia = function (constraints) {
      // Só desvia gravação de ÁUDIO (não vídeo/câmera) e só quando há um
      // áudio importado esperando — qualquer outro uso normal do microfone
      // no Instagram (chamada de voz/vídeo etc.) passa direto pro
      // getUserMedia de verdade, sem interferência.
      if (pending && constraints && constraints.audio && !constraints.video) {
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          const ctx = new Ctx();
          const source = ctx.createMediaElementSource(pending.audioEl);
          const dest = ctx.createMediaStreamDestination();
          source.connect(dest);
          pending.ctx = ctx;
          pending.audioEl.currentTime = 0;
          const p = pending.audioEl.play();
          if (p && p.catch) p.catch(() => {});
          return Promise.resolve(dest.stream);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      return realGetUserMedia(constraints);
    };
  }

  window.postMessage({ __igp: true, type: 'IGP_INJECTED_READY' }, '*');
})();
