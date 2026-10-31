// שיתוף מסך עם WebRTC. המשדר שולח וידאו ישירות לכל צופה.
(function () {
  const $ = (id) => document.getElementById(id);
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  let ws = null;
  let role = null; // 'host' או 'viewer'
  let stream = null;
  const peers = new Map(); // משדר: viewerId -> { pc, chain, pending }
  let viewer = null; // צופה: { pc, chain, pending }
  let viewerEarly = []; // מועמדי ICE שהגיעו לפני ההצעה

  function setStatus(t) { $('share-status').textContent = t || ''; }

  function show(panel) {
    for (const id of ['panel-idle', 'panel-host', 'panel-viewer']) {
      $(id).classList.toggle('hidden', id !== panel);
    }
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function cleanup() {
    for (const p of peers.values()) p.pc.close();
    peers.clear();
    if (viewer) viewer.pc.close();
    viewer = null;
    viewerEarly = [];
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $('video').srcObject = null;
    const s = ws;
    ws = null;
    role = null;
    if (s) s.close();
    show('panel-idle');
  }

  function stop() {
    cleanup();
    setStatus('');
  }

  function openSocket() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const s = new WebSocket(`${proto}://${location.host}/ws`);
      s.onopen = () => resolve(s);
      s.onerror = () => reject(new Error('אין חיבור לשרת'));
      s.onmessage = (e) => onMessage(JSON.parse(e.data));
      s.onclose = () => {
        if (ws === s) { cleanup(); setStatus('החיבור נותק'); }
      };
    });
  }

  // ---------- טיפול בהודעות WebRTC ----------
  async function applySignal(p, data) {
    const pc = p.pc;
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      for (const c of p.pending.splice(0)) await pc.addIceCandidate(c);
      if (data.sdp.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        return pc.localDescription;
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
      else p.pending.push(data.candidate);
    }
    return null;
  }

  // ---------- משדר ----------
  async function startShare() {
    setStatus('');
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      return setStatus('השיתוף בוטל');
    }
    try {
      ws = await openSocket();
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      return setStatus(e.message);
    }
    role = 'host';
    // אם המשתמש לוחץ "הפסק שיתוף" בסרגל של הדפדפן
    stream.getVideoTracks()[0].addEventListener('ended', stop);
    send({ type: 'create' });
  }

  async function hostAddViewer(id) {
    const pc = new RTCPeerConnection(ICE);
    peers.set(id, { pc, chain: Promise.resolve(), pending: [] });
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'signal', to: id, data: { candidate: e.candidate } });
    };
    await pc.setLocalDescription(await pc.createOffer());
    send({ type: 'signal', to: id, data: { sdp: pc.localDescription } });
  }

  function updateCount() { $('viewer-count').textContent = peers.size; }

  // ---------- צופה ----------
  async function joinRoom() {
    const code = $('room-input').value.trim().toUpperCase();
    if (!code) return setStatus('הכנס קוד חדר');
    setStatus('מתחבר...');
    try {
      ws = await openSocket();
    } catch (e) {
      return setStatus(e.message);
    }
    role = 'viewer';
    send({ type: 'join', room: code });
  }

  function viewerReceive(data) {
    if (!viewer) {
      if (!data.sdp) { viewerEarly.push(data.candidate); return; }
      const pc = new RTCPeerConnection(ICE);
      viewer = { pc, chain: Promise.resolve(), pending: viewerEarly };
      viewerEarly = [];
      pc.ontrack = (e) => {
        $('video').srcObject = e.streams[0];
        setStatus('');
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ type: 'signal', data: { candidate: e.candidate } });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') setStatus('החיבור נכשל (ייתכן שצריך שרת TURN)');
      };
    }
    const v = viewer;
    v.chain = v.chain.then(async () => {
      const answer = await applySignal(v, data);
      if (answer) send({ type: 'signal', data: { sdp: answer } });
    }).catch(console.error);
  }

  // ---------- הודעות מהשרת ----------
  function onMessage(msg) {
    switch (msg.type) {
      case 'created': {
        $('room-code').textContent = msg.room;
        $('link').value = `${location.origin}/?room=${msg.room}`;
        updateCount();
        show('panel-host');
        break;
      }
      case 'viewer-joined':
        hostAddViewer(msg.viewer).then(updateCount).catch(console.error);
        break;
      case 'viewer-left': {
        const p = peers.get(msg.viewer);
        if (p) { p.pc.close(); peers.delete(msg.viewer); }
        updateCount();
        break;
      }
      case 'joined':
        show('panel-viewer');
        setStatus('ממתין לווידאו...');
        break;
      case 'signal':
        if (role === 'host') {
          const p = peers.get(msg.from);
          if (p) p.chain = p.chain.then(() => applySignal(p, msg.data)).catch(console.error);
        } else {
          viewerReceive(msg.data);
        }
        break;
      case 'ended':
        cleanup();
        setStatus('המשדר סיים את השיתוף');
        break;
      case 'error':
        cleanup();
        setStatus(msg.message);
        break;
    }
  }

  // ---------- חיבור לכפתורים ----------
  $('btn-share').onclick = startShare;
  $('btn-stop').onclick = stop;
  $('btn-join').onclick = joinRoom;
  $('btn-leave').onclick = stop;
  $('room-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('btn-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('link').value);
      setStatus('הקישור הועתק');
    } catch {
      $('link').select();
    }
  };

  window.Share = {
    // נקרא אחרי התחברות: אם נכנסו מקישור, ממלא את הקוד
    onLogin() {
      const room = new URLSearchParams(location.search).get('room');
      if (room) $('room-input').value = room.toUpperCase();
    },
    stop,
  };
})();
