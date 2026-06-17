const PEER_HOST = "0.peerjs.com";
const PEER_PORT = 443;
const PEER_PATH = "/";

let peer = null;
let roomName = "";
let username = "";
let myPeerId = "";
let isHost = false;

let localStream = null;
let muted = false;
let cameraOff = false;
let sharingScreen = false;

const cameraCalls = {};
const screenCalls = {};
const dataConns = {};
const peerNames = {};
const remoteSharing = {};

const selfVideo = document.getElementById("selfVideo");
const videoGrid = document.getElementById("videoGrid");
const lobby = document.getElementById("lobby");
const room = document.getElementById("room");
const roomNameEl = document.getElementById("roomName");
const sidebarRoomName = document.getElementById("sidebarRoomName");
const joinBtn = document.getElementById("joinBtn");
const roomIdInput = document.getElementById("roomId");
const usernameInput = document.getElementById("usernameInput");
const micBtn = document.getElementById("micBtn");
const camBtn = document.getElementById("camBtn");
const screenBtn = document.getElementById("screenBtn");
const leaveBtn = document.getElementById("leaveBtn");
const connectionStatus = document.getElementById("connectionStatus");
const selfName = document.getElementById("selfName");
const usernameDisplay = document.getElementById("usernameDisplay");
const usernameDisplayBottom = document.getElementById("usernameDisplayBottom");
const avatarText = document.getElementById("avatarText");
const avatarTextBottom = document.getElementById("avatarTextBottom");
const inviteBox = document.getElementById("inviteBox");
const inviteLink = document.getElementById("inviteLink");
const copyBtn = document.getElementById("copyBtn");
const userList = document.getElementById("userList");
const userCount = document.getElementById("userCount");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");

async function getLocalStream() {
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    selfVideo.srcObject = localStream;
    selfVideo.style.display = "block";
  } catch (e) {
    console.warn("Media error:", e.message);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: false, audio: true,
      });
      selfVideo.style.display = "none";
    } catch (e2) {
      localStream = new MediaStream();
    }
  }
}

function addChatMsg(author, text, isSystem) {
  const el = document.createElement("div");
  el.className = isSystem ? "chat-msg system" : "chat-msg";
  if (isSystem) {
    el.textContent = text;
  } else {
    const a = document.createElement("span");
    a.className = `author ${author === username ? "author-self" : ""}`;
    a.textContent = author;
    const t = document.createElement("span");
    t.className = "text";
    t.textContent = text;
    el.appendChild(a);
    el.appendChild(t);
  }
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMsg(text) { addChatMsg("", text, true); }

function getColorForPeer(id) {
  const colors = ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#89b4fa", "#cba6f7", "#94e2d5", "#bac2de"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function updateUserList() {
  document.querySelectorAll(".user-item:not(#selfUserItem)").forEach((e) => e.remove());
  let count = 1;
  for (const id in peerNames) {
    if (id === myPeerId) continue;
    count++;
    const div = document.createElement("div");
    div.className = "user-item";
    div.id = `user-${id}`;
    const a = document.createElement("div");
    a.className = "avatar";
    a.style.background = getColorForPeer(id);
    a.textContent = peerNames[id][0].toUpperCase();
    const s = document.createElement("span");
    s.textContent = peerNames[id];
    div.appendChild(a);
    div.appendChild(s);
    userList.appendChild(div);
  }
  userCount.textContent = count;
}

function getOrCreateContainer(id, name, isScreen) {
  const suffix = isScreen ? "-screen" : "";
  let container = document.getElementById(`container-${id}${suffix}`);
  if (!container) {
    container = document.createElement("div");
    container.className = `video-container${isScreen ? " screen-share" : ""}`;
    container.id = `container-${id}${suffix}`;
    const video = document.createElement("video");
    video.id = `video-${id}${suffix}`;
    video.autoplay = true;
    video.playsInline = true;
    container.appendChild(video);
    const label = document.createElement("div");
    label.className = "video-label";
    label.id = `label-${id}${suffix}`;
    label.innerHTML = `<span>${isScreen ? name + "'s screen" : name}</span><span class="mic-icon" id="remoteMic-${id}${suffix}">&#x1f50a;</span>`;
    container.appendChild(label);
    videoGrid.appendChild(container);
  } else {
    const label = document.getElementById(`label-${id}${suffix}`);
    if (label) label.querySelector("span").textContent = isScreen ? (peerNames[id] || id.slice(0, 4)) + "'s screen" : name;
  }
  return container;
}

function removeContainer(id, isScreen) {
  const suffix = isScreen ? "-screen" : "";
  const el = document.getElementById(`container-${id}${suffix}`);
  if (el) el.remove();
}

function broadcastData(msg) {
  const m = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const id in dataConns) {
    try { dataConns[id].send(m); } catch {}
  }
}

function callPeerForMedia(pid, stream, store) {
  if (!stream) return null;
  try {
    const mc = peer.call(pid, stream);
    mc.on("stream", (remoteStream) => {
      const isScreen = store === screenCalls;
      const container = getOrCreateContainer(pid, peerNames[pid] || pid.slice(0, 4), isScreen);
      const vid = document.getElementById(`video-${pid}${isScreen ? "-screen" : ""}`);
      if (vid) vid.srcObject = remoteStream;
      store[pid] = mc;
    });
    mc.on("close", () => {
      delete store[pid];
      const isScreen = store === screenCalls;
      removeContainer(pid, isScreen);
    });
    return mc;
  } catch (e) {
    console.warn("callPeerForMedia error", pid, e.message);
    return null;
  }
}

function answerCall(call) {
  if (!localStream) return;
  call.answer(localStream);
  call.on("stream", (remoteStream) => {
    const pid = call.peer;
    const isScreen = !!remoteSharing[pid];

    if (isScreen) {
      screenCalls[pid] = call;
    } else {
      cameraCalls[pid] = call;
    }

    const container = getOrCreateContainer(pid, peerNames[pid] || pid.slice(0, 4), isScreen);
    const vid = document.getElementById(`video-${pid}${isScreen ? "-screen" : ""}`);
    if (vid) vid.srcObject = remoteStream;
  });
  call.on("close", () => {
    const pid = call.peer;
    delete cameraCalls[pid];
    delete screenCalls[pid];
    removeContainer(pid, false);
    removeContainer(pid, true);
  });
}

function connectDataToPeer(pid) {
  if (dataConns[pid]) return;
  try {
    const conn = peer.connect(pid, { reliable: true });
    conn.on("open", () => {
      dataConns[pid] = conn;
      conn.send(JSON.stringify({ type: "info", name: username, id: myPeerId }));
    });
    conn.on("data", (d) => handleDataMessage(pid, d));
    conn.on("close", () => removePeer(pid));
  } catch (e) {
    console.warn("connectData error", pid, e.message);
  }
}

function handleDataMessage(id, raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return; }

  switch (data.type) {
    case "chat":
      addChatMsg(data.author, data.text);
      broadcastData(data);
      break;

    case "join":
      peerNames[id] = data.name;
      addSystemMsg(`${data.name} joined`);
      updateUserList();
      for (const pid in dataConns) {
        if (pid !== id) dataConns[pid].send(JSON.stringify({ type: "info", name: data.name, id }));
      }
      if (dataConns[id]) {
        dataConns[id].send(JSON.stringify({
          type: "welcome",
          name: username,
          peers: Object.fromEntries(Object.entries(peerNames).filter(([k]) => k !== id && k !== myPeerId)),
        }));
      }
      break;

    case "welcome":
      peerNames[id] = data.name;
      addSystemMsg(`Connected to room`);
      for (const pid in data.peers) {
        peerNames[pid] = data.peers[pid];
        connectDataToPeer(pid);
        callPeerForMedia(pid, localStream, cameraCalls);
      }
      callPeerForMedia(id, localStream, cameraCalls);
      updateUserList();
      break;

    case "info":
      peerNames[data.id || id] = data.name;
      updateUserList();
      addSystemMsg(`${data.name} connected`);
      break;

    case "leave":
      addSystemMsg(`${peerNames[id] || "Someone"} left`);
      removePeer(id);
      break;

    case "mute": {
      const el = document.getElementById(`remoteMic-${id}`);
      if (el) {
        el.className = `mic-icon${data.muted ? " muted" : ""}`;
        el.innerHTML = data.muted ? "&#x1f507;" : "&#x1f50a;";
      }
      break;
    }

    case "screen-start":
      remoteSharing[id] = true;
      break;

    case "screen-stop":
      delete remoteSharing[id];
      if (screenCalls[id]) {
        try { screenCalls[id].close(); } catch {}
        delete screenCalls[id];
      }
      removeContainer(id, true);
      break;
  }
}

function removePeer(id) {
  if (dataConns[id]) { try { dataConns[id].close(); } catch {} delete dataConns[id]; }
  if (cameraCalls[id]) { try { cameraCalls[id].close(); } catch {} delete cameraCalls[id]; }
  if (screenCalls[id]) { try { screenCalls[id].close(); } catch {} delete screenCalls[id]; }
  delete peerNames[id];
  delete remoteSharing[id];
  removeContainer(id, false);
  removeContainer(id, true);
  updateUserList();
}

function toggleMic() {
  muted = !muted;
  if (localStream) localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  micBtn.classList.toggle("off", muted);
  const icon = document.getElementById("selfMicIcon");
  icon.className = `mic-icon${muted ? " muted" : ""}`;
  icon.innerHTML = muted ? "&#x1f507;" : "&#x1f50a;";
  broadcastData(JSON.stringify({ type: "mute", muted }));
}

function toggleCam() {
  cameraOff = !cameraOff;
  camBtn.classList.toggle("off", cameraOff);
  if (localStream) {
    localStream.getVideoTracks().forEach((t) => {
      if (cameraOff) { t.enabled = false; } else { t.enabled = true; }
    });
    if (cameraOff) {
      selfVideo.style.display = "none";
    } else {
      selfVideo.style.display = "block";
      selfVideo.srcObject = localStream;
    }
  }
}

async function startScreenShare() {
  try {
    const ss = await navigator.mediaDevices.getDisplayMedia({ video: true });
    if (!ss || !ss.getVideoTracks().length) return;

    screenStream = ss;
    sharingScreen = true;
    screenBtn.classList.add("screen-active");
    screenStream.getVideoTracks()[0].onended = stopScreenShare;

    selfVideo.srcObject = screenStream;

    broadcastData(JSON.stringify({ type: "screen-start" }));

    setTimeout(() => {
      for (const pid in cameraCalls) {
        callPeerForMedia(pid, screenStream, screenCalls);
      }
      if (isHost) {
        for (const pid in dataConns) {
          if (!cameraCalls[pid] && !screenCalls[pid] && pid !== myPeerId) {
            callPeerForMedia(pid, screenStream, screenCalls);
          }
        }
      }
    }, 200);
  } catch (e) {
    console.warn("Screen share cancelled");
  }
}

function stopScreenShare() {
  if (!sharingScreen) return;
  sharingScreen = false;
  screenBtn.classList.remove("screen-active");

  for (const pid in screenCalls) {
    try { screenCalls[pid].close(); } catch {}
    delete screenCalls[pid];
    removeContainer(pid, true);
  }
  broadcastData(JSON.stringify({ type: "screen-stop" }));

  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }

  if (localStream) {
    selfVideo.srcObject = localStream;
    selfVideo.style.display = cameraOff ? "none" : "block";
  }
}

let screenStream = null;

function leaveRoom() {
  broadcastData(JSON.stringify({ type: "leave" }));
  for (const id in dataConns) removePeer(id);
  for (const id in cameraCalls) removePeer(id);
  for (const id in screenCalls) removePeer(id);

  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach((t) => t.stop()); screenStream = null; }
  if (peer) { peer.destroy(); peer = null; }

  sharingScreen = false; muted = false; cameraOff = false;
  screenBtn.classList.remove("screen-active");
  camBtn.classList.remove("off");
  micBtn.classList.remove("off");
  isHost = false;

  document.querySelectorAll(".video-container:not(#selfContainer)").forEach((c) => c.remove());
  chatMessages.innerHTML = '<div class="chat-welcome">Chat messages appear here</div>';
  room.style.display = "none";
  lobby.style.display = "flex";
}

async function joinRoom() {
  const r = roomIdInput.value.trim() || `room-${Date.now()}`;
  roomName = r;
  username = usernameInput.value.trim() || `User${Math.floor(Math.random() * 1000)}`;

  roomNameEl.textContent = r;
  sidebarRoomName.textContent = r;
  selfName.textContent = username;
  usernameDisplay.textContent = username;
  usernameDisplayBottom.textContent = username;
  const init = username[0].toUpperCase();
  avatarText.textContent = init;
  avatarTextBottom.textContent = init;

  await getLocalStream();

  lobby.style.display = "none";
  document.getElementById("room").style.display = "flex";
  connectionStatus.textContent = "Connecting...";
  connectionStatus.style.color = "#f9e2af";

  const hashRoom = window.location.hash.slice(1);
  isHost = !hashRoom;

  if (isHost) {
    myPeerId = `sv-${r}`;
    addSystemMsg(`Room "${r}" created. Share the invite link.`);
    connectionStatus.textContent = "Hosting — waiting for others";
    connectionStatus.style.color = "#f9e2af";
    const url = `${window.location.origin}${window.location.pathname}#${r}`;
    inviteBox.style.display = "block";
    inviteLink.value = url;
  } else {
    myPeerId = `sv-${r}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    addSystemMsg(`Joining "${r}"...`);
    connectionStatus.textContent = "Connecting to host...";
    connectionStatus.style.color = "#f9e2af";
  }

  peer = new Peer(myPeerId, {
    host: PEER_HOST, port: PEER_PORT, path: PEER_PATH,
    config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
  });

  peer.on("open", (id) => {
    myPeerId = id;
    peerNames[id] = username;
    if (!isHost) {
      const hostId = `sv-${r}`;
      const conn = peer.connect(hostId, { reliable: true });
      conn.on("open", () => {
        dataConns[hostId] = conn;
        conn.send(JSON.stringify({ type: "join", name: username }));
      });
      conn.on("data", (d) => handleDataMessage(hostId, d));
      conn.on("close", () => { addSystemMsg("Lost connection to host"); removePeer(hostId); });
    }
    updateUserList();
  });

  peer.on("connection", (conn) => {
    conn.on("open", () => { dataConns[conn.peer] = conn; });
    conn.on("data", (d) => handleDataMessage(conn.peer, d));
    conn.on("close", () => removePeer(conn.peer));
  });

  peer.on("call", answerCall);

  peer.on("error", (err) => {
    console.error("PeerJS error:", err);
    if (err.type === "unavailable-id" && isHost) {
      addSystemMsg("Room name taken, joining as guest...");
      isHost = false;
      window.location.hash = "";
      peer.destroy();
      peer = null;
      setTimeout(joinRoom, 500);
    }
  });

  peer.on("disconnected", () => {
    connectionStatus.textContent = "Disconnected";
    connectionStatus.style.color = "#f38ba8";
  });
}

copyBtn.addEventListener("click", () => {
  inviteLink.select();
  navigator.clipboard.writeText(inviteLink.value);
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = "Copy"), 2000);
});

joinBtn.addEventListener("click", joinRoom);
roomIdInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
usernameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
micBtn.addEventListener("click", toggleMic);
camBtn.addEventListener("click", toggleCam);
screenBtn.addEventListener("click", () => (sharingScreen ? stopScreenShare() : startScreenShare()));
leaveBtn.addEventListener("click", leaveRoom);
chatSendBtn.addEventListener("click", () => {
  const text = chatInput.value.trim();
  if (!text) return;
  addChatMsg(username, text);
  broadcastData(JSON.stringify({ type: "chat", author: username, text }));
  chatInput.value = "";
});
chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") chatSendBtn.click(); });

window.addEventListener("beforeunload", () => {
  if (document.getElementById("room").style.display !== "none") leaveRoom();
});

if (window.location.hash) {
  roomIdInput.value = window.location.hash.slice(1);
}
